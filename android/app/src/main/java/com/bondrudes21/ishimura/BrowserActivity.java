package com.bondrudes21.ishimura;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Встроенный браузер. Книги, аудио и архивы, скачанные здесь, складываются в память приложения,
 * а интерфейс архива сам добавляет их на полку (событие «download»). Остальное — в системные «Загрузки».
 */
public class BrowserActivity extends AppCompatActivity {

    private static final Set<String> LIBRARY_EXT = new HashSet<>(Arrays.asList(
        "fb2", "epub", "pdf", "txt", "docx", "rtf", "zip", "7z", "rar",
        "mp3", "m4a", "m4b", "ogg", "opus", "flac", "wav", "aac"
    ));
    private static final Pattern DRIVE_FILE = Pattern.compile(
        "^https://drive\\.google\\.com/(?:file/d/([\\w-]{10,})|open\\?(?:[^#]*&)?id=([\\w-]{10,}))"
    );
    // Ссылки скачивания сайтов на uCoz: открываем сами, не полагаясь на скрипты сайта
    private static final String UCOZ_HOOK = "(() => { if (window.__arkHook) return; window.__arkHook = true;"
        + " const DL = /\\/load\\/\\d+-\\d+-\\d+-\\d+-20(?:$|[?#])/;"
        + " document.addEventListener('click', (e) => {"
        + "  const stack = document.elementsFromPoint(e.clientX, e.clientY);"
        + "  const a = stack.map((el) => el.closest && el.closest('a')).find((x) => x && DL.test(x.href));"
        + "  if (a) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); location.href = a.href; }"
        + " }, true); })()";

    private static final int BG = Color.parseColor("#0A1410");
    private static final int BG_DEEP = Color.parseColor("#050A08");
    private static final int TEXT = Color.parseColor("#C8F5DC");
    private static final int DIM = Color.parseColor("#5F8A74");
    private static final int ACCENT = Color.parseColor("#39FF9A");

    private static final AtomicInteger SEQ = new AtomicInteger();
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    private WebView web;
    private EditText addr;
    private ProgressBar progress;
    private TextView status;
    private int active = 0;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView toolButton(String glyph, String description, View.OnClickListener onClick) {
        TextView b = new TextView(this);
        b.setText(glyph);
        b.setContentDescription(description);
        b.setTextColor(TEXT);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setGravity(Gravity.CENTER);
        b.setMinWidth(dp(42));
        b.setMinHeight(dp(44));
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        b.setOnClickListener(onClick);
        return b;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG_DEEP);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(BG);
        bar.setPadding(dp(4), dp(4), dp(4), dp(4));

        addr = new EditText(this);
        addr.setSingleLine(true);
        addr.setTextColor(TEXT);
        addr.setHintTextColor(DIM);
        addr.setHint("Адрес сайта или поиск");
        addr.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        addr.setImeOptions(EditorInfo.IME_ACTION_GO);
        addr.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        addr.setSelectAllOnFocus(true);
        addr.setPadding(dp(12), dp(6), dp(12), dp(6));
        android.graphics.drawable.GradientDrawable pill = new android.graphics.drawable.GradientDrawable();
        pill.setColor(BG_DEEP);
        pill.setCornerRadius(dp(20));
        pill.setStroke(dp(1), Color.parseColor("#1C3A2C"));
        addr.setBackground(pill);
        addr.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                navigate(addr.getText().toString());
                hideKeyboard();
                return true;
            }
            return false;
        });

        bar.addView(toolButton("✕", "Закрыть браузер", v -> finish()));
        bar.addView(toolButton("‹", "Назад", v -> { if (web.canGoBack()) web.goBack(); }));
        bar.addView(toolButton("›", "Вперёд", v -> { if (web.canGoForward()) web.goForward(); }));
        LinearLayout.LayoutParams addrLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        addrLp.setMargins(dp(4), 0, dp(4), 0);
        bar.addView(addr, addrLp);
        bar.addView(toolButton("⟳", "Обновить", v -> web.reload()));
        bar.addView(toolButton("☆", "В закладки", v -> bookmark()));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        progress.setVisibility(View.INVISIBLE);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        status = new TextView(this);
        status.setTextColor(ACCENT);
        status.setBackgroundColor(BG);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        status.setTypeface(Typeface.MONOSPACE);
        status.setPadding(dp(14), dp(6), dp(14), dp(6));
        status.setSingleLine(true);
        status.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        status.setVisibility(View.GONE);
        root.addView(status, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        // Отступы под системные панели и клавиатуру (Android 15+ рисует приложение под ними)
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false); // ссылки «в новом окне» открываются здесь же
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (req.isForMainFrame()) {
                    // Google Диск: страница файла не отдаёт скачивание во встроенном браузере — сразу прямая ссылка
                    Matcher m = DRIVE_FILE.matcher(url);
                    if (m.find()) {
                        String id = m.group(1) != null ? m.group(1) : m.group(2);
                        view.loadUrl("https://drive.usercontent.google.com/download?id=" + id + "&export=download&confirm=t");
                        return true;
                    }
                }
                String scheme = req.getUrl().getScheme();
                if (scheme != null && !scheme.equals("http") && !scheme.equals("https")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!addr.hasFocus()) addr.setText(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!addr.hasFocus()) addr.setText(url);
                view.evaluateJavascript(UCOZ_HOOK, null);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && err.getErrorCode() != WebViewClient.ERROR_UNKNOWN) {
                    Toast.makeText(BrowserActivity.this, "Страница не загрузилась: " + err.getDescription(), Toast.LENGTH_LONG).show();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p < 100 ? View.VISIBLE : View.INVISIBLE);
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) ->
            handleDownload(url, userAgent, contentDisposition, mimetype));

        // Долгое нажатие на ссылку: скачать напрямую, если обычное нажатие на сайте не срабатывает
        web.setOnLongClickListener(v -> {
            WebView.HitTestResult r = web.getHitTestResult();
            if (r.getType() != WebView.HitTestResult.SRC_ANCHOR_TYPE || r.getExtra() == null) return false;
            String link = r.getExtra();
            new AlertDialog.Builder(this)
                .setTitle(link)
                .setItems(new String[] { "Скачать по ссылке", "Открыть", "Копировать ссылку" }, (d, which) -> {
                    if (which == 0) handleDownload(link, s.getUserAgentString(), null, null);
                    else if (which == 1) web.loadUrl(link);
                    else {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(ClipData.newPlainText("link", link));
                        Toast.makeText(this, "Ссылка скопирована", Toast.LENGTH_SHORT).show();
                    }
                })
                .show();
            return true;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        String url = getIntent().getStringExtra("url");
        if (url != null && !url.isEmpty()) navigate(url);
        else addr.requestFocus();
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(addr.getWindowToken(), 0);
        addr.clearFocus();
        web.requestFocus();
    }

    private void navigate(String input) {
        String u = input == null ? "" : input.trim();
        if (u.isEmpty()) return;
        if (!u.matches("(?i)^https?://.*")) {
            u = u.matches(".*\\.\\w{2,}.*") && !u.contains(" ")
                ? "https://" + u
                : "https://duckduckgo.com/?q=" + Uri.encode(u);
        }
        web.loadUrl(u);
    }

    private void bookmark() {
        String url = web.getUrl();
        if (url == null || url.isEmpty()) return;
        JSObject o = new JSObject();
        o.put("type", "bookmark");
        o.put("url", url);
        o.put("title", web.getTitle() == null ? "" : web.getTitle());
        ArkPlugin.send("browser", o);
        Toast.makeText(this, "Сайт добавлен в закладки", Toast.LENGTH_SHORT).show();
    }

    private static String extOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".fb2.zip")) return "zip";
        int dot = n.lastIndexOf('.');
        return dot >= 0 ? n.substring(dot + 1) : "";
    }

    private void showStatus(String text) {
        main.post(() -> {
            if (text == null) status.setVisibility(View.GONE);
            else {
                status.setText(text);
                status.setVisibility(View.VISIBLE);
            }
        });
    }

    private void handleDownload(String url, String ua, String contentDisposition, String mime) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "Этот сайт отдаёт файл особым способом. Скачайте его в обычном браузере и откройте в «Архиве»", Toast.LENGTH_LONG).show();
            return;
        }
        String name = Downloader.guessName(url, contentDisposition, mime);
        String ext = extOf(name);
        String id = "b" + SEQ.incrementAndGet();
        if (!LIBRARY_EXT.contains(ext)) {
            // Не книга и не аудио — в системные «Загрузки»
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) req.addRequestHeader("Cookie", cookie);
                req.addRequestHeader("User-Agent", ua != null ? ua : Downloader.UA);
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Файл сохраняется в «Загрузки»: " + name, Toast.LENGTH_LONG).show();
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("name", name);
                o.put("state", "saved");
                ArkPlugin.send("download", o);
            } catch (Exception e) {
                Toast.makeText(this, "Не удалось скачать: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
            return;
        }
        Toast.makeText(this, "Скачиваю: " + name, Toast.LENGTH_SHORT).show();
        active++;
        String referer = web.getUrl();
        File dir = new File(ArkPlugin.dataDir(this), "library/incoming/dl");
        io.execute(() -> {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", name);
            try {
                Downloader.Result r = Downloader.fetch(url, dir, name, ua, referer, (got, total) -> {
                    JSObject p = new JSObject();
                    p.put("id", id);
                    p.put("name", name);
                    p.put("state", "progressing");
                    p.put("received", got);
                    p.put("total", total);
                    ArkPlugin.send("download", p);
                    String pct = total > 0 ? (got * 100 / total) + "%" : (got / 1048576) + " МБ";
                    showStatus("⬇ " + name + " — " + pct);
                }, null);
                o.put("state", "completed");
                o.put("path", ArkPlugin.relPath(this, r.file));
                o.put("name", r.name);
                ArkPlugin.send("download", o);
                main.post(() -> Toast.makeText(this, "«" + r.name + "» скачано — появится на полке", Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                o.put("state", "error");
                o.put("error", e.getMessage() == null ? "ошибка сети" : e.getMessage());
                ArkPlugin.send("download", o);
                main.post(() -> Toast.makeText(this, "Не удалось скачать " + name + ": " + e.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                main.post(() -> {
                    active--;
                    if (active <= 0) showStatus(null);
                });
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        JSObject o = new JSObject();
        o.put("type", "closed");
        o.put("url", web != null && web.getUrl() != null ? web.getUrl() : "");
        ArkPlugin.send("browser", o);
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        io.shutdown();
        super.onDestroy();
    }
}
