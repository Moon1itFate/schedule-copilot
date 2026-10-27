import { useRef, useState } from 'react';
import type { AppState, Course, SettingsView, Task } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { IconUpload } from './Icons';
import { WEEKDAY_FULL } from '../lib/date';
import { formatWeeks } from '../lib/weeks';

interface Props {
  state: AppState;
  settings: SettingsView;
  onClose: () => void;
  onDone: (state: AppState) => void;
}

type Mode = 'text' | 'url' | 'ics';

interface Preview {
  courses: Course[];
  tasks: Task[];
  notes: string[];
  termStart?: string;
}

export function ImportDialog({ state, settings, onClose, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [cookie, setCookie] = useState('');
  const [termStart, setTermStart] = useState(state.term.startDate);
  const [result, setResult] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const resetPreview = () => {
    setResult(null);
    setSelected(new Set());
    setError('');
  };

  const parse = async () => {
    if (busy) return;
    if (mode === 'text' && !text.trim()) {
      setError('先把课表内容粘贴进来。');
      return;
    }
    if (mode === 'url' && !url.trim()) {
      setError('先填教务系统课表页地址。');
      return;
    }
    if (mode === 'ics' && !text.trim()) {
      setError('先选择一个 .ics 文件。');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await api.importSchedule({ mode, text, url, cookie, termStart });
      setResult(response);
      setSelected(new Set([...response.courses, ...response.tasks].map((item) => item.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!result || busy) return;
    const courses = result.courses.filter((course) => selected.has(course.id));
    const tasks = result.tasks.filter((task) => selected.has(task.id));
    const tip = courses.length ? `导入后会覆盖当前 ${state.courses.length} 门课程，并添加 ${tasks.length} 个日程，继续？` : `添加 ${tasks.length} 个日程，继续？`;
    if (!window.confirm(tip)) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.importSchedule({
        mode,
        commit: true,
        courses,
        tasks,
        termStart: result.termStart ?? termStart,
      });
      if (response.state) onDone(response.state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    resetPreview();
    try {
      setText(await file.text());
      setMode('ics');
    } catch (err) {
      setError(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="导入课表"
      subtitle="从教务系统、ICS 或复制的文字里识别课程"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            关闭
          </button>
          {result ? (
            <>
              <button className="btn" onClick={parse} disabled={busy}>
                重新解析
              </button>
              <button className="btn btn-primary" onClick={commit} disabled={busy || selected.size === 0}>
                {selected.size === 0 ? '没有可导入的安排' : `导入 ${selected.size} 项安排`}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={parse} disabled={busy}>
              {busy ? '解析中…' : '解析预览'}
            </button>
          )}
        </>
      }
    >
      <div className="import">
        {!settings.apiKeySet ? (
          <div className="banner">
            没有配置模型，将使用规则解析，格式乱的课表可能识别不准。建议先去设置里填一个 API Key。
          </div>
        ) : null}

        <div className="segmented">
          <button disabled={busy} className={mode === 'text' ? 'active' : ''} onClick={() => { setMode('text'); resetPreview(); }}>
            粘贴文字
          </button>
          <button disabled={busy} className={mode === 'url' ? 'active' : ''} onClick={() => { setMode('url'); resetPreview(); }}>
            教务系统链接
          </button>
          <button disabled={busy} className={mode === 'ics' ? 'active' : ''} onClick={() => { setMode('ics'); resetPreview(); }}>
            ICS 文件
          </button>
        </div>

        {mode === 'text' ? (
          <>
            <label className="field">
              <span>课表内容</span>
              <textarea
                rows={8}
                disabled={busy}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  if (result) resetPreview();
                }}
                placeholder={'直接把教务系统的课表页全选复制过来，或者按行写：\n高等数学 周一 1-2节 1-16周 教三201\n数据结构 周四 5-6节 1-16周 计算机楼402'}
              />
            </label>
            <div className="row-actions">
              <button
                className="btn btn-ghost small"
                disabled={busy}
                onClick={() => {
                  setText('高等数学 周一 1-2节 1-16周 教三201\n数据结构 周四 5-6节 1-16周 计算机楼402\n大学英语 周二 3-4节 1-16周 外语楼305');
                  resetPreview();
                }}
              >
                填入示例
              </button>
              <span className="muted small">整页复制粘贴也行，模型会自己挑课程；有 HTML 源码更好。</span>
            </div>
          </>
        ) : null}

        {mode === 'url' ? (
          <>
            <label className="field">
              <span>课表页地址</span>
              <input disabled={busy} value={url} onChange={(event) => { setUrl(event.target.value); if (result) resetPreview(); }} placeholder="https://xxx.edu.cn/xtgl/... 或 kbList 接口地址" />
            </label>
            <label className="field">
              <span>Cookie（登录后从浏览器复制）</span>
              <textarea disabled={busy} rows={3} value={cookie} onChange={(event) => { setCookie(event.target.value); if (result) resetPreview(); }} placeholder="JSESSIONID=...; route=..." />
              <small>
                浏览器登录教务系统 → F12 → Network → 找课表请求 → 复制请求头里的 Cookie 整行。正方 / 强智 / 青果多数能直接抓到表格；抓不到就回去用「粘贴文字」。
              </small>
            </label>
          </>
        ) : null}

        {mode === 'ics' ? (
          <div className="ics-box">
            <button disabled={busy} className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <IconUpload size={16} /> 选择 .ics 文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              hidden
              onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            />
            <span className="muted small">{text ? `已读取 ${(text.length / 1024).toFixed(1)} KB` : '支持 WakeUp 课程表、系统日历导出的 .ics'}</span>
          </div>
        ) : null}

        <label className="field narrow">
          <span>第 1 周周一</span>
          <input type="date" disabled={busy} value={termStart} onChange={(event) => { setTermStart(event.target.value); resetPreview(); }} />
          <small>用来把「第 3 周周三」换算成真实日期，开学校历上查一下。</small>
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        {result ? (
          <div className="preview">
            <div className="preview-head">
              <strong>识别结果</strong>
              <span>{result.courses.length} 门课程 · {result.tasks.length} 个日程</span>
            </div>
            {result.courses.length === 0 && result.tasks.length === 0 ? (
              <div className="form-error">
                没有识别出课程：本地规则只认「课程名 周X N节 N周 地点」这种每行一门课的格式。可以点「填入示例」看看正确格式，或到设置里配置模型后再解析（模型能读整页复制的内容）。
              </div>
            ) : null}
            {result.courses.length ? (
              <div className="preview-list">
                {result.courses.map((course) => {
                  const checked = selected.has(course.id);
                  return (
                    <label key={course.id} className={`preview-row${checked ? ' checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(selected);
                          if (checked) next.delete(course.id);
                          else next.add(course.id);
                          setSelected(next);
                        }}
                      />
                      <span className="preview-title">{course.title}</span>
                      <span className="preview-time">
                        {WEEKDAY_FULL[course.weekday - 1]} {course.startTime}-{course.endTime}
                      </span>
                      <span className="preview-weeks">{formatWeeks(course.weeks)}周</span>
                      <span className="preview-loc">{course.location ?? ''}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {result.tasks.length ? (
              <div className="preview-list">
                {result.tasks.map((task) => (
                  <label key={task.id} className={`preview-row${selected.has(task.id) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={selected.has(task.id)} onChange={() => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
                        return next;
                      });
                    }} />
                    <span className="preview-title">{task.title}</span>
                    <span className="preview-time">{task.allDay ? `${task.due?.slice(0, 10) ?? ''} 全天` : (task.start ?? task.due ?? '').replace('T', ' ')}</span>
                    <span className="preview-loc">{task.location ?? ''}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <ul className="notes">
              {result.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
            {result.termStart ? <p className="muted small">识别到开学日期：{result.termStart}</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
