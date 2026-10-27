package com.dsh.schedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderRestoreReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !Intent.ACTION_TIME_CHANGED.equals(action) && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                && !"android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) return;
        final PendingResult pending = goAsync();
        ReminderManager.sync(context, () -> pending.finish());
        ReminderManager.job(context);
    }
}
