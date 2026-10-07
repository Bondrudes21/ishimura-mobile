package com.bondrudes21.ishimura;

import net.sf.sevenzipjbinding.ExtractAskMode;
import net.sf.sevenzipjbinding.ExtractOperationResult;
import net.sf.sevenzipjbinding.IArchiveExtractCallback;
import net.sf.sevenzipjbinding.IInArchive;
import net.sf.sevenzipjbinding.ISequentialOutStream;
import net.sf.sevenzipjbinding.PropID;
import net.sf.sevenzipjbinding.SevenZip;
import net.sf.sevenzipjbinding.SevenZipException;
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;

/** Распаковка 7z / rar (включая RAR5) / zip через 7-Zip-JBinding. Сплошные (solid) архивы — за один проход. */
public class Extractor {

    public static List<String> extract(File archive, File dest) throws IOException {
        List<String> files = new ArrayList<>();
        String root = dest.getCanonicalPath() + File.separator;
        try (RandomAccessFile raf = new RandomAccessFile(archive, "r")) {
            RandomAccessFileInStream in = new RandomAccessFileInStream(raf);
            IInArchive arc = SevenZip.openInArchive(null, in);
            try {
                arc.extract(null, false, new IArchiveExtractCallback() {
                    OutputStream out;
                    String failed;

                    private void closeCurrent() throws SevenZipException {
                        if (out == null) return;
                        try { out.close(); } catch (IOException e) { throw new SevenZipException(e.getMessage()); }
                        out = null;
                    }

                    @Override
                    public ISequentialOutStream getStream(int index, ExtractAskMode mode) throws SevenZipException {
                        closeCurrent();
                        if (mode != ExtractAskMode.EXTRACT) return null;
                        Object folder = arc.getProperty(index, PropID.IS_FOLDER);
                        if (Boolean.TRUE.equals(folder)) return null;
                        Object p = arc.getProperty(index, PropID.PATH);
                        String rel = p == null ? ("file" + index) : p.toString().replace('\\', '/');
                        StringBuilder clean = new StringBuilder();
                        for (String part : rel.split("/")) {
                            if (part.isEmpty() || part.equals(".") || part.equals("..")) continue;
                            if (clean.length() > 0) clean.append('/');
                            clean.append(Downloader.sanitize(part));
                        }
                        if (clean.length() == 0) return null;
                        try {
                            File f = new File(dest, clean.toString());
                            if (!f.getCanonicalPath().startsWith(root)) return null;
                            File parent = f.getParentFile();
                            if (parent != null) //noinspection ResultOfMethodCallIgnored
                                parent.mkdirs();
                            out = new BufferedOutputStream(new FileOutputStream(f), 256 * 1024);
                            files.add(clean.toString());
                        } catch (IOException e) {
                            throw new SevenZipException(e.getMessage());
                        }
                        final OutputStream target = out;
                        return data -> {
                            try { target.write(data); } catch (IOException e) { throw new SevenZipException(e.getMessage()); }
                            return data.length;
                        };
                    }

                    @Override
                    public void prepareOperation(ExtractAskMode mode) {}

                    @Override
                    public void setOperationResult(ExtractOperationResult result) throws SevenZipException {
                        closeCurrent();
                        if (result != ExtractOperationResult.OK && failed == null) failed = result.toString();
                    }

                    @Override
                    public void setTotal(long total) {}

                    @Override
                    public void setCompleted(long complete) {}
                });
            } finally {
                arc.close();
            }
        } catch (SevenZipException e) {
            throw new IOException(e.getMessage() == null ? "архив повреждён или защищён паролем" : e.getMessage());
        }
        if (files.isEmpty()) throw new IOException("архив пуст или защищён паролем");
        return files;
    }
}
