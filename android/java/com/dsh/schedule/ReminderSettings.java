package com.dsh.schedule;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

public final class ReminderSettings {
    private static void launch(Activity a, Intent intent) {
        try { a.startActivity(intent); } catch (RuntimeException error) { Toast.makeText(a, "请到系统设置中手动授予权限", Toast.LENGTH_LONG).show(); }
    }
    public static void show(Activity a) {
        LinearLayout panel = new LinearLayout(a); panel.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(18 * a.getResources().getDisplayMetrics().density); panel.setPadding(padding, padding / 2, padding, padding / 2);
        CheckBox enabled = new CheckBox(a); enabled.setText("开启临近任务提醒"); enabled.setChecked(ReminderManager.enabled(a)); panel.addView(enabled);
        TextView leadLabel = new TextView(a); leadLabel.setText("提前多久提醒"); leadLabel.setPadding(0, padding / 2, 0, 0); panel.addView(leadLabel);
        int[] minutes = {5, 10, 15, 30, 60};
        Spinner lead = new Spinner(a);
        lead.setAdapter(new ArrayAdapter<String>(a, android.R.layout.simple_spinner_dropdown_item, new String[]{"5 分钟", "10 分钟", "15 分钟", "30 分钟", "60 分钟"}));
        for (int i = 0; i < minutes.length; i++) if (minutes[i] == ReminderManager.lead(a)) lead.setSelection(i);
        panel.addView(lead);
        CheckBox overlay = new CheckBox(a); overlay.setText("同时显示顶部胶囊悬浮窗"); overlay.setChecked(ReminderManager.prefs(a).getBoolean("reminder_overlay", true)); panel.addView(overlay);
        TextView info = new TextView(a); info.setTextSize(12); info.setText("任务按开始时间提醒，未设开始则按截止时间；全天任务在当天 09:00 提醒。\n任务直接保存在手机，修改后立即更新本地提醒；省电限制可能延迟通知。悬浮窗显示 30 秒，可点开任务或关闭。\n"); panel.addView(info);
        TextView status = new TextView(a); status.setTextSize(12); status.setText(ReminderManager.status(a)); panel.addView(status);
        Button notifications = new Button(a); notifications.setText("1. 通知权限"); panel.addView(notifications);
        notifications.setOnClickListener(view -> {
            if (Build.VERSION.SDK_INT >= 33 && a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4023);
            else launch(a, new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()));
        });
        Button draw = new Button(a); draw.setText("2. 悬浮窗权限"); panel.addView(draw);
        draw.setOnClickListener(view -> launch(a, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + a.getPackageName()))));
        Button exact = new Button(a); exact.setText("3. 精确提醒权限"); panel.addView(exact);
        exact.setOnClickListener(view -> {
            if (Build.VERSION.SDK_INT >= 31) launch(a, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + a.getPackageName())));
            else Toast.makeText(a, "此版本安卓无需额外授权精确提醒", Toast.LENGTH_SHORT).show();
        });
        Button sync = new Button(a); sync.setText("刷新手机提醒"); panel.addView(sync);
        sync.setOnClickListener(view -> {
            if (!ReminderManager.enabled(a)) { Toast.makeText(a, "请先保存并开启提醒", Toast.LENGTH_SHORT).show(); return; }
            status.setText("正在读取手机任务…"); ReminderManager.sync(a, () -> a.runOnUiThread(() -> status.setText(ReminderManager.status(a))));
        });
        Button test = new Button(a); test.setText("试发一条提醒"); panel.addView(test);
        test.setOnClickListener(view -> {
            if (!ReminderManager.notificationsAllowed(a)) { Toast.makeText(a, "请先授予通知权限", Toast.LENGTH_LONG).show(); return; }
            // Preview uses the saved overlay setting, so it matches real scheduled delivery.
            ReminderManager.show(a, new ReminderSchedule.Item("preview", "这是你的任务提醒", System.currentTimeMillis() + 15 * 60000L, "点击可打开日程罗盘"), true);
            if (!Settings.canDrawOverlays(a)) Toast.makeText(a, "已发送通知；允许悬浮窗后可显示顶部胶囊", Toast.LENGTH_LONG).show();
        });
        ScrollView scroll = new ScrollView(a); scroll.addView(panel);
        new AlertDialog.Builder(a).setTitle("任务提醒 · 流动岛").setView(scroll).setNegativeButton("取消", null)
                .setPositiveButton("保存", (dialog, which) -> {
                    ReminderManager.prefs(a).edit().putBoolean("reminder_enabled", enabled.isChecked()).putInt("reminder_minutes", minutes[lead.getSelectedItemPosition()])
                            .putBoolean("reminder_overlay", overlay.isChecked()).apply();
                    if (!enabled.isChecked() || !overlay.isChecked()) a.stopService(new Intent(a, ReminderOverlayService.class));
                    if (!enabled.isChecked()) a.getSystemService(NotificationManager.class).cancelAll();
                    ReminderManager.schedule(a); ReminderManager.job(a); ReminderManager.sync(a, null);
                    Toast.makeText(a, enabled.isChecked() ? "提醒已开启，请确认三项权限；可重新打开查看本地提醒状态" : "提醒已关闭", Toast.LENGTH_LONG).show();
                }).show();
    }
}
