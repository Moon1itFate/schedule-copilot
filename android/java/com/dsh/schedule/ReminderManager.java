package com.dsh.schedule;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ReminderManager {
    static final String ALARM = "com.dsh.schedule.REMIND";
    static final String CHANNEL = "task-reminders-v1";
    static final String SERVICE_CHANNEL = "reminder-capsule-v1";
    static final int JOB = 4021;
    static final ExecutorService IO = Executors.newSingleThreadExecutor();
    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences("schedule", Context.MODE_PRIVATE); }
    public static boolean enabled(Context c) { return prefs(c).getBoolean("reminder_enabled", false); }
    public static int lead(Context c) { return prefs(c).getInt("reminder_minutes", 15); }
    public static boolean notificationsAllowed(Context c) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }
    public static boolean exactAllowed(Context c) {
        return Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }
    public static void channels(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = c.getSystemService(NotificationManager.class);
            NotificationChannel tasks = new NotificationChannel(CHANNEL, "临近任务提醒", NotificationManager.IMPORTANCE_HIGH);
            tasks.setDescription("任务临近时的声音和顶部横幅提醒");
            manager.createNotificationChannel(tasks);
            manager.createNotificationChannel(new NotificationChannel(SERVICE_CHANNEL, "提醒悬浮窗", NotificationManager.IMPORTANCE_LOW));
        }
    }
    static Notification.Builder builder(Context c, String channel) {
        return (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel) : new Notification.Builder(c))
                .setSmallIcon(R.drawable.ic_reminder).setColor(0xffca9469);
    }
    public static Intent openIntent(Context c, String id) {
        Intent intent = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (id != null && !id.isEmpty()) intent.putExtra("task_id", id);
        return intent;
    }
    public static PendingIntent openPending(Context c, String id) {
        Intent intent = openIntent(c, id);
        intent.setData(Uri.parse("schedulecopilot://task/" + Uri.encode(id == null ? "" : id)));
        return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    public static String detail(ReminderSchedule.Item item) {
        long left = Math.max(0, (item.at - System.currentTimeMillis() + 59999) / 60000);
        String time = new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(item.at));
        return (left > 0 ? "还有 " + left + " 分钟" : "任务已到时") + " · " + time + (item.location.isEmpty() ? "" : " · " + item.location);
    }
    public static boolean show(Context c, ReminderSchedule.Item item, boolean test) {
        if (!notificationsAllowed(c)) return false;
        channels(c);
        Notification notice = builder(c, CHANNEL).setContentTitle(test ? "提醒测试 · " + item.title : item.title)
                .setContentText(detail(item)).setStyle(new Notification.BigTextStyle().bigText(detail(item)))
                .setCategory(Notification.CATEGORY_EVENT).setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true)
                .setContentIntent(openPending(c, test ? null : item.id)).build();
        try { c.getSystemService(NotificationManager.class).notify(item.key(), 1, notice); }
        catch (SecurityException ignored) { return false; }
        if (prefs(c).getBoolean("reminder_overlay", true) && Settings.canDrawOverlays(c)) {
            Intent intent = new Intent(c, ReminderOverlayService.class).putExtra("id", test ? "" : item.id)
                    .putExtra("title", item.title).putExtra("at", item.at).putExtra("location", item.location);
            try {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent); else c.startService(intent);
            } catch (RuntimeException ignored) { /* System restrictions: the normal notification remains available. */ }
        }
        return true;
    }
    static List<ReminderSchedule.Item> cached(Context c) {
        List<ReminderSchedule.Item> items = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs(c).getString("reminder_cache", "[]"));
            for (int i = 0; i < Math.min(100, array.length()); i++) {
                JSONObject value = array.getJSONObject(i);
                items.add(new ReminderSchedule.Item(value.getString("id"), value.getString("title"), value.getLong("at"), value.optString("location", "")));
            }
        } catch (Exception ignored) { /* A broken cache is replaced on the next successful sync. */ }
        return items;
    }
    static Set<String> delivered(Context c) { return new HashSet<>(prefs(c).getStringSet("reminder_delivered", new HashSet<>())); }
    static PendingIntent alarmIntent(Context c) {
        return PendingIntent.getBroadcast(c, 0, new Intent(c, ReminderReceiver.class).setAction(ALARM), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    public static synchronized void schedule(Context c) {
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        PendingIntent intent = alarmIntent(c);
        alarms.cancel(intent);
        if (!enabled(c) || !notificationsAllowed(c)) return;
        long at = ReminderSchedule.next(cached(c), delivered(c), System.currentTimeMillis(), lead(c));
        if (at < 0) return;
        try {
            if (exactAllowed(c)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        } catch (SecurityException ignored) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        }
    }
    public static synchronized void deliver(Context c) {
        if (!enabled(c) || !notificationsAllowed(c)) { schedule(c); return; }
        Set<String> sent = delivered(c);
        List<ReminderSchedule.Item> due = ReminderSchedule.due(cached(c), sent, System.currentTimeMillis(), lead(c));
        for (ReminderSchedule.Item item : due) {
            if (show(c, item, false)) sent.add(item.key());
        }
        prefs(c).edit().putStringSet("reminder_delivered", sent).apply();
        schedule(c);
    }
    public static void job(Context c) {
        // Local writes and boot/time-change receivers refresh alarms; no network polling job.
        c.getSystemService(JobScheduler.class).cancel(JOB);
    }
    public static void sync(Context context, Runnable finished) {
        Context c = context.getApplicationContext();
        IO.execute(() -> {
            try {
                String raw = PhoneStorage.read(c, "state");
                JSONArray tasks = raw.isEmpty() ? new JSONArray() : new JSONObject(raw).getJSONArray("tasks");
                List<JSONObject> future = new ArrayList<>();
                SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US);
                format.setLenient(false);
                long now = System.currentTimeMillis();
                for (int i = 0; i < tasks.length(); i++) {
                    JSONObject task = tasks.getJSONObject(i);
                    if (task.optBoolean("done", false)) continue;
                    String date = task.optString("start", "");
                    if (date.isEmpty()) date = task.optString("due", "");
                    if (date.isEmpty()) continue;
                    if (task.optBoolean("allDay", false) || date.length() == 10) date = date.substring(0,10) + "T09:00";
                    long at;
                    try { at = format.parse(date).getTime(); } catch (Exception invalid) { continue; }
                    if (at <= now) continue;
                    future.add(new JSONObject().put("id", task.getString("id")).put("title", task.getString("title"))
                            .put("at", at).put("location", task.optString("location", "")));
                }
                Collections.sort(future, (a,b) -> Long.compare(a.optLong("at"), b.optLong("at")));
                JSONArray array = new JSONArray();
                for (int i = 0; i < Math.min(100, future.size()); i++) array.put(future.get(i));
                synchronized (ReminderManager.class) {
                    Set<String> sent = delivered(c), keys = new HashSet<>();
                    for (int i = 0; i < array.length(); i++) { JSONObject item = array.getJSONObject(i); keys.add(item.getString("id") + "@" + item.getLong("at")); }
                    for (ReminderSchedule.Item old : cached(c)) if (!keys.contains(old.key())) c.getSystemService(NotificationManager.class).cancel(old.key(), 1);
                    sent.retainAll(keys);
                    prefs(c).edit().putString("reminder_cache", array.toString()).putStringSet("reminder_delivered", sent)
                            .putLong("reminder_sync_at", System.currentTimeMillis()).putString("reminder_sync_error", "").apply();
                    schedule(c);
                }
            } catch (Exception error) {
                prefs(c).edit().putString("reminder_sync_error", "读取手机任务失败：" + error.getMessage()).apply();
            } finally { if (finished != null) finished.run(); }
        });
    }
    public static String status(Context c) {
        long at = prefs(c).getLong("reminder_sync_at", 0);
        return "通知：" + (notificationsAllowed(c) ? "已允许" : "未允许")
                + "   悬浮窗：" + (Settings.canDrawOverlays(c) ? "已允许" : "未允许")
                + "\n精确提醒：" + (exactAllowed(c) ? "已允许" : "未允许，系统可能延迟")
                + "\n手机本地 " + cached(c).size() + " 个任务 · " + (at > 0 ? new SimpleDateFormat("M/d HH:mm", Locale.CHINA).format(new Date(at)) : "尚未读取")
                + "\n" + prefs(c).getString("reminder_sync_error", "");
    }
    public static synchronized void serverChanged(Context c) {
        c.getSystemService(AlarmManager.class).cancel(alarmIntent(c));
        prefs(c).edit().remove("reminder_cache").remove("reminder_delivered").remove("reminder_sync_at").apply();
        c.getSystemService(NotificationManager.class).cancelAll();
        c.stopService(new Intent(c, ReminderOverlayService.class));
    }
}
