package com.dsh.schedule;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Atomic private files survive process death and app upgrades. No desktop service is involved. */
public final class PhoneStorage {
    private static AtomicFile file(Context c, String key) {
        if (!"state".equals(key) && !"settings".equals(key)) throw new IllegalArgumentException("Invalid key");
        return new AtomicFile(new File(c.getFilesDir(), "phone-" + key + ".json"));
    }
    public static synchronized String read(Context c, String key) throws Exception {
        AtomicFile value = file(c, key);
        try { return new String(value.readFully(), StandardCharsets.UTF_8); }
        catch (FileNotFoundException absent) {
            if (!"state".equals(key)) return "";
            try (InputStream input = c.getAssets().open("web/initial-state.json")) {
                String seed = readText(input, 10 * 1024 * 1024); write(c, key, seed); return seed;
            } catch (FileNotFoundException noSeed) { return ""; }
        }
    }
    public static synchronized void write(Context c, String key, String raw) throws Exception {
        if (raw.length() > 10 * 1024 * 1024) throw new IOException("数据超过10MB");
        JSONObject parsed = new JSONObject(raw);
        if ("state".equals(key) && (!parsed.has("term") || !parsed.has("courses") || !parsed.has("tasks"))) throw new IOException("数据格式无效");
        AtomicFile value = file(c, key); FileOutputStream output = null;
        try { output = value.startWrite(); output.write(raw.getBytes(StandardCharsets.UTF_8)); value.finishWrite(output); }
        catch (Exception error) { if (output != null) value.failWrite(output); throw error; }
    }
    public static String readText(InputStream input, int max) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] bytes = new byte[8192]; int n;
        while ((n = input.read(bytes)) != -1) { output.write(bytes, 0, n); if (output.size() > max) throw new IOException("返回内容过大"); }
        return output.toString("UTF-8");
    }
}
