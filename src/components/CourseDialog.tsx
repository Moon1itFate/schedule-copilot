import { useState } from 'react';
import type { AppState, Course } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { IconTrash } from './Icons';
import { formatWeeks, parseWeeks } from '../lib/weeks';
import { WEEKDAY_FULL } from '../lib/date';

interface Props {
  course: Course | null;
  term: AppState['term'];
  onClose: () => void;
  onSaved: (state: AppState) => void;
}

export function CourseDialog({ course, term, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(course?.title ?? '');
  const [teacher, setTeacher] = useState(course?.teacher ?? '');
  const [location, setLocation] = useState(course?.location ?? '');
  const [weekday, setWeekday] = useState(course?.weekday ?? 1);
  const [startTime, setStartTime] = useState(course?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(course?.endTime ?? '09:40');
  const [weeks, setWeeks] = useState(formatWeeks(course?.weeks ?? Array.from({ length: term.totalWeeks }, (_, i) => i + 1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim() || busy) return;
    const parsedWeeks = parseWeeks(weeks, term.totalWeeks);
    if (!parsedWeeks.length) {
      setError(`请填写有效周次，范围为 1-${term.totalWeeks}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.saveCourse({
        id: course?.id,
        title: title.trim(),
        teacher,
        location,
        weekday,
        startTime,
        endTime,
        weeks: parsedWeeks,
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
    if (!course) return;
    if (!window.confirm(`删除课程「${course.title}」？`)) return;
    setBusy(true);
    try {
      const response = await api.deleteCourse(course.id);
      onSaved(response.state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={course ? '编辑课程' : '新增课程'}
      subtitle="改时间、改周次都会立即反映到课表"
      onClose={onClose}
      footer={
        <>
          {course ? (
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
          <span>课程名</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="例如：数据结构" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>教师</span>
            <input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="可不填" />
          </label>
          <label className="field">
            <span>地点</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：计算机楼 402" />
          </label>
        </div>
        <label className="field">
          <span>星期</span>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAY_FULL.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>开始</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span>结束</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>上课周次</span>
          <input value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="1-16 或 1,3,5 或 2-16双" />
          <small>支持「1-16」「1,3,5」「2-16双」这类写法</small>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </Modal>
  );
}
