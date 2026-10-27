import { useState } from 'react';
import type { AppState, ItemKind, Task } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { IconTrash } from './Icons';
import { fmtDate } from '../lib/date';

const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'task', label: '作业 / 待办' },
  { value: 'contest', label: '比赛' },
  { value: 'exam', label: '考试' },
  { value: 'other', label: '其他' },
];

interface Props {
  task: Task | null;
  onClose: () => void;
  onSaved: (state: AppState) => void;
}

function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(22, 0, 0, 0);
  return `${fmtDate(d)}T22:00`;
}

export function TaskDialog({ task, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [kind, setKind] = useState<ItemKind>(task?.kind ?? 'task');
  const [due, setDue] = useState(task ? task.due ?? '' : defaultDue());
  const [allDay, setAllDay] = useState(Boolean(task?.allDay));
  const [start, setStart] = useState(task?.start ?? '');
  const [end, setEnd] = useState(task?.end ?? '');
  const [location, setLocation] = useState(task?.location ?? '');
  const [note, setNote] = useState(task?.note ?? '');
  const [url, setUrl] = useState(task?.url ?? '');
  const [done, setDone] = useState(Boolean(task?.done));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.saveTask({
        id: task?.id,
        title: title.trim(),
        kind,
        due: allDay ? due.slice(0, 10) : due,
        start,
        end,
        allDay,
        location,
        note,
        url,
        done,
      });
      onSaved(response.state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!window.confirm(`删除「${task.title}」？`)) return;
    setBusy(true);
    try {
      const response = await api.deleteTask(task.id);
      onSaved(response.state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={task ? '编辑日程' : '新建日程'}
      subtitle="作业、比赛、考试都可以放进来"
      onClose={onClose}
      footer={
        <>
          {task ? (
            <button className="btn btn-ghost danger" onClick={remove} disabled={busy}>
              <IconTrash size={16} /> 删除
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !title.trim()}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：高数作业 第 3 章" autoFocus />
        </label>

        <div className="field">
          <span>类型</span>
          <div className="segmented small">
            {KINDS.map((item) => (
              <button key={item.value} className={kind === item.value ? 'active' : ''} onClick={() => setKind(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span>截止时间</span>
            <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? due.slice(0, 10) : due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>地点</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="可不填" />
          </label>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={allDay} onChange={(event) => {
            setAllDay(event.target.checked);
            if (due) setDue(event.target.checked ? due.slice(0, 10) : due.length === 10 ? `${due}T23:59` : due);
          }} />
          <span>全天日程</span>
        </label>

        <div className="field-row">
          <label className="field">
            <span>开始（可选）</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>结束（可选）</span>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>备注</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="范围、要求、链接都可以写" />
        </label>

        <label className="field">
          <span>链接</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="报名页 / 题目链接" />
        </label>

        {task ? (
          <label className="checkbox">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>已完成</span>
          </label>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
