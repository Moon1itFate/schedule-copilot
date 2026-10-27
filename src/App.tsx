import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState, ChatMessage, Course, SettingsView, Task } from './types';
import { api, chatStream } from './api';
import { ViewSwitcher } from './components/ViewSwitcher';
import { ChatPanel } from './components/ChatPanel';
import { WeekGrid } from './components/WeekGrid';
import { AgendaView } from './components/AgendaView';
import { TodoView } from './components/TodoView';
import { SideRail } from './components/SideRail';
import { SettingsDialog } from './components/SettingsDialog';
import { ImportDialog } from './components/ImportDialog';
import { TaskDialog } from './components/TaskDialog';
import { CourseDialog } from './components/CourseDialog';
import { PeriodSettingsDialog } from './components/PeriodSettingsDialog';
import { ReminderCapsule } from './components/ReminderCapsule';
import { GlassLens } from './components/GlassLens';
import { IconCalendar, IconChat, IconDownload, IconList, IconSettings, IconUpload } from './components/Icons';
import { addDays, mondayOf, parseLocal, weekIndexOf } from './lib/date';

type Tab = 'week' | 'agenda' | 'todo';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [tab, setTab] = useState<Tab>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [reminderPreview, setReminderPreview] = useState<{ task?: Task } | null>(null);
  const [periodDialog, setPeriodDialog] = useState<{ focusPeriod?: number } | null>(null);
  const [taskDialog, setTaskDialog] = useState<{ task: Task | null } | null>(null);
  const [courseDialog, setCourseDialog] = useState<{ course: Course | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const payload = await api.state();
      setState(payload.state);
      setSettings(payload.settings);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!state) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('task');
    if (!id) return;
    const task = state.tasks.find((item) => item.id === id);
    setTab('todo');
    if (task) setTaskDialog({ task });
    url.searchParams.delete('task');
    window.history.replaceState(null, '', url);
  }, [state]);

  const currentWeek = state ? Math.min(state.term.totalWeeks, Math.max(1, weekIndexOf(state.term.startDate, today))) : 1;
  const displayWeek = state ? Math.min(state.term.totalWeeks, Math.max(1, currentWeek + weekOffset)) : 1;
  const weekMonday = state ? addDays(mondayOf(parseLocal(state.term.startDate)), (displayWeek - 1) * 7) : today;
  const weekSunday = addDays(weekMonday, 6);

  const send = async (text: string) => {
    if (streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setStreaming(true);
    setStreamText('');
    setChatOpen(true);
    let accumulated = '';
    await chatStream(next, {
      onText: (value) => {
        accumulated += value;
        setStreamText(accumulated);
      },
      onState: (nextState) => setState(nextState),
      onError: (value) => {
        accumulated += `${accumulated ? '\n\n' : ''}⚠️ ${value}`;
        setStreamText(accumulated);
      },
    });
    setMessages((current) => [...current, { role: 'assistant', content: accumulated || '（没有收到回复）' }]);
    setStreaming(false);
    setStreamText('');
  };

  const toggleTask = async (task: Task) => {
    try {
      const response = await api.saveTask({ id: task.id, done: !task.done });
      setState(response.state);
    } catch {
      /* ignore */
    }
  };

  if (loadError) {
    return (
      <div className="splash">
        <div className="splash-card">
          <h1>{__MOBILE__ ? '读取手机数据失败' : '连不上本地服务'}</h1>
          <p>{loadError}</p>
          <p className="muted">{__MOBILE__ ? '请检查手机存储空间，并尝试重新打开 App。' : '请确认后端已启动：在项目目录运行 npm run dev（或 npm start）。'}</p>
          <button className="btn btn-primary" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!state || !settings) {
    return (
      <div className="splash">
        <div className="spinner" />
        <span>正在整理你的日程…</span>
      </div>
    );
  }

  return (
    <div className={`app${chatOpen ? ' chat-open' : ''}`}>
      <div className="ambient-scene" aria-hidden="true"><i /><i /><i /><i /></div>
      {chatOpen ? <div className="chat-scrim" onClick={() => setChatOpen(false)} /> : null}
      <ChatPanel
        messages={messages}
        streaming={streaming}
        streamText={streamText}
        settings={settings}
        onSend={(text) => void send(text)}
        onOpenSettings={() => setShowSettings(true)}
        onClose={() => setChatOpen(false)}
      />

      <main className="main" aria-label="日程工作区">
        <header className="topbar">
          <GlassLens radius={25} />
          <button className="icon-btn chat-toggle" onClick={() => setChatOpen((open) => !open)} aria-label="对话">
            <IconChat />
          </button>

          <ViewSwitcher value={tab} onChange={setTab} />

          <button className="weeknav-label" onClick={() => setWeekOffset(0)} aria-label="回到本周"
            title={tab === 'week' ? '左右滑动课表切换周次，点击回到本周' : '当前学期周次'}>
            <strong aria-live="polite">第 {tab === 'week' ? displayWeek : currentWeek} 周</strong>
            <span>{tab === 'week' ? `${weekMonday.getMonth() + 1}/${weekMonday.getDate()} – ${weekSunday.getMonth() + 1}/${weekSunday.getDate()}` : `${today.getMonth() + 1}/${today.getDate()} 今天`}</span>
          </button>

          <div className="actions">
            <button aria-label="导入课表" className="btn btn-ghost" onClick={() => setShowImport(true)}>
              <IconUpload size={16} /> <span className="btn-label">导入课表</span>
            </button>
            <a className="btn btn-ghost desktop-only" href="/api/export.ics" aria-label="导出日程" title="导出日程" download>
              <IconDownload size={16} /> <span className="btn-label">导出</span>
            </a>
            <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="设置">
              <IconSettings />
            </button>
          </div>
        </header>

        <div className="view">
          {tab === 'week' ? (
            <div className="week-layout">
              <WeekGrid
                state={state}
                week={displayWeek}
                today={today}
                onChangeWeek={(direction) => setWeekOffset((offset) => Math.min(state.term.totalWeeks, Math.max(1, currentWeek + offset + direction)) - currentWeek)}
                onEditCourse={(course) => setCourseDialog({ course })}
                onEditTask={(task) => setTaskDialog({ task })}
                onImport={() => setShowImport(true)}
                onEditPeriods={(focusPeriod) => setPeriodDialog({ focusPeriod })}
              />
              <SideRail
                state={state}
                week={displayWeek}
                today={today}
                onEditTask={(task) => setTaskDialog({ task })}
                onEditCourse={(course) => setCourseDialog({ course })}
              />
            </div>
          ) : null}

          {tab === 'agenda' ? (
            <AgendaView
              state={state}
              today={today}
              onEditTask={(task) => setTaskDialog({ task })}
              onEditCourse={(course) => setCourseDialog({ course })}
            />
          ) : null}

          {tab === 'todo' ? (
            <TodoView
              state={state}
              today={today}
              onEditTask={(task) => setTaskDialog({ task })}
              onToggleTask={(task) => void toggleTask(task)}
              onAddTask={() => setTaskDialog({ task: null })}
            />
          ) : null}
        </div>
        <footer className="workspace-footnote">
          <span className="calendar-legend"><i />课程 <i />作业 <i />比赛 / 考试</span>
          <span>左右滑动切换周次 · 点击安排可编辑 · 点击时间调整作息</span>
        </footer>
      </main>

      {periodDialog ? (
        <PeriodSettingsDialog state={state} focusPeriod={periodDialog.focusPeriod} onClose={() => setPeriodDialog(null)} onSaved={setState} />
      ) : null}

      {showSettings ? (
        <SettingsDialog
          settings={settings}
          state={state}
          onClose={() => setShowSettings(false)}
          onPreviewReminder={() => setReminderPreview({ task: state.tasks.find((task) => !task.done) })}
          onSaved={(payload) => {
            setState(payload.state);
            setSettings(payload.settings);
            setWeekOffset(0);
          }}
        />
      ) : null}

      {reminderPreview ? (
        <ReminderCapsule task={reminderPreview.task} onClose={() => setReminderPreview(null)} onOpen={() => {
          setShowSettings(false);
          setReminderPreview(null);
          setTab('todo');
          if (reminderPreview.task) setTaskDialog({ task: reminderPreview.task });
        }} />
      ) : null}

      {showImport ? (
        <ImportDialog
          state={state}
          settings={settings}
          onClose={() => setShowImport(false)}
          onDone={(next) => {
            setState(next);
            setWeekOffset(0);
          }}
        />
      ) : null}

      {taskDialog ? (
        <TaskDialog
          task={taskDialog.task}
          onClose={() => setTaskDialog(null)}
          onSaved={(next) => setState(next)}
        />
      ) : null}

      {courseDialog ? (
        <CourseDialog
          course={courseDialog.course}
          term={state.term}
          onClose={() => setCourseDialog(null)}
          onSaved={(next) => setState(next)}
        />
      ) : null}
    </div>
  );
}
