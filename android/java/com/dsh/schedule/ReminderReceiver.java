package com.dsh.schedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (ReminderManager.ALARM.equals(intent.getAction())) {
            ReminderManager.deliver(context);
            final PendingResult pending = goAsync();
            ReminderManager.sync(context, () -> pending.finish());
        }
    }
}
