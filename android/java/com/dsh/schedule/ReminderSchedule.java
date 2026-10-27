package com.dsh.schedule;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/** Pure Java alarm planning, also runnable in the desktop test harness. */
public final class ReminderSchedule {
    public static final class Item {
        public final String id, title, location;
        public final long at;
        public Item(String id, String title, long at, String location) {
            this.id = id; this.title = title; this.at = at; this.location = location;
        }
        public String key() { return id + "@" + at; }
    }
    public static long trigger(Item item, int minutes) { return item.at - minutes * 60000L; }
    public static List<Item> pending(List<Item> items, Set<String> delivered, long now) {
        List<Item> result = new ArrayList<>();
        for (Item item : items) if (item.at > now && !delivered.contains(item.key())) result.add(item);
        Collections.sort(result, Comparator.comparingLong(item -> item.at));
        return result;
    }
    public static long next(List<Item> items, Set<String> delivered, long now, int minutes) {
        List<Item> waiting = pending(items, delivered, now);
        return waiting.isEmpty() ? -1 : Math.max(now + 1000L, trigger(waiting.get(0), minutes));
    }
    public static List<Item> due(List<Item> items, Set<String> delivered, long now, int minutes) {
        List<Item> result = new ArrayList<>();
        for (Item item : pending(items, delivered, now)) if (trigger(item, minutes) <= now) result.add(item);
        return result;
    }
}
