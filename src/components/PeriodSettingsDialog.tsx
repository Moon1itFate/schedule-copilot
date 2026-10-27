import { useState } from 'react';
import type { AppState } from '../types';
import { api } from '../api';
import { defaultPeriodEditing, periodEditingError, periodError } from '../lib/periods';
import { Modal } from './Modal';
import { PeriodEditor } from './PeriodEditor';

interface Props {
  state: AppState;
  focusPeriod?: number;
  onClose: () => void;
  onSaved: (state: AppState) => void;
}

export function PeriodSettingsDialog({ state, focusPeriod, onClose, onSaved }: Props) {
  const [periods, setPeriods] = useState(() => structuredClone(state.term.periods));
  const [periodEditing, setPeriodEditing] = useState(() => defaultPeriodEditing(state.term.periods, state.term.periodEditing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy || periodError(periods) || periodEditingError(periodEditing)) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.saveTerm({ periods, periodEditing });
      onSaved(result.state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="作息时间" subtitle="自定义每节课的时间段" size="lg" onClose={onClose} footer={
      <>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || Boolean(periodError(periods) || periodEditingError(periodEditing))} onClick={() => void save()}>{busy ? '保存中…' : '保存作息'}</button>
      </>
    }>
      <PeriodEditor periods={periods} onChange={setPeriods} options={periodEditing} onOptionsChange={setPeriodEditing} disabled={busy} focusPeriod={focusPeriod} />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </Modal>
  );
}
