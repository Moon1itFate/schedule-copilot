import { useEffect, useState } from 'react';
import type { AppState, SettingsView } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { IconDownload } from './Icons';
import { PeriodEditor } from './PeriodEditor';
import { defaultPeriodEditing, periodEditingError, periodError } from '../lib/periods';

interface Props {
  settings: SettingsView;
  state: AppState;
  onClose: () => void;
  onPreviewReminder: () => void;
  onSaved: (payload: { state: AppState; settings: SettingsView }) => void;
}

const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
];

export function SettingsDialog({ settings, state, onClose, onSaved, onPreviewReminder }: Props) {
  const nativeReminders = /ScheduleCopilot\/0\.[4-9]/.test(navigator.userAgent);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState('');
  const [localMode, setLocalMode] = useState(Boolean(settings.localMode));
  const [temperature, setTemperature] = useState(settings.temperature);
  const [termName, setTermName] = useState(state.term.name);
  const [startDate, setStartDate] = useState(state.term.startDate);
  const [totalWeeks, setTotalWeeks] = useState(state.term.totalWeeks);
  const [periods, setPeriods] = useState(() => structuredClone(state.term.periods));
  const [periodEditing, setPeriodEditing] = useState(() => defaultPeriodEditing(state.term.periods, state.term.periodEditing));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [addresses, setAddresses] = useState<{ url: string; iface: string }[]>([]);

  useEffect(() => {
    api
      .addresses()
      .then((result) => setAddresses(result.addresses))
      .catch(() => setAddresses([]));
  }, []);

  const save = async () => {
    if (busy) return;
    const invalid = periodError(periods) ?? periodEditingError(periodEditing);
    if (invalid) {
      setMessage({ tone: 'bad', text: invalid });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.saveSettings({
        baseUrl,
        model,
        temperature,
        localMode,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      await api.saveTerm({ name: termName, startDate, totalWeeks, periods, periodEditing });
      const fresh = await api.state();
      onSaved({ state: fresh.state, settings: fresh.settings });
      onClose();
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (localMode) {
      setMessage({ tone: 'ok', text: '当前是本地离线模式：不需要 Key，也不联网。直接保存就能用。' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.testConnection({ baseUrl, model, apiKey: apiKey.trim() || undefined });
      setMessage({ tone: 'ok', text: result.message });
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = () => {
    const text = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state }, null, 2);
    if (__MOBILE__ && window.Phone) window.Phone.exportFile('日程罗盘备份.json', 'application/json', text);
    else {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = '日程罗盘备份.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  };
  const restoreBackup = async (file?: File) => {
    if (!file || !__MOBILE__) return;
    if (!window.confirm('恢复备份会替换手机当前的课程、待办和作息，继续？')) return;
    setBusy(true);
    try {
      const { restorePhoneBackup } = await import('../mobile/backend');
      restorePhoneBackup(await file.text());
      const fresh = await api.state(); onSaved({ state: fresh.state, settings: fresh.settings }); onClose();
    } catch (error) { setMessage({ tone: 'bad', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };

  const reset = async (demo: boolean) => {
    const tip = demo ? '载入示例数据会覆盖当前的课程和待办，继续？' : '清空所有课程和待办，继续？';
    if (!window.confirm(tip)) return;
    setBusy(true);
    try {
      const result = await api.reset(demo);
      const fresh = await api.state();
      onSaved({ state: result.state, settings: fresh.settings });
      onClose();
    } catch (error) {
      setMessage({ tone: 'bad', text: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="设置"
      subtitle="模型、学期与作息，改完立即生效"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            保存
          </button>
        </>
      }
    >
      <div className="settings">
        {message ? <div className={`form-note ${message.tone}`}>{message.text}</div> : null}
        <section>
          <h3>模型</h3>
          <div className="preset-row">
            <button className={`chip${localMode ? ' active' : ''}`} onClick={() => setLocalMode(true)}>
              本地离线（不用 Key）
            </button>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={`chip${!localMode && baseUrl === preset.baseUrl && model === preset.model ? ' active' : ''}`}
                onClick={() => {
                  setLocalMode(false);
                  setBaseUrl(preset.baseUrl);
                  setModel(preset.model);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {localMode ? (
            <div className="form-note ok">
              本地离线模式：不调用任何模型、不花钱，只认「明天下午三点前交高数作业」「周五前交报告」「下周三晚七点比赛」这类常见说法。想随便说就切回上面的服务商并填 Key。
            </div>
          ) : null}
          <label className="field">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>模型名</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
            </label>
            <label className="field">
              <span>温度</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.apiKeySet ? '已保存，留空表示不修改' : 'sk-...'}
            />
            <small>
              {__MOBILE__ ? 'Key 保存在手机 App 私有目录，仅在使用 AI 或测试连接时发送到你配置的 HTTPS 模型服务。电脑地址 127.0.0.1 在手机上不适用。' : 'Key 保存在电脑本地 data/settings.json，调用模型时会发送到你配置的服务商。'}
              <br />
              填完先点「测试连接」，通过后再点右下角「保存」。
            </small>
          </label>
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={test} disabled={busy}>
              {busy ? '测试中…' : '测试连接'}
            </button>
            <span className="muted small">测试用当前输入框里的地址和 Key，不会自动保存</span>
          </div>
        </section>

        <section>
          <h3>学期</h3>
          <label className="field">
            <span>学期名称</span>
            <input value={termName} onChange={(e) => setTermName(e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>第 1 周周一</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field">
              <span>总周数</span>
              <input type="number" min={1} max={30} value={totalWeeks} onChange={(e) => setTotalWeeks(Number(e.target.value))} />
            </label>
          </div>
        </section>

        <section>
          <h3>作息时间</h3>
          <PeriodEditor periods={periods} onChange={setPeriods} options={periodEditing} onOptionsChange={setPeriodEditing} disabled={busy} />
        </section>

        <section>
          <h3>任务提醒 · 流动岛</h3>
          <p className="muted small">安卓 App 支持在任务临近时弹出顶部胶囊悬浮窗，并发送系统通知。可选择提前 5、10、15、30 或 60 分钟提醒。</p>
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={onPreviewReminder}>预览流动岛提醒</button>
            {nativeReminders ? <a className="btn btn-primary" href="schedulecopilot://reminder-settings">设置手机提醒</a>
              : <a className="btn btn-ghost" href="/app.apk" download>下载新版安卓 App</a>}
          </div>
          <p className="muted small">{nativeReminders ? '点击「设置手机提醒」开启功能并授予通知、悬浮窗和精确提醒权限。' : '网页可预览样式；跨应用悬浮提醒需要安装新版安卓 App，在 App 的「任务提醒」中开启。'} 已同步的任务由手机本地调度；后台同步和弹窗可能受系统省电策略影响。</p>
        </section>

        {__MOBILE__ ? <section>
          <h3>手机独立版</h3>
          <p className="muted small">课表、待办和作息保存在手机上，电脑关机、手机断网也能使用。AI 在联网后直接调用上方配置的服务；也可选本地规则解析。卸载 App 或清除数据会删除本机安排，请定期导出备份。</p>
        </section> : <section>
          <h3>手机访问</h3>
          <p className="muted small">
            手机和电脑连同一个 Wi-Fi，在 APK 启动页填下面的地址；不确定就用「WLAN」那条。改过 Wi-Fi 或重启路由后 IP 可能变，回来这里看新的。
          </p>
          {addresses.length ? (
            addresses.map((item) => (
              <div className="addr-row" key={item.url}>
                <code>{item.url}</code>
                <span>{item.iface}</span>
                <button
                  className="btn btn-ghost small"
                  onClick={() => {
                    void navigator.clipboard?.writeText(item.url);
                  }}
                >
                  复制
                </button>
              </div>
            ))
          ) : (
            <p className="muted small">没有检测到局域网地址，检查电脑是否连着 Wi-Fi。</p>
          )}
          {addresses.length ? (
            <p className="muted small">
              手机浏览器打开 <code className="inline-code">{addresses[0].url}/app.apk</code> 可以直接下载安装包。
            </p>
          ) : null}
        </section>}

        <section>
          <h3>数据</h3>
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={exportBackup} disabled={busy}>导出完整备份</button>
            {__MOBILE__ ? <label className="btn btn-ghost">恢复备份
              <input type="file" accept=".json,application/json" disabled={busy} style={{ display: 'none' }} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void restoreBackup(file); }} />
            </label> : null}
          </div>
          <p className="muted small">完整备份保留学期、作息、课程与待办，不包含模型 Key。可将电脑版导出的 JSON 备份在手机恢复。</p>
          <div className="row-actions">
            <a className="btn btn-ghost" href="/api/export.ics" download>
              <IconDownload size={16} /> 导出 ICS
            </a>
            <button className="btn btn-ghost" onClick={() => reset(true)} disabled={busy}>
              载入示例数据
            </button>
            <button className="btn btn-ghost danger" onClick={() => reset(false)} disabled={busy}>
              清空数据
            </button>
          </div>
          <p className="muted small">导出后可导入手机日历 / Apple 日历 / Google 日历，课程按周次展开成重复事件。</p>
        </section>
      </div>
    </Modal>
  );
}
