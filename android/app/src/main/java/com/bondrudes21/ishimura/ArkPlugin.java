package com.bondrudes21.ishimura;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.Window;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.documentfile.provider.DocumentFile;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Нативные возможности для интерфейса архива (window.ark → js/platform/*.js):
 * выбор файлов и папок, «Сохранить как…», загрузки, «Открыть в…», распаковка архивов,
 * встроенный браузер, полноэкранный режим и плеер аудиокниг.
 * Пути: pickFiles/pickFolder/saveFile/extract получают абсолютные пути,
 * download и события возвращают пути относительно папки данных приложения (getFilesDir).
 */
@CapacitorPlugin(name = "Ark")
public class ArkPlugin extends Plugin {

    private static final String TAG = "Ark";
    private static WeakReference<ArkPlugin> instance = new WeakReference<>(null);

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSObject> pendingIncoming = new ArrayList<>();

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        handleIntent(getActivity().getIntent());
    }

    /** Отправить событие в интерфейс из других классов (браузер). */
    static void send(String event, JSObject data) {
        ArkPlugin p = instance.get();
        if (p != null) p.notifyListeners(event, data);
    }

    static File dataDir(Context ctx) {
        return ctx.getFilesDir();
    }

    static String relPath(Context ctx, File f) {
        String root = dataDir(ctx).getAbsolutePath() + File.separator;
        String abs = f.getAbsolutePath();
        return abs.startsWith(root) ? abs.substring(root.length()).replace(File.separatorChar, '/') : abs;
    }

    private static double num(PluginCall call, String key, double def) {
        Object v = call.getData().opt(key);
        return v instanceof Number ? ((Number) v).doubleValue() : def;
    }

    private static String[] strings(JSArray arr) {
        if (arr == null) return new String[0];
        List<String> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, null);
            if (s != null) out.add(s);
        }
        return out.toArray(new String[0]);
    }

    // ---------- Копирование из content:// ----------

    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {}
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "file";
        int slash = name.lastIndexOf('/');
        return slash >= 0 ? name.substring(slash + 1) : name;
    }

    private File copyUri(Uri uri, File destDir) throws IOException {
        return copyUri(uri, destDir, displayName(uri));
    }

    private File copyUri(Uri uri, File destDir, String name) throws IOException {
        if (!destDir.exists() && !destDir.mkdirs()) throw new IOException("Нет доступа к памяти приложения");
        File out = Downloader.unique(destDir, Downloader.sanitize(name));
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IOException("Не удалось открыть файл");
            copy(in, os);
        }
        return out;
    }

    static void copy(InputStream in, OutputStream os) throws IOException {
        byte[] buf = new byte[256 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) os.write(buf, 0, n);
    }

    private static List<Uri> urisOf(Intent data) {
        List<Uri> list = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) list.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) list.add(data.getData());
        return list;
    }

    // ---------- Выбор файлов ----------

    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        String[] mimes = strings(call.getArray("mime"));
        if (mimes.length > 0 && !Arrays.asList(mimes).contains("*/*")) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", false)));
        startActivityForResult(call, i, "onPickFiles");
    }

    @ActivityCallback
    private void onPickFiles(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        List<Uri> uris = urisOf(result.getData());
        File dest = new File(call.getString("dest", new File(getContext().getCacheDir(), "picked").getAbsolutePath()));
        io.execute(() -> {
            try {
                JSArray arr = new JSArray();
                for (Uri u : uris) {
                    File f = copyUri(u, dest);
                    JSObject o = new JSObject();
                    o.put("name", f.getName());
                    o.put("size", f.length());
                    arr.put(o);
                }
                JSObject r = new JSObject();
                r.put("files", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Не удалось скопировать файл: " + e.getMessage());
            }
        });
    }

    // ---------- Выбор папки (аудиокнига) ----------

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, i, "onPickFolder");
    }

    @ActivityCallback
    private void onPickFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = result.getData().getData();
        File dest = new File(call.getString("dest", ""));
        Set<String> exts = new HashSet<>();
        for (String e : strings(call.getArray("ext"))) exts.add(e.toLowerCase(Locale.ROOT));
        io.execute(() -> {
            try {
                DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
                if (root == null) throw new IOException("Папка недоступна");
                JSArray arr = new JSArray();
                walkTree(root, "", dest, exts, arr, 0);
                JSObject r = new JSObject();
                r.put("folder", root.getName());
                r.put("files", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Не удалось скопировать папку: " + e.getMessage());
            }
        });
    }

    private void walkTree(DocumentFile dir, String rel, File dest, Set<String> exts, JSArray out, int depth) throws IOException {
        if (depth > 6) return;
        for (DocumentFile f : dir.listFiles()) {
            String name = f.getName();
            if (name == null) continue;
            if (f.isDirectory()) {
                walkTree(f, rel.isEmpty() ? Downloader.sanitize(name) : rel + "/" + Downloader.sanitize(name), dest, exts, out, depth + 1);
                continue;
            }
            int dot = name.lastIndexOf('.');
            String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
            if (!exts.isEmpty() && !exts.contains(ext)) continue;
            File target = rel.isEmpty() ? dest : new File(dest, rel);
            File copied = copyUri(f.getUri(), target, name);
            JSObject o = new JSObject();
            o.put("rel", rel.isEmpty() ? copied.getName() : rel + "/" + copied.getName());
            o.put("size", copied.length());
            out.put(o);
        }
    }

    // ---------- «Сохранить как…» ----------

    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/octet-stream"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "file"));
        startActivityForResult(call, i, "onSaveFile");
    }

    @ActivityCallback
    private void onSaveFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri target = result.getData().getData();
        File src = new File(call.getString("src", ""));
        io.execute(() -> {
            try (InputStream in = new FileInputStream(src); OutputStream os = getContext().getContentResolver().openOutputStream(target)) {
                if (os == null) throw new IOException("Нет доступа к выбранному месту");
                copy(in, os);
                JSObject r = new JSObject();
                r.put("saved", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Не удалось сохранить файл: " + e.getMessage());
            }
        });
    }

    // ---------- Ссылки, загрузки, распаковка ----------

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Нет приложения, чтобы открыть ссылку");
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        File dir = new File(dataDir(getContext()), call.getString("dest", "library/incoming"));
        String name = call.getString("name");
        io.execute(() -> {
            try {
                Downloader.Result r = Downloader.fetch(url, dir, name, null, null, null, null);
                JSObject o = new JSObject();
                o.put("path", relPath(getContext(), r.file));
                o.put("name", r.name);
                o.put("mime", r.mime);
                o.put("size", r.size);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Не удалось скачать" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void extract(PluginCall call) {
        File archive = new File(call.getString("archive", ""));
        File dest = new File(call.getString("dest", ""));
        io.execute(() -> {
            try {
                List<String> files = Extractor.extract(archive, dest);
                JSObject r = new JSObject();
                r.put("files", new JSArray(files));
                call.resolve(r);
            } catch (Throwable e) {
                call.reject("Не удалось распаковать архив: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void openBrowser(PluginCall call) {
        Intent i = new Intent(getContext(), BrowserActivity.class);
        i.putExtra("url", call.getString("url", ""));
        getActivity().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        main.post(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    // ---------- «Открыть в…» / «Поделиться» ----------

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) uris.add(intent.getData());
        else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) uris.addAll(l);
        }
        if (uris.isEmpty()) return;
        intent.setAction(null); // чтобы при пересоздании экрана файл не добавился второй раз
        File dest = new File(dataDir(getContext()), "library/incoming/in");
        io.execute(() -> {
            for (Uri u : uris) {
                try {
                    File f = copyUri(u, dest);
                    JSObject o = new JSObject();
                    o.put("path", relPath(getContext(), f));
                    o.put("name", f.getName());
                    deliverIncoming(o);
                } catch (Exception e) {
                    Log.w(TAG, "incoming failed", e);
                }
            }
        });
    }

    private synchronized void deliverIncoming(JSObject o) {
        if (hasListeners("incoming")) notifyListeners("incoming", o);
        else pendingIncoming.add(o);
    }

    @PluginMethod
    public void takeIncoming(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (this) {
            for (JSObject o : pendingIncoming) arr.put(o);
            pendingIncoming.clear();
        }
        JSObject r = new JSObject();
        r.put("files", arr);
        call.resolve(r);
    }

    // ---------- Плеер аудиокниг (управление сервисом AudioService) ----------

    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private final List<Object[]> waiting = new ArrayList<>();

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (controller != null && controller.isPlaying()) {
                emitAudio(null);
                main.postDelayed(this, 1000);
            }
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onEvents(Player player, Player.Events events) {
            if (events.containsAny(
                Player.EVENT_IS_PLAYING_CHANGED,
                Player.EVENT_PLAY_WHEN_READY_CHANGED,
                Player.EVENT_MEDIA_ITEM_TRANSITION,
                Player.EVENT_PLAYBACK_STATE_CHANGED,
                Player.EVENT_POSITION_DISCONTINUITY,
                Player.EVENT_TIMELINE_CHANGED
            )) {
                emitAudio(null);
                main.removeCallbacks(ticker);
                if (player.isPlaying()) main.postDelayed(ticker, 1000);
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            emitAudio(error.getMessage() == null ? "ошибка воспроизведения" : error.getMessage());
        }
    };

    private void emitAudio(String error) {
        if (controller == null) return;
        int state = controller.getPlaybackState();
        JSObject o = new JSObject();
        o.put("index", controller.getCurrentMediaItemIndex());
        o.put("position", controller.getCurrentPosition() / 1000.0);
        long d = controller.getDuration();
        o.put("duration", d == C.TIME_UNSET ? -1 : d / 1000.0);
        o.put("playing", controller.getPlayWhenReady() && state != Player.STATE_ENDED && state != Player.STATE_IDLE);
        o.put("ended", state == Player.STATE_ENDED);
        if (error != null) o.put("error", error);
        notifyListeners("audio", o);
    }

    private void withPlayer(PluginCall call, Consumer<MediaController> fn) {
        main.post(() -> {
            if (controller != null && controller.isConnected()) {
                runOnPlayer(call, fn);
                return;
            }
            waiting.add(new Object[] { call, fn });
            if (controllerFuture != null) return;
            Context ctx = getContext();
            SessionToken token = new SessionToken(ctx, new ComponentName(ctx, AudioService.class));
            controllerFuture = new MediaController.Builder(ctx, token).buildAsync();
            controllerFuture.addListener(() -> {
                List<Object[]> w = new ArrayList<>(waiting);
                waiting.clear();
                try {
                    controller = controllerFuture.get();
                    controller.addListener(playerListener);
                } catch (Exception e) {
                    controllerFuture = null;
                    for (Object[] item : w) if (item[0] != null) ((PluginCall) item[0]).reject("Плеер недоступен: " + e.getMessage());
                    return;
                }
                for (Object[] item : w) {
                    @SuppressWarnings("unchecked")
                    Consumer<MediaController> f = (Consumer<MediaController>) item[1];
                    runOnPlayer((PluginCall) item[0], f);
                }
            }, ContextCompat.getMainExecutor(ctx));
        });
    }

    private void runOnPlayer(PluginCall call, Consumer<MediaController> fn) {
        try {
            fn.accept(controller);
            if (call != null) call.resolve();
        } catch (Exception e) {
            if (call != null) call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void audioLoad(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        int index = call.getInt("index", 0);
        long pos = (long) (num(call, "position", 0) * 1000);
        float rate = (float) num(call, "rate", 1);
        boolean play = Boolean.TRUE.equals(call.getBoolean("play", true));
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String cover = call.getString("cover");
        List<MediaItem> items = new ArrayList<>();
        try {
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject t = tracks.getJSONObject(i);
                MediaMetadata.Builder mb = new MediaMetadata.Builder()
                    .setTitle(t.optString("title", "Глава " + (i + 1)))
                    .setArtist(artist)
                    .setAlbumTitle(title)
                    .setAlbumArtist(artist)
                    .setTrackNumber(i + 1)
                    .setTotalTrackCount(tracks.length());
                if (cover != null && !cover.isEmpty()) mb.setArtworkUri(Uri.fromFile(new File(cover)));
                items.add(new MediaItem.Builder()
                    .setMediaId(String.valueOf(i))
                    .setUri(Uri.fromFile(new File(t.getString("path"))))
                    .setMediaMetadata(mb.build())
                    .build());
            }
        } catch (Exception e) {
            call.reject("Неверный список глав");
            return;
        }
        withPlayer(call, p -> {
            p.setMediaItems(items, Math.max(0, Math.min(items.size() - 1, index)), pos);
            p.setPlaybackSpeed(rate);
            p.prepare();
            p.setPlayWhenReady(play);
        });
    }

    @PluginMethod
    public void audioTrack(PluginCall call) {
        int index = call.getInt("index", 0);
        long pos = (long) (num(call, "position", 0) * 1000);
        boolean play = Boolean.TRUE.equals(call.getBoolean("play", true));
        withPlayer(call, p -> {
            if (index < p.getMediaItemCount()) p.seekTo(index, pos);
            if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare();
            p.setPlayWhenReady(play);
        });
    }

    @PluginMethod
    public void audioPlay(PluginCall call) {
        withPlayer(call, p -> {
            if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare();
            p.play();
        });
    }

    @PluginMethod
    public void audioPause(PluginCall call) {
        withPlayer(call, Player::pause);
    }

    @PluginMethod
    public void audioSeek(PluginCall call) {
        long pos = (long) (num(call, "position", 0) * 1000);
        withPlayer(call, p -> p.seekTo(pos));
    }

    @PluginMethod
    public void audioRate(PluginCall call) {
        float rate = (float) num(call, "rate", 1);
        withPlayer(call, p -> p.setPlaybackSpeed(rate));
    }

    @PluginMethod
    public void audioVolume(PluginCall call) {
        float v = (float) num(call, "volume", 1);
        withPlayer(call, p -> p.setVolume(Math.max(0f, Math.min(1f, v))));
    }

    @PluginMethod
    public void audioStop(PluginCall call) {
        withPlayer(call, p -> {
            p.stop();
            p.clearMediaItems();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(ticker);
        if (controller != null) controller.removeListener(playerListener);
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        controller = null;
        controllerFuture = null;
        super.handleOnDestroy();
    }
}
