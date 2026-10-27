package com.dsh.schedule;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class ReminderScheduleTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        long now = 100000000L;
        ReminderSchedule.Item soon = new ReminderSchedule.Item("a", "Soon", now + 10 * 60000, "Room");
        ReminderSchedule.Item later = new ReminderSchedule.Item("b", "Later", now + 60 * 60000, "");
        ReminderSchedule.Item expired = new ReminderSchedule.Item("c", "Expired", now - 1, "");
        Set<String> sent = new HashSet<>();
        List<ReminderSchedule.Item> items = Arrays.asList(later, expired, soon);
        check(ReminderSchedule.next(items, sent, now, 5) == now + 5 * 60000, "nearest alarm uses the lead time");
        check(ReminderSchedule.next(items, sent, now, 15) == now + 1000, "newly synced task already in lead window alerts promptly");
        check(ReminderSchedule.due(items, sent, now, 15).size() == 1, "no expired or distant reminders");
        sent.add(soon.key());
        check(ReminderSchedule.due(items, sent, now, 15).isEmpty(), "delivered reminders never repeat");
        check(ReminderSchedule.next(items, sent, now, 15) == now + 45 * 60000, "next task is scheduled after delivery");
        check(ReminderSchedule.due(items, sent, now, 30).isEmpty(), "changing lead time does not duplicate a delivered task");
        check(ReminderSchedule.next(Collections.emptyList(), sent, now, 15) == -1, "deleted or completed cache has no alarm");
        ReminderSchedule.Item changed = new ReminderSchedule.Item("a", "Rescheduled", now + 12 * 60000, "");
        check(ReminderSchedule.due(Arrays.asList(changed), sent, now, 15).size() == 1, "rescheduled task has a new delivery key");
        ReminderSchedule.Item together = new ReminderSchedule.Item("d", "Same time", soon.at, "");
        check(ReminderSchedule.due(Arrays.asList(soon, together), new HashSet<>(), now, 15).size() == 2, "simultaneous tasks are batched");
        System.out.println("Android reminder planner: 9 checks passed");
    }
}
