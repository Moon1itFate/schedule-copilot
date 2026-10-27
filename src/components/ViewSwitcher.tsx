import { useEffect, useRef, useState } from 'react';
import { IconCalendar, IconCheck, IconList } from './Icons';
export type ScheduleView = 'week' | 'agenda' | 'todo';
const views: { value: ScheduleView; label: string; detail: string }[] = [
  { value: 'week', label: '课表', detail: '查看每周安排' },
  { value: 'agenda', label: '日程', detail: '按日期浏览' },
  { value: 'todo', label: '待办', detail: '管理任务进度' },
];
export function ViewSwitcher({ value, onChange }: { value: ScheduleView; onChange: (value: ScheduleView) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    options.current[views.findIndex(view => view.value === value)]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div ref={root} className={`view-switch${open ? ' is-open' : ''}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <button ref={trigger} className="view-switch-trigger" aria-label="切换视图" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? 'schedule-view-options' : undefined} onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
          if (event.key === 'Escape') setOpen(false);
        }}>
        {value === 'week' ? <IconCalendar size={16} /> : <IconList size={16} />}
        <span>{views.find(view => view.value === value)?.label}</span><i className="view-switch-chevron" aria-hidden="true" />
      </button>
      {open ? <div id="schedule-view-options" className="view-switch-menu" role="listbox" aria-label="日程视图"
        onKeyDown={(event) => {
          const current = options.current.indexOf(document.activeElement as HTMLButtonElement);
          let next = current;
          if (event.key === 'ArrowDown') next = (current + 1) % views.length;
          else if (event.key === 'ArrowUp') next = (current + views.length - 1) % views.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = views.length - 1;
          else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
          else return;
          event.preventDefault(); options.current[next]?.focus();
        }}>
        {views.map((view, index) => <button key={view.value} ref={(node) => { options.current[index] = node; }} type="button"
          role="option" aria-label={view.label} aria-selected={value === view.value} tabIndex={-1}
          className={`view-switch-option${value === view.value ? ' selected' : ''}`}
          onClick={() => { onChange(view.value); setOpen(false); trigger.current?.focus(); }}>
          <span className="view-switch-option-icon">{view.value === 'week' ? <IconCalendar size={16} /> : <IconList size={16} />}</span>
          <span className="view-switch-option-text"><strong>{view.label}</strong><small>{view.detail}</small></span>
          {value === view.value ? <IconCheck size={14} /> : null}
        </button>)}
      </div> : null}
    </div>
  );
}
