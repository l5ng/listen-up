import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Check,
  Clock,
  LoaderCircle,
  Wrench,
  X,
} from 'lucide-react';
import type { GameUiState } from '@listen-up/game';
import { copy } from '../copy';

interface TraceDrawerProps {
  ui: GameUiState;
  open: boolean;
  onClose: () => void;
}

function EntryIcon({ entry }: { entry: GameUiState['trace'][number] }) {
  if (entry.kind === 'assistant') return <Brain size={14} />;
  if (entry.kind === 'tool') return <Wrench size={14} />;
  if (entry.kind === 'error') return <AlertTriangle size={14} />;
  return <ArrowRight size={14} />;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <LoaderCircle size={13} className="spin" />;
  if (status === 'done') return <Check size={13} />;
  if (status === 'error') return <X size={13} />;
  return <Clock size={13} />;
}

export function TraceDrawer({ ui, open, onClose }: TraceDrawerProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, ui.trace]);

  return (
    <aside className={`trace-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="trace-head">
        <div>
          <div className="trace-title">{copy.trace}</div>
        </div>
        <button className="btn icon-only ghost" onClick={onClose} aria-label="关闭行动记录">
          <X size={18} />
        </button>
      </div>
      <div className="trace-list" ref={listRef} role="log">
        {ui.trace.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {copy.traceEmpty}
          </p>
        ) : null}
        {ui.trace.map((entry) => (
          <div key={entry.id} className={`trace-entry ${entry.kind}`}>
            <div className="trace-entry-head">
              <EntryIcon entry={entry} />
              <span>{entry.title}</span>
              <span className="status">
                <StatusIcon status={entry.status} />
                {entry.status === 'running' ? '进行中' : entry.status === 'done' ? '完成' : '失败'}
                {entry.durationMs !== undefined
                  ? ` · ${(entry.durationMs / 1000).toFixed(1)}s`
                  : ''}
              </span>
            </div>
            {entry.text ? <div className="trace-entry-text">{entry.text}</div> : null}
            {entry.args ? (
              <details>
                <summary>原始参数</summary>
                <pre>{entry.args}</pre>
              </details>
            ) : null}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '10px 14px 14px',
          borderTop: '2px solid rgba(39,48,67,0.14)',
          fontSize: 12,
          color: 'var(--ink-soft)',
        }}
      >
        输入 {ui.promptTokens} tokens · 输出 {ui.completionTokens} tokens
      </div>
    </aside>
  );
}
