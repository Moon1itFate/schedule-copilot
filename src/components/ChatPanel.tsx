import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, SettingsView } from '../types';
import { IconClose, IconSettings, IconSpark } from './Icons';
import { GlassLens } from './GlassLens';

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  streamText: string;
  settings: SettingsView | null;
  onSend: (text: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const SUGGESTIONS = [
  '明天下午三点前交高数作业',
  '下周三有个蓝桥杯模拟赛，晚上七点',
  '这周还有什么没做完？',
  '把周五的英语课改到周四下午',
];

export function ChatPanel({ messages, streaming, streamText, settings, onSend, onOpenSettings, onClose }: Props) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, streaming]);

  const send = () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText('');
    onSend(value);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  return (
    <aside className="chat">
      <GlassLens radius={32} />
      <header className="chat-head">
        <div className="brand">
          <span className="logo">
            <img src="/app-icon.svg" alt="" width="38" height="38" style={{ borderRadius: 13 }} />
          </span>
          <div className="brand-text">
            <strong>日程罗盘</strong>
            <span>你的日程小助手</span>
          </div>
        </div>
        <button className="icon-btn chat-close" onClick={onClose} title="收起对话" aria-label="收起对话">
          <IconClose />
        </button>
        <button className="icon-btn" onClick={onOpenSettings} title="设置" aria-label="设置">
          <IconSettings />
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {!settings?.apiKeySet ? (
          <button className="setup-hint" onClick={onOpenSettings}>
            <strong>先把模型接上</strong>
            <span>支持 DeepSeek / OpenAI / 任意 OpenAI 兼容接口，填个 API Key 就能用。</span>
          </button>
        ) : null}

        {messages.length === 0 && !streaming ? (
          <div className="welcome">
            <div className="assistant-orbit" aria-hidden="true"><IconSpark size={32} /></div>
            <span className="eyebrow">一个念头，一个新计划</span>
            <h2>今天，想做点什么？</h2>
            <p>课程、作业，或是重要的小事。<br />说给我听，一起安排好。</p>
            <div className="suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item} onClick={() => onSend(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message, index) => (
          <div key={index} className={`msg msg-${message.role}`}>
            <div className="bubble">{message.content}</div>
          </div>
        ))}

        {streaming ? (
          <div className="msg msg-assistant">
            <div className="bubble">
              {streamText ? streamText : <span className="typing"><i /><i /><i /></span>}
            </div>
          </div>
        ) : null}
      </div>

      <div className="composer">
        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder="说人话就行：明天下午三点前交高数作业"
          onChange={(event) => {
            setText(event.target.value);
            const el = event.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(140, el.scrollHeight)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button className="send-btn" onClick={send} disabled={!text.trim() || streaming} aria-label="发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="composer-hint">Enter 发送 · Shift+Enter 换行</div>
      <div className="connection-label" title={settings?.model}><i className={settings?.apiKeySet ? 'connected' : ''} />{settings?.localMode ? '本地离线 · 随时记录' : settings?.apiKeySet ? '助手已就绪' : '连接模型，开始对话'}</div>
    </aside>
  );
}
