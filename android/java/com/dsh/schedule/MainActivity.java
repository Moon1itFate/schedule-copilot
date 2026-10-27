package com.dsh.schedule;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.*;
import android.view.*;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Bundled offline UI, private phone storage, and opt-in direct model networking. */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String exportText;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private static boolean trusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1;
    }
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        ReminderManager.channels(this);
        getWindow().setStatusBarColor(Color.parseColor("#fff0df"));
        getWindow().setNavigationBarColor(Color.parseColor(Build.VERSION.SDK_INT >= 26 ? "#fff0df" : "#8f6c56"));
        int appearance = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) appearance |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(appearance);
        web = new WebView(this); web.setBackgroundColor(Color.parseColor("#fff4e7"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ScheduleCopilot/0.6 Standalone");
        web.addJavascriptInterface(new PhoneBridge(), "Phone");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // No remote documents, subframes or scripts ever run in the privileged WebView.
                if (!trusted(uri)) return blocked();
                String path = uri.getPath();
                if (path == null || path.contains("..") || path.contains("\\") || path.endsWith(".json")) return blocked();
                if ("/".equals(path)) path = "/index.html";
                try {
                    InputStream input = getAssets().open("web" + path);
                    String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : path.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, input);
                } catch (IOException error) { return blocked(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return navigate(request.getUrl(), request.isForMainFrame()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return navigate(Uri.parse(url), true); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) Toast.makeText(MainActivity.this, "本地页面加载失败，请重新打开 App", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定", (d,w) -> result.confirm())
                        .setNegativeButton("取消", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 1001); return true; }
                catch (Exception error) { fileCallback = null; return false; }
            }
        });
        setContentView(web); loadTask(getIntent());
    }
    private WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    private boolean navigate(Uri uri, boolean main) {
        if ("schedulecopilot".equals(uri.getScheme())) {
            if (main && trusted(Uri.parse(web.getUrl())) && "reminder-settings".equals(uri.getHost())) ReminderSettings.show(this);
            return true;
        }
        if (trusted(uri)) return false;
        if (main && ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
        }
        return true;
    }
    private void loadTask(Intent intent) {
        String id = intent.getStringExtra("task_id");
        web.loadUrl(ORIGIN + "/" + (id == null ? "" : "?task=" + Uri.encode(id)));
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); loadTask(intent); }
    @Override protected void onResume() { super.onResume(); ReminderManager.sync(this, null); ReminderManager.job(this); }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) { super.onRequestPermissionsResult(code, permissions, results); ReminderManager.sync(this, null); }
    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add("任务提醒"); menu.add("关于"); return true;
    }
    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if ("任务提醒".contentEquals(item.getTitle())) ReminderSettings.show(this);
        else new AlertDialog.Builder(this).setTitle("日程罗盘 0.6.4").setMessage("手机独立版\n课表、待办、作息和提醒离线可用。\nAI 由手机联网调用设置中的模型接口。\n在设置中导出备份可保护本机数据。").setPositiveButton("好", null).show();
        return true;
    }
    public final class PhoneBridge {
        @JavascriptInterface public String read(String key) {
            try { return PhoneStorage.read(MainActivity.this, key); }
            catch (Exception error) { return "!storage-error"; }
        }
        @JavascriptInterface public boolean write(String key, String value) {
            try { PhoneStorage.write(MainActivity.this, key, value); if ("state".equals(key)) ReminderManager.sync(MainActivity.this, null); return true; }
            catch (Exception error) { return false; }
        }
        @JavascriptInterface public void exportFile(String name, String mime, String text) {
            runOnUiThread(() -> {
                if (exportText != null) { Toast.makeText(MainActivity.this, "请先完成上一次导出", Toast.LENGTH_SHORT).show(); return; }
                exportText = text;
                try { startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name), 1002); }
                catch (Exception error) { exportText = null; Toast.makeText(MainActivity.this, "无法打开文件保存界面", Toast.LENGTH_LONG).show(); }
            });
        }
        @JavascriptInterface public void http(String id, String address, String raw) {
            network.execute(() -> {
                JSONObject result = new JSONObject(); HttpURLConnection connection = null;
                try {
                    URL url = new URL(address);
                    if (!"https".equals(url.getProtocol())) throw new IOException("手机模型接口须使用 HTTPS 地址");
                    JSONObject options = new JSONObject(raw);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(15000); connection.setReadTimeout(120000);
                    connection.setRequestMethod(options.optString("method", "GET"));
                    JSONObject headers = options.optJSONObject("headers");
                    if (headers != null) for (Iterator<String> keys = headers.keys(); keys.hasNext();) { String key = keys.next(); connection.setRequestProperty(key, headers.getString(key)); }
                    String body = options.optString("body", "");
                    if (!body.isEmpty()) { connection.setDoOutput(true); try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); } }
                    int status = connection.getResponseCode();
                    try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                        result.put("status", status); result.put("body", input == null ? "" : PhoneStorage.readText(input, 8 * 1024 * 1024));
                        result.put("contentType", connection.getContentType());
                    }
                } catch (Exception error) { try { result.put("error", "手机联网失败：" + error.getMessage()); } catch (Exception ignored) {} }
                finally { if (connection != null) connection.disconnect(); }
                final String response = result.toString();
                runOnUiThread(() -> { if (web != null && trusted(Uri.parse(web.getUrl()))) web.evaluateJavascript("window.phoneHttpResult && window.phoneHttpResult(" + JSONObject.quote(id) + "," + JSONObject.quote(response) + ")", null); });
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1001 && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null; }
        if (request == 1002) {
            final String text = exportText; exportText = null;
            if (result == RESULT_OK && data != null && data.getData() != null && text != null) {
                final Uri uri = data.getData(); network.execute(() -> {
                    try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                        if (output == null) throw new IOException("文件不可写"); output.write(text.getBytes(StandardCharsets.UTF_8));
                        runOnUiThread(() -> Toast.makeText(this, "已导出", Toast.LENGTH_SHORT).show());
                    } catch (Exception error) { runOnUiThread(() -> Toast.makeText(this, "导出失败：" + error.getMessage(), Toast.LENGTH_LONG).show()); }
                });
            }
        }
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() {
        network.shutdownNow();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("Phone"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
