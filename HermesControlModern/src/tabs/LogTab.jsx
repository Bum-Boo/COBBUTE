import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, Pause, Trash2 } from 'lucide-react';
import { Panel, ToggleSwitch } from '../components.jsx';

const MAX_LINES = 2500;
const ALL_LOGS = '__all__';

function lineTone(line) {
  if (/\b(ERROR|CRITICAL|Traceback|Exception|failed|failure)\b/i.test(line)) return 'err';
  if (/\bWARN(ING)?\b|timeout|retry/i.test(line)) return 'warn';
  if (/\b(INFO)\b/.test(line)) return 'info';
  return '';
}

export default function LogTab({ t }) {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const lineKey = useRef(0);

  useEffect(() => {
    const off = window.hermes.onLogLine((payload) => {
      if (!payload || payload.name !== ALL_LOGS) return;
      setLines((prev) => {
        const next = prev.concat({ id: ++lineKey.current, text: payload.line });
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    const offEnd = window.hermes.onLogEnd(() => setStreaming(false));
    setLines([]);
    setStreaming(true);
    window.hermes.logStart(ALL_LOGS);
    return () => {
      off();
      offEnd();
      window.hermes.logStop();
    };
  }, []);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const action = (
    <div className="panel-actions">
      <label className="mini-toggle">
        <ToggleSwitch checked={follow} onChange={setFollow} label={t.logFollow} />
        <span>{t.logFollow}</span>
      </label>
      <button className="ghost small" onClick={() => setLines([])} title={t.logClear}>
        <Trash2 size={15} /> {t.logClear}
      </button>
    </div>
  );

  return (
    <Panel
      icon={FileText}
      title={t.allLogsTitle}
      subtitle={t.allLogsSubtitle}
      action={action}
    >
      <div className="log-view" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="log-empty">
            {streaming ? <><Pause size={14} className="spin" /> {t.waitingAllLogs}</> : <>{t.noLogs}</>}
          </div>
        ) : (
          lines.map((l) => <div key={l.id} className={`log-line ${lineTone(l.text)}`}>{l.text || ' '}</div>)
        )}
      </div>
      <div className="log-foot">
        <span><ArrowDownToLine size={13} /> {t.logLineCount(lines.length)}{lines.length >= MAX_LINES ? t.recentLinesOnly(MAX_LINES) : ''}</span>
      </div>
    </Panel>
  );
}
