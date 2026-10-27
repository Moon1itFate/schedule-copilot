import { useMemo, useState } from 'react';
import type { AppState, ItemKind, Task } from '../types';
import { fmtDate, fmtDue, isOverdue, parseLocal } from '../lib/date';
import { IconCheck, IconPlus } from './Icons';

const KIND_LABEL: Record<ItemKind, string> = {
  task: '作业',
  contest: '比赛',
  exam: '考试',
  other: '其他',
};

interface Props {
  state: AppState;
  today: Date;
  onEditTask: (task: Task) => void;
  onToggleTask: (task: Task) => void;
  onAddTask: () => void;
}

export function TodoView({ state, onEditTask, onToggleTask, onAddTask }: Props) {
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open');

  const { open, done } = useMemo(() => {
    const sorted = [...state.tasks].sort((a, b) => {
      const da = a.due ? parseLocal(a.due).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.due ? parseLocal(b.due).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });
    return {
      open: sorted.filter((t) => !t.done),
      done: sorted.filter((t) => t.done),
    };
  }, [state.tasks]);

  const visible = filter === 'open' ? open : filter === 'done' ? done : [...open, ...done];

  return (
    <div className="todo-view">
      <div className="todo-toolbar">
        <div className="segmented">
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>
            进行中 <span>{open.length}</span>
          </button>
          <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
            已完成 <span>{done.length}</span>
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部 <span>{state.tasks.length}</span>
          </button>
        </div>
        <button className="btn btn-primary" onClick={onAddTask}>
          <IconPlus size={16} /> 新建待办
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">{filter === 'done' ? '还没有完成的待办' : '没有待办，清爽'}</div>
          <div className="empty-text">作业、比赛、考试都可以丢进来；也可以在左边对话里直接说。</div>
        </div>
      ) : (
        <div className="todo-list">
          {visible.map((task) => {
            const overdue = !task.done && isOverdue(task.due, new Date());
            return (
              <div key={task.id} className={`todo-row kind-${task.kind}${task.done ? ' is-done' : ''}`}>
                <button
                  className={`check${task.done ? ' checked' : ''}`}
                  onClick={() => onToggleTask(task)}
                  aria-label={task.done ? '标记未完成' : '标记完成'}
                >
                  {task.done ? <IconCheck size={14} /> : null}
                </button>
                <button className="todo-main" onClick={() => onEditTask(task)}>
                  <span className="todo-title">{task.title}</span>
                  <span className="todo-meta">
                    <span className={`tag tag-${task.kind}`}>{KIND_LABEL[task.kind]}</span>
                    {task.course ? <span className="todo-course">{task.course}</span> : null}
                    {task.location ? <span className="todo-loc">{task.location}</span> : null}
                  </span>
                </button>
                <span className={`todo-due${overdue ? ' overdue' : ''}`}>{fmtDue(task.due)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
