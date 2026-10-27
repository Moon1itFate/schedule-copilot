import { useMemo } from 'react';
import type { AppState, Course, Task } from '../types';
import { addDays, fmtDate, fmtDue, relativeDayLabel, startOfDay, toMinutes, WEEKDAY_FULL, weekIndexOf, weekdayOf } from '../lib/date';
import { IconPin } from './Icons';

interface Props {
  state: AppState;
  today: Date;
  days?: number;
  onEditTask: (task: Task) => void;
  onEditCourse: (course: Course) => void;
}

export function AgendaView({ state, today, days = 14, onEditTask, onEditCourse }: Props) {
  const groups = useMemo(() => {
    const start = startOfDay(today);
    const list: {
      date: Date;
      week: number;
      courses: Course[];
      tasks: Task[];
    }[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      const dateStr = fmtDate(date);
      const week = weekIndexOf(state.term.startDate, date);
      const courses = state.courses
        .filter((c) => c.weekday === weekdayOf(date) && c.weeks.includes(week))
        .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
      const tasks = state.tasks
        .filter((t) => (t.due ?? '').slice(0, 10) === dateStr)
        .sort((a, b) => toMinutes((a.due ?? '').slice(11, 16) || '23:59') - toMinutes((b.due ?? '').slice(11, 16) || '23:59'));
      if (courses.length || tasks.length) list.push({ date, week, courses, tasks });
    }
    return list;
  }, [state, today, days]);

  if (!groups.length) {
    return (
      <div className="empty-state">
        <div className="empty-title">接下来 {days} 天还没有安排</div>
        <div className="empty-text">在左边对话框里说一句，比如「周五前交数据结构实验报告」「下周三下午蓝桥杯模拟赛」。</div>
      </div>
    );
  }

  return (
    <div className="agenda">
      {groups.map((group) => (
        <section key={fmtDate(group.date)} className="agenda-day">
          <header className="agenda-head">
            <div className="agenda-date">
              <strong>{relativeDayLabel(group.date, today)}</strong>
              <span>{group.date.getMonth() + 1}月{group.date.getDate()}日 · {WEEKDAY_FULL[weekdayOf(group.date) - 1]} · 第{group.week}周</span>
            </div>
            <span className="agenda-count">{group.courses.length + group.tasks.length} 项</span>
          </header>
          <div className="agenda-items">
            {group.courses.map((course) => (
              <button key={course.id} className="agenda-item course" onClick={() => onEditCourse(course)}>
                <span className="agenda-time">
                  {course.startTime}
                  <em>{course.endTime}</em>
                </span>
                <span className="agenda-bar" style={{ background: 'hsl(28 52% 68%)' }} />
                <span className="agenda-main">
                  <strong>{course.title}</strong>
                  <span className="agenda-meta">
                    {[course.location, course.teacher].filter(Boolean).join(' · ') || '课程'}
                  </span>
                </span>
                <span className="tag tag-course">课程</span>
              </button>
            ))}
            {group.tasks.map((task) => (
              <button
                key={task.id}
                className={`agenda-item task kind-${task.kind}${task.done ? ' is-done' : ''}`}
                onClick={() => onEditTask(task)}
              >
                <span className="agenda-time">
                  {(task.due ?? '').slice(11, 16) || '—'}
                  <em>{task.end ? (task.end ?? '').slice(11, 16) : '截止'}</em>
                </span>
                <span className={`agenda-bar kind-${task.kind}`} />
                <span className="agenda-main">
                  <strong>{task.title}</strong>
                  <span className="agenda-meta">
                    {task.location ? <><IconPin size={11} /> {task.location}</> : task.course ?? '待办'}
                  </span>
                </span>
                <span className={`tag tag-${task.kind}`}>
                  {task.kind === 'contest' ? '比赛' : task.kind === 'exam' ? '考试' : task.kind === 'other' ? '其他' : '作业'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="agenda-foot">只显示有安排的日子 · 共 {days} 天</div>
    </div>
  );
}
