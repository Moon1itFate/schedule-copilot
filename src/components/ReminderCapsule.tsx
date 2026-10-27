import { useEffect } from 'react';
import type { Task } from '../types';
import { IconClock, IconClose } from './Icons';

interface Props {
  task?: Task;
  onClose: () => void;
  onOpen: () => void;
}

export function ReminderCapsule({ task, onClose, onOpen }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 20_000);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="reminder-capsule" role="status" aria-label="任务提醒预览">
      <span className="reminder-capsule-icon"><IconClock size={20} /></span>
      <div className="reminder-capsule-content">
        <span className="reminder-capsule-eyebrow">日程罗盘 · 提醒预览</span>
        <strong>{task?.title ?? '别忘了提交今天的作业'}</strong>
        <span>任务临近时会在这里提示你</span>
        <button onClick={onOpen}>查看任务 →</button>
      </div>
      <button className="icon-btn" aria-label="关闭提醒预览" onClick={onClose}><IconClose size={15} /></button>
    </div>
  );
}
