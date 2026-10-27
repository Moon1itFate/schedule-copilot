package com.dsh.schedule;

import android.app.job.JobParameters;
import android.app.job.JobService;

public class ReminderSyncJob extends JobService {
    private volatile boolean active;
    @Override public boolean onStartJob(JobParameters params) {
        if (!ReminderManager.enabled(this)) return false;
        active = true;
        ReminderManager.sync(this, () -> { if (active) jobFinished(params, false); });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { active = false; return ReminderManager.enabled(this); }
}
