import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Course, Task } from '../types';
import { addDays, fmtDate, fmtShortDate, fromMinutes, isSameDay, mondayOf, parseLocal, toMinutes, WEEKDAY_SHORT } from '../lib/date';
import { periodTimeline, shortTime } from '../lib/periods';
import { IconPin } from './Icons';

const KIND_COLOR: Record<string, string> = {
  contest: '#c58b70',
  exam: '#ca8a87',
  task: '#d2a05e',
  other: '#a1ab7b',
};

const KIND_RGB: Record<string, string> = {
  contest: '217, 165, 137',
  exam: '222, 165, 151',
  task: '232, 192, 130',
  other: '185, 193, 149',
};

const COURSE_HUES = [28, 42, 15, 52, 350, 78, 33, 20, 65, 8];

function hueFor(index: number): number {
  return COURSE_HUES[index % COURSE_HUES.length];
}

function isTimedTask(task: Task): boolean {
  if (task.allDay) return false;
  if (task.start && task.end) return true;
  if (task.kind !== 'contest' && task.kind !== 'exam') return false;
  const time = (task.due ?? '').slice(11, 16);
  return Boolean(time) && time !== '23:59' && time !== '00:00';
}

interface Block {
  id: string;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  border: string;
  tint: string;
  kind: 'course' | 'task';
  item: Course | Task;
}

interface Props {
  state: AppState;
  week: number;
  today: Date;
  onChangeWeek: (direction: number) => void;
  onEditCourse: (course: Course) => void;
  onEditTask: (task: Task) => void;
  onImport: () => void;
  onEditPeriods: (period?: number) => void;
}

export function WeekGrid(props: Props) {
  const { state, week, onChangeWeek } = props;
  const [previewDirection, setPreviewDirection] = useState(0);
  const swipe = useRef<{ x: number; y: number; id: number; base: number; axis: 'pending' | 'x' | 'y'; offset: number } | null>(null);
  const suppressClick = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const previousWeek = useRef(week);
  const motion = useRef<Animation | null>(null);
  const released = useRef(false);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stopMotion = () => { motion.current?.cancel(); motion.current = null; };
  const bounce = () => {
    const node = content.current;
    if (!node) return;
    const from = node.style.transform || 'translateX(0)';
    stopMotion(); node.style.transform = '';
    if (from === 'translateX(0)' || reducedMotion()) { setPreviewDirection(0); return; }
    motion.current = node.animate([{ transform: from }, { transform: 'translateX(0)' }], {
      duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    motion.current.onfinish = () => setPreviewDirection(0);
  };
  useLayoutEffect(() => {
    const direction = Math.sign(week - previousWeek.current);
    previousWeek.current = week;
    const node = content.current;
    stopMotion();
    if (node) node.style.transform = '';
    setPreviewDirection(0);
    if (released.current || !direction || !node || reducedMotion()) { released.current = false; return () => stopMotion(); }
    const distance = Math.min(64, Math.max(28, node.clientWidth * 0.1));
    const animation = node.animate([
      { transform: `translateX(${direction * distance}px)`, opacity: 0.7 },
      { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    motion.current = animation;
    return () => { stopMotion(); if (node) node.style.transform = ''; };
  }, [week]);
  return (
    <div className="week-scroll" tabIndex={0} role="region" aria-label="周课表，左右滑动切换周次"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChangeWeek(e.key === 'ArrowLeft' ? -1 : 1); }
      }}
      onPointerDown={(e) => {
        if (!e.isPrimary) { swipe.current = null; bounce(); return; }
        const node = content.current;
        const base = previewDirection && node ? new DOMMatrix(getComputedStyle(node).transform).m41 : 0;
        stopMotion();
        if (node) node.style.transform = base ? `translateX(${base}px)` : '';
        swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, base, axis: 'pending', offset: base };
      }}
      onPointerMove={(e) => {
        const start = swipe.current, node = content.current;
        if (!start || !node || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (start.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
          start.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
          if (start.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (start.axis !== 'x') return;
        const displacement = dx + start.base;
        const direction = displacement < 0 ? 1 : -1;
        const boundary = week + direction < 1 || week + direction > state.term.totalWeeks;
        setPreviewDirection(boundary ? 0 : direction);
        start.offset = Math.max(-node.clientWidth * 0.98, Math.min(node.clientWidth * 0.98, displacement * (boundary ? 0.28 : 1)));
        node.style.transform = `translateX(${start.offset}px)`;
      }}
      onPointerCancel={() => { swipe.current = null; bounce(); }}
      onLostPointerCapture={(e) => { if (e.target === e.currentTarget && swipe.current) { swipe.current = null; bounce(); } }}
      onPointerUp={(e) => {
        const start = swipe.current; swipe.current = null;
        if (!start || start.id !== e.pointerId) return;
        if (start.axis !== 'x') { if (start.base) bounce(); return; }
        suppressClick.current = Date.now() + 500;
        const node = content.current;
        if (!node) return;
        const dx = e.clientX - start.x + start.base;
        const direction = dx < 0 ? 1 : -1;
        const threshold = Math.max(50, Math.min(110, e.currentTarget.clientWidth * 0.22));
        if (Math.abs(dx) < threshold || week + direction < 1 || week + direction > state.term.totalWeeks) { bounce(); return; }
        stopMotion();
        if (reducedMotion()) { released.current = true; node.style.transform = ''; onChangeWeek(direction); return; }
        const animation = node.animate([
          { transform: `translateX(${start.offset}px)` },
          { transform: `translateX(${-direction * node.clientWidth}px)` },
        ], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
        motion.current = animation;
        animation.onfinish = () => { released.current = true; onChangeWeek(direction); };
      }}
      onClickCapture={(e) => { if (Date.now() < suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}>

      <div className="week-pages" ref={content}>
        <WeekPage {...props} />
        {previewDirection !== 0 && week + previewDirection >= 1 && week + previewDirection <= state.term.totalWeeks ? (
          <div className="week-neighbor" style={{ left: `${previewDirection * 100}%` }} aria-hidden="true" inert>
            <WeekPage {...props} week={week + previewDirection} preview />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WeekPage({ state, week, today, onEditCourse, onEditTask, onImport, onEditPeriods, preview = false }: Props & { preview?: boolean }) {
  const { days, timeline } = useMemo(() => {
    const monday = addDays(mondayOf(parseLocal(state.term.startDate)), (Math.max(1, week) - 1) * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const ranges = state.courses.filter((course) => course.weeks.includes(week)).map((course) => ({ start: toMinutes(course.startTime), end: toMinutes(course.endTime) }));
    for (const task of state.tasks) {
      const date = (task.start ?? task.due ?? '').slice(0, 10);
      if (!isTimedTask(task) || date < fmtDate(days[0]) || date > fmtDate(days[6])) continue;
      const start = toMinutes((task.start ?? task.due ?? '').slice(11, 16));
      ranges.push({ start, end: task.end ? Math.max(start + 1, toMinutes(task.end.slice(11, 16))) : Math.min(1440, start + (task.kind === 'exam' ? 120 : 90)) });
    }
    return { days, timeline: periodTimeline(state.term.periods, ranges) };
  }, [state, week]);
  const { height, position } = timeline;

  const now = today;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const courseHue = useMemo(() => {
    const map = new Map<string, number>();
    [...state.courses]
      .sort((a, b) => `${a.title}${a.weekday}`.localeCompare(`${b.title}${b.weekday}`, 'zh'))
      .forEach((course, index) => map.set(course.id, hueFor(index)));
    return map;
  }, [state.courses]);

  const empty = state.courses.length === 0 && state.tasks.length === 0;

  return (
      <div className={`week-sheet ${preview ? 'week-preview' : 'week-inner'}`} inert={preview || undefined} aria-hidden={preview || undefined} data-week={week}>
        <div className="week-head">
          <div className="week-head-gutter">
            <button className="period-settings-link" onClick={() => onEditPeriods()} aria-label="设置作息时间" title="自定义每节课的时间段">
              <span>节次</span><small>调整作息</small>
            </button>
          </div>
          {days.map((day, i) => {
            const isToday = isSameDay(day, now);
            return (
              <div key={i} className={`day-head${isToday ? ' is-today' : ''}`}>
                <span className="day-name">周{WEEKDAY_SHORT[i]}</span>
                <span className="day-date" aria-label={fmtDate(day)}><span className="day-date-full">{fmtShortDate(day)}</span><span className="day-date-mobile" aria-hidden="true">{day.getDate()}</span></span>
              </div>
            );
          })}
        </div>

        <div className="week-allday">
          <div className="allday-label">全天</div>
          {days.map((day, i) => {
            const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            const chips = state.tasks.filter(
              (task) => (task.due ?? '').slice(0, 10) === dateStr && !isTimedTask(task),
            );
            return (
              <div key={i} className="allday-cell">
                {chips.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    className={`allday-chip kind-${task.kind}${task.done ? ' done' : ''}`}
                    onClick={() => onEditTask(task)}
                    title={`${task.title}${task.course ? ` · ${task.course}` : ''}`}
                  >
                    <span>{task.title}</span>
                  </button>
                ))}
                {chips.length > 3 ? <span className="allday-more">+{chips.length - 3}</span> : null}
              </div>
            );
          })}
        </div>

        <div className="week-body">
          <div className="time-gutter" style={{ height }}>
            {timeline.rows.map((row) => row.period ? (
              <button key={row.start} className="period-label" style={{ top: row.top, height: row.height }}
                onClick={() => onEditPeriods(row.period!.index)}
                aria-label={`修改第 ${row.period.index} 节时间：${shortTime(row.period.start)}～${shortTime(row.period.end)}`}>
                <strong>{row.period.index}</strong>
                <span className="period-times"><span>{shortTime(row.period.start)}</span><span className="period-time-separator">～</span><span>{shortTime(row.period.end)}</span></span>
              </button>
            ) : (
              <div key={row.start} className="period-break-label" style={{ top: row.top, height: row.height }} title={`${fromMinutes(row.start)}～${fromMinutes(row.end)}`}>
                {row.height >= 28 ? '休息 / 课外' : ''}
              </div>
            ))}
          </div>
          <div className="day-grid" style={{ height }}>
            <div className="period-gridlines" aria-hidden="true">
              {timeline.rows.map((row) => <div key={row.start} className={`period-band${row.period ? '' : ' is-break'}`} style={{ top: row.top, height: row.height }} />)}
            </div>
            {days.map((day, i) => {
              const weekday = i + 1;
              const isToday = isSameDay(day, now);
              const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
              const courses = state.courses.filter((c) => c.weekday === weekday && c.weeks.includes(week));
              const timedTasks = state.tasks.filter(
                (t) => (t.start ?? t.due ?? '').slice(0, 10) === dateStr && isTimedTask(t),
              );
              const blocks: Block[] = [
                ...courses.map((course) => {
                  const hue = courseHue.get(course.id) ?? 205;
                  return {
                    id: course.id,
                    title: course.title,
                    subtitle: [course.location, course.teacher].filter(Boolean).join(' · '),
                    start: toMinutes(course.startTime),
                    end: toMinutes(course.endTime),
                    border: `hsl(${hue} 48% 69%)`,
                    tint: `linear-gradient(145deg, hsla(${hue}, 66%, 91%, 0.88), hsla(${hue}, 58%, 90%, 0.48))`,
                    kind: 'course' as const,
                    item: course,
                  };
                }),
                ...timedTasks.map((task) => {
                  const rgb = KIND_RGB[task.kind] ?? KIND_RGB.other;
                  const startText = (task.start ?? task.due ?? '').slice(11, 16) || '09:00';
                  const start = toMinutes(startText);
                  const end = task.end
                    ? Math.max(start + 1, toMinutes(task.end.slice(11, 16)))
                    : start + (task.kind === 'exam' ? 120 : 90);
                  return {
                    id: task.id,
                    title: task.title,
                    subtitle: task.location ?? '',
                    start,
                    end,
                    border: KIND_COLOR[task.kind] ?? KIND_COLOR.other,
                    tint: `linear-gradient(150deg, rgba(${rgb}, 0.28), rgba(${rgb}, 0.08))`,
                    kind: 'task' as const,
                    item: task,
                  };
                }),
              ].sort((a, b) => a.start - b.start);

              const laneEnds: number[] = [];
              const placed = blocks.map((block) => {
                let lane = laneEnds.findIndex((end) => end <= block.start);
                if (lane === -1) {
                  lane = laneEnds.length;
                  laneEnds.push(block.end);
                } else {
                  laneEnds[lane] = block.end;
                }
                return { block, lane };
              });
              const laneCount = Math.max(1, laneEnds.length);

              return (
                <div key={i} className={`day-col${isToday ? ' is-today' : ''}`}>
                  {placed.map(({ block, lane }) => {
                    const top = position(block.start) + 2;
                    const rawHeight = position(block.end) - position(block.start) - 4;
                    const blockHeight = Math.max(22, rawHeight);
                    const width = 100 / laneCount;
                    return (
                      <button
                        key={block.id}
                        className={`event-block ${block.kind}${blockHeight < 40 ? ' compact' : ''}`}
                        style={{
                          top,
                          height: blockHeight,
                          left: `calc(${lane * width}% + var(--event-inset, 3px))`,
                          width: `calc(${width}% - 2 * var(--event-inset, 3px))`,
                          borderLeftColor: block.border,
                          background: block.tint,
                        }}
                        onClick={() => (block.kind === 'course' ? onEditCourse(block.item as Course) : onEditTask(block.item as Task))}
                        title={`${block.title} · ${fromMinutes(block.start)}～${fromMinutes(Math.min(1440, block.end))}${block.subtitle ? ` · ${block.subtitle}` : ''}`}
                      >
                        <span className="event-title">{block.title}</span>
                        {blockHeight >= 40 && block.subtitle ? (
                          <span className="event-sub">
                            <IconPin size={11} /> {block.subtitle}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {isToday && nowMinutes >= timeline.start && nowMinutes <= timeline.end ? (
                    <div className="now-line" style={{ top: position(nowMinutes) }}>
                      <span />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {empty ? (
              <div className="week-empty">
                <strong>课表还是空的</strong>
                <span>从教务系统导入，或直接在左边说：「明天下午三点前交高数作业」。</span>
                <button className="btn btn-primary" onClick={onImport}>
                  导入课表
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
  );
}
