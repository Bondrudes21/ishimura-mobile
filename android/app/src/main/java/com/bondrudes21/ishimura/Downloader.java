package com.bondrudes21.ishimura;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Скачивание файла по ссылке с куками встроенного браузера (нужны многим сайтам с книгами). */
public class Downloader {

    public static final String UA =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

    public interface Progress {
        void on(long received, long total);
    }

    public static class Result {
        public File file;
        public String name;
        public String mime;
        public long size;
    }

    /** Имя файла из Content-Disposition (filename*=UTF-8''… важнее filename=…). */
    public static String nameFromDisposition(String cd) {
        if (cd == null) return null;
        Matcher m = Pattern.compile("filename\\*\\s*=\\s*([\\w-]+)''([^;]+)", Pattern.CASE_INSENSITIVE).matcher(cd);
        if (m.find()) {
            try {
                return URLDecoder.decode(m.group(2).trim().replace("+", "%2B"), m.group(1));
            } catch (Exception ignored) {}
        }
        m = Pattern.compile("filename\\s*=\\s*\"?([^\";]+)\"?", Pattern.CASE_INSENSITIVE).matcher(cd);
        if (m.find()) return fixLatin1(m.group(1).trim());
        return null;
    }

    /** Заголовки HTTP читаются как ISO-8859-1 — UTF-8 имена превращаются в «кракозябры». Чиним. */
    static String fixLatin1(String s) {
        if (s == null) return null;
        boolean high = false;
        for (char c : s.toCharArray()) {
            if (c > 0xFF) return s;
            if (c >= 0x80) high = true;
        }
        if (!high) return s;
        String utf = new String(s.getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
        return utf.contains("\uFFFD") ? s : utf;
    }

    public static String guessName(String url, String cd, String mime) {
        String name = nameFromDisposition(cd);
        if (name == null || name.isEmpty()) {
            String last = Uri.parse(url).getLastPathSegment();
            name = last == null || last.isEmpty() ? "download" : last;
        }
        name = sanitize(name);
        if (!name.matches(".*\\.[A-Za-z0-9]{2,5}$") && mime != null) {
            String m = mime.split(";")[0].trim().toLowerCase(Locale.ROOT);
            String ext = byMime(m);
            if (ext == null) ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(m);
            if (ext != null) name = name + "." + ext;
        }
        return name;
    }

    static String byMime(String m) {
        switch (m) {
            case "application/epub+zip": return "epub";
            case "application/x-fictionbook+xml":
            case "application/x-fictionbook":
            case "application/fb2": return "fb2";
            case "application/x-zip-compressed-fb2":
            case "application/fb2+zip": return "fb2.zip";
            case "application/pdf": return "pdf";
            case "application/x-7z-compressed": return "7z";
            case "application/x-rar-compressed":
            case "application/vnd.rar": return "rar";
            case "application/zip":
            case "application/x-zip-compressed": return "zip";
            case "audio/mpeg": return "mp3";
            case "audio/mp4":
            case "audio/x-m4b": return "m4b";
            default: return null;
        }
    }

    public static String sanitize(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_").trim();
        if (s.length() > 150) {
            int dot = s.lastIndexOf('.');
            String ext = dot > 0 && s.length() - dot <= 8 ? s.substring(dot) : "";
            s = s.substring(0, 150 - ext.length()) + ext;
        }
        return s.isEmpty() ? "file" : s;
    }

    public static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; ; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
    }

    private static void storeCookies(String url, HttpURLConnection c) {
        try {
            Map<String, List<String>> headers = c.getHeaderFields();
            List<String> set = headers.get("Set-Cookie");
            if (set == null) set = headers.get("set-cookie");
            if (set == null) return;
            CookieManager cm = CookieManager.getInstance();
            for (String v : set) cm.setCookie(url, v);
        } catch (Exception ignored) {}
    }

    /**
     * Скачать url в папку dir. name — заранее известное имя (или null).
     * Следует за переадресациями (в т.ч. https → http), передаёт куки и User-Agent браузера.
     */
    public static Result fetch(String url, File dir, String name, String ua, String referer, Progress progress, AtomicBoolean cancel)
        throws IOException {
        String cur = url;
        HttpURLConnection c = null;
        for (int i = 0; i < 10; i++) {
            URL u = new URL(cur);
            c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(30000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", ua != null ? ua : UA);
            c.setRequestProperty("Accept", "*/*");
            String cookie = CookieManager.getInstance().getCookie(cur);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            if (referer != null) c.setRequestProperty("Referer", referer);
            int code = c.getResponseCode();
            storeCookies(cur, c);
            String loc = c.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc != null) {
                cur = new URL(u, loc).toString();
                c.disconnect();
                continue;
            }
            if (code >= 400) {
                c.disconnect();
                throw new IOException("Сервер ответил " + code);
            }
            break;
        }
        if (c == null) throw new IOException("Слишком много переадресаций");
        String mime = c.getContentType();
        String finalName = name != null ? sanitize(name) : guessName(cur, c.getHeaderField("Content-Disposition"), mime);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Нет доступа к папке загрузок");
        File out = unique(dir, finalName);
        long total = c.getContentLengthLong();
        long got = 0;
        long lastReport = 0;
        try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (cancel != null && cancel.get()) throw new IOException("Отменено");
                os.write(buf, 0, n);
                got += n;
                long now = System.currentTimeMillis();
                if (progress != null && now - lastReport > 400) {
                    lastReport = now;
                    progress.on(got, total);
                }
            }
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            throw e;
        } finally {
            c.disconnect();
        }
        if (progress != null) progress.on(got, total);
        Result r = new Result();
        r.file = out;
        r.name = out.getName();
        r.mime = mime;
        r.size = got;
        return r;
    }
}
