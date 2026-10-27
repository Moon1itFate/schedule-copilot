import { useEffect, useRef, useState } from 'react';
import type { Period, PeriodEditing } from '../types';
import { editPeriod, nextPeriod, periodEditingError, periodError, setPeriodDuration } from '../lib/periods';
import { toMinutes } from '../lib/date';
import { IconPlus, IconTrash } from './Icons';

interface Props {
  periods: Period[];
  onChange: (periods: Period[]) => void;
  options: PeriodEditing;
  onOptionsChange: (options: PeriodEditing) => void;
  disabled?: boolean;
  focusPeriod?: number;
}

export function PeriodEditor({ periods, onChange, options, onOptionsChange, disabled = false, focusPeriod }: Props) {
  const [operationError, setOperationError] = useState('');
  const lastValidPeriods = useRef(periods);
  useEffect(() => { if (!periodError(periods)) lastValidPeriods.current = periods; }, [periods]);
  const error = periodEditingError(options) ?? periodError(periods);
  const next = error ? null : nextPeriod(periods, options.fixedDuration ? options.duration : 45);
  const update = (index: number, key: 'start' | 'end', value: string) => {
    setOperationError('');
    const baseline = (options.fixedDuration || options.shiftFollowing) && periodError(periods) ? lastValidPeriods.current : periods;
    try { onChange(editPeriod(baseline, index, key, value, options)); }
    catch (err) { setOperationError(err instanceof Error ? err.message : String(err)); }
  };
  const updateOptions = (input: PeriodEditing) => {
    const nextOptions = !input.fixedDuration && periodEditingError(input) ? { ...input, duration: 45 } : input;
    setOperationError('');
    if (nextOptions.fixedDuration && !periodEditingError(nextOptions)) {
      try {
        const baseline = periodError(periods) ? lastValidPeriods.current : periods;
        const nextPeriods = setPeriodDuration(baseline, nextOptions.duration, nextOptions.shiftFollowing);
        onChange(nextPeriods);
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    onOptionsChange(nextOptions);
  };
  return (
    <div className="period-editor">
      <div className="period-edit-options">
        <label className="checkbox">
          <input type="checkbox" checked={options.fixedDuration} disabled={disabled}
            onChange={(event) => updateOptions({ ...options, fixedDuration: event.target.checked })} />
          <span>固定每节课时长</span>
        </label>
        {options.fixedDuration ? (
          <label className="period-duration-input">
            <span>每节课</span>
            <input type="number" min={1} max={240} step={1} aria-label="每节课时长（分钟）" value={options.duration || ''} disabled={disabled}
              onChange={(event) => updateOptions({ ...options, duration: Number(event.target.value) })} />
            <span>分钟</span>
          </label>
        ) : null}
        <label className="checkbox">
          <input type="checkbox" checked={options.shiftFollowing} disabled={disabled}
            onChange={(event) => updateOptions({ ...options, shiftFollowing: event.target.checked })} />
          <span>自动顺延后续节次</span>
        </label>
        <p className="muted small period-help">{options.shiftFollowing
          ? '修改一节后，后续节次一起前移或后移，原有课间、午休间隔保持不变。'
          : '关闭顺延时，只修改当前节次；调整统一课时只更新各节结束时间。'}{options.fixedDuration ? '下课时间按固定时长自动计算。' : ''}</p>
      </div>
      <div className="period-editor-list">
        {periods.map((period, index) => {
          const duration = toMinutes(period.end) - toMinutes(period.start);
          return (
            <div className="period-editor-row" key={index}>
              <span className="period-editor-index">第 {index + 1} 节</span>
              <input type="time" step="60" aria-label={`第 ${index + 1} 节开始时间`} value={period.start}
                autoFocus={focusPeriod === index + 1} disabled={disabled}
                onChange={(event) => update(index, 'start', event.target.value)} />
              <span className="period-editor-separator">～</span>
              <input type="time" step="60" aria-label={`第 ${index + 1} 节结束时间`} value={period.end}
                readOnly={options.fixedDuration} title={options.fixedDuration ? '由开始时间和固定课时自动计算' : undefined}
                disabled={disabled} onChange={(event) => update(index, 'end', event.target.value)} />
              <span className="period-duration">{duration > 0 ? `${duration} 分钟` : '待调整'}</span>
              <button className="icon-btn" aria-label={`删除第 ${index + 1} 节`} title="删除此节次"
                disabled={disabled || periods.length === 1} onClick={() => onChange(periods.filter((_, i) => i !== index).map((item, i) => ({ ...item, index: i + 1 })))}>
                <IconTrash size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {operationError ? <div className="form-error" role="alert">{operationError}</div> : null}
      <div className="row-actions">
        <button className="btn btn-ghost small" disabled={disabled || !next} onClick={() => { if (next) onChange([...periods, next]); }}>
          <IconPlus size={14} /> 添加一节
        </button>
        <span className="muted small">共 {periods.length} 节{!next && !error ? ' · 当天已无更多可用时间' : ''}</span>
      </div>
      <p className="muted small period-help">保存后，按节次排的课程会跟随新作息调整；自定义时间的课程保留原时段。</p>
    </div>
  );
}
