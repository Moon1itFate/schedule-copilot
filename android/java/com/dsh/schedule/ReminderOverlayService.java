package com.dsh.schedule;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Brief user-visible overlay, rather than an always-running background timer. */
public class ReminderOverlayService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windows;
    private View capsule;
    private TextView detail;
    private ReminderSchedule.Item current;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (detail != null && current != null) detail.setText(ReminderManager.detail(current));
            handler.postDelayed(this, 1000);
        }
    };
    @Override public IBinder onBind(Intent intent) { return null; }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int color, int size) {
        TextView view = new TextView(this); view.setText(text); view.setTextColor(color); view.setTextSize(size); return view;
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        ReminderManager.channels(this);
        android.app.Notification notice = ReminderManager.builder(this, ReminderManager.SERVICE_CHANNEL)
                .setContentTitle("日程罗盘 · 提醒悬浮窗").setContentText("正在显示临近任务，稍后自动收起")
                .setOngoing(true).setContentIntent(ReminderManager.openPending(this, "")).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(4022, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(4022, notice);
        } catch (RuntimeException error) { stopSelf(); return START_NOT_STICKY; }
        if (intent == null || !Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY; }
        current = new ReminderSchedule.Item(intent.getStringExtra("id") == null ? "" : intent.getStringExtra("id"),
                intent.getStringExtra("title") == null ? "任务提醒" : intent.getStringExtra("title"),
                intent.getLongExtra("at", System.currentTimeMillis()),
                intent.getStringExtra("location") == null ? "" : intent.getStringExtra("location"));
        handler.removeCallbacksAndMessages(null);
        removeCapsule();
        windows = getSystemService(WindowManager.class);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL); root.setGravity(Gravity.TOP);
        root.setPadding(dp(18), dp(16), dp(14), dp(16));
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xf5fffaf1, 0xeffbf0e3});
        background.setCornerRadius(dp(28)); background.setStroke(dp(1), 0xffffffff); root.setBackground(background); root.setElevation(dp(14));
        TextView icon = label("◷", 0xffb28d66, 26);
        root.addView(icon, new LinearLayout.LayoutParams(dp(34), dp(38)));
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(8), 0, dp(8), 0);
        root.addView(content, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        content.addView(label("日程罗盘 · 任务临近", 0xffb28d66, 10));
        TextView title = label(current.title, 0xff6b4936, 15); title.setMaxLines(2); title.setEllipsize(TextUtils.TruncateAt.END); title.setPadding(0, dp(5), 0, dp(5)); content.addView(title);
        detail = label(ReminderManager.detail(current), 0xff8d715c, 11); content.addView(detail);
        TextView open = label("查看任务 →", 0xffa76749, 12); open.setPadding(0, dp(8), 0, 0); content.addView(open);
        View.OnClickListener openTask = view -> { startActivity(ReminderManager.openIntent(this, current.id)); stopSelf(); };
        open.setOnClickListener(openTask); root.setOnClickListener(openTask);
        TextView close = label("×", 0xff9a7d65, 23); close.setGravity(Gravity.CENTER); close.setContentDescription("关闭任务提醒");
        close.setOnClickListener(view -> stopSelf()); root.addView(close, new LinearLayout.LayoutParams(dp(30), dp(34)));
        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(24), dp(360));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        int status = getResources().getIdentifier("status_bar_height", "dimen", "android");
        params.y = (status > 0 ? getResources().getDimensionPixelSize(status) : dp(24)) + dp(8);
        try {
            capsule = root; windows.addView(capsule, params);
            root.setAlpha(0); root.setTranslationY(-dp(16)); root.animate().alpha(1).translationY(0).setDuration(250).start();
            handler.post(tick); handler.postDelayed(this::stopSelf, 30_000);
        } catch (RuntimeException error) { stopSelf(); }
        return START_NOT_STICKY;
    }
    private void removeCapsule() {
        if (capsule != null && windows != null) { try { windows.removeView(capsule); } catch (RuntimeException ignored) {} }
        capsule = null; detail = null;
    }
    @Override public void onTimeout(int startId) { stopSelf(); }
    @Override public void onDestroy() { handler.removeCallbacksAndMessages(null); removeCapsule(); stopForeground(true); super.onDestroy(); }
}
