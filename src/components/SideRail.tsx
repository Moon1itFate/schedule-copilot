import { useMemo } from 'react';
import type { AppState, Course, Task } from '../types';
import { addDays, fmtDate, fmtDue, isOverdue, mondayOf, parseLocal, toMinutes, WEEKDAY_FULL, weekdayOf } from '../lib/date';
import { IconClock, IconPin } from './Icons';
import { GlassLens } from './GlassLens';

interface Props {
  state: AppState;
  week: number;
  today: Date;
  onEditTask: (task: Task) => void;
  onEditCourse: (course: Course) => void;
}

export function SideRail({ state, week, today, onEditTask, onEditCourse }: Props) {
  const monday = useMemo(
    () => addDays(mondayOf(parseLocal(state.term.startDate)), (Math.max(1, week) - 1) * 7),
    [state.term.startDate, week],
  );

  const todayInWeek = monday <= today && today < addDays(monday, 7);
  const todayCourses = state.courses
    .filter((course) => course.weekday === weekdayOf(today) && course.weeks.includes(week))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const todayTasks = state.tasks
    .filter((task) => (task.due ?? '').slice(0, 10) === fmtDate(today) && !task.done)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));

  const weekStart = fmtDate(monday);
  const weekEnd = fmtDate(addDays(monday, 6));
  const weekTasks = state.tasks
    .filter((task) => {
      const day = (task.due ?? '').slice(0, 10);
      return !task.done && day >= weekStart && day <= weekEnd;
    })
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));

  const openTotal = state.tasks.filter((task) => !task.done).length;
  const overdue = state.tasks.filter((task) => !task.done && isOverdue(task.due, today)).length;

  return (
    <aside className="rail">
      <section className="rail-card today-card">
        <GlassLens radius={25} />
        <div className="rail-head">
          <span>今天的节奏</span>
          <span className="rail-date">
            {today.getMonth() + 1}月{today.getDate()}日 · {WEEKDAY_FULL[weekdayOf(today) - 1]}
          </span>
        </div>
        {!todayInWeek ? (
          <p className="rail-empty">今天不在当前这一周，点顶栏「今天」回到本周。</p>
        ) : (
          <>
            {todayCourses.length === 0 && todayTasks.length === 0 ? (
              <p className="rail-empty">今天没有课，也没有截止任务。</p>
            ) : null}
            {todayCourses.map((course) => (
              <button key={course.id} className="rail-item" onClick={() => onEditCourse(course)}>
                <span className="rail-time">{course.startTime}</span>
                <span className="rail-dot" style={{ background: 'hsl(28 52% 68%)' }} />
                <span className="rail-main">
                  <strong>{course.title}</strong>
                  <em>
                    <IconPin size={11} /> {course.location ?? '地点待定'}
                  </em>
                </span>
              </button>
            ))}
            {todayTasks.map((task) => (
              <button key={task.id} className={`rail-item kind-${task.kind}`} onClick={() => onEditTask(task)}>
                <span className="rail-time">{(task.due ?? '').slice(11, 16)}</span>
                <span className={`rail-dot kind-${task.kind}`} />
                <span className="rail-main">
                  <strong>{task.title}</strong>
                  <em>{task.course ?? '待办'}</em>
                </span>
              </button>
            ))}
          </>
        )}
      </section>

      <section className="rail-card">
        <GlassLens radius={25} />
        <div className="rail-head">
          <span>本周截止</span>
          <span className="rail-date">{weekTasks.length} 项</span>
        </div>
        {weekTasks.length === 0 ? (
          <p className="rail-empty">这一周没有临近的截止，稳。</p>
        ) : (
          weekTasks.map((task) => (
            <button key={task.id} className={`rail-item kind-${task.kind}`} onClick={() => onEditTask(task)}>
              <span className="rail-time">{fmtDue(task.due, today).replace(/^\S+ /, '')}</span>
              <span className={`rail-dot kind-${task.kind}`} />
              <span className="rail-main">
                <strong>{task.title}</strong>
                <em>{fmtDue(task.due, today).split(' ')[0]}</em>
              </span>
            </button>
          ))
        )}
      </section>

      <section className="rail-stats">
        <GlassLens radius={25} />
        <div>
          <strong>{openTotal}</strong>
          <span>进行中</span>
        </div>
        <div className={overdue ? 'bad' : ''}>
          <strong>{overdue}</strong>
          <span>已逾期</span>
        </div>
        <div>
          <strong>{state.courses.length}</strong>
          <span>门课程</span>
        </div>
      </section>
    </aside>
  );
}
