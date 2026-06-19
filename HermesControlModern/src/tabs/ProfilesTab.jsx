import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Activity, Bot, Check, History, MessageCircle, Play,
  RefreshCw, RotateCcw, Send, Settings, ShieldCheck, Square, Star, X
} from 'lucide-react';
import { Panel, ToggleSwitch } from '../components.jsx';

const PLATFORM_ICON = { telegram: Send, discord: MessageCircle };
const FILTERS = [
  { id: 'all', labelKey: 'filterAll' },
  { id: 'running', labelKey: 'filterRunning' },
  { id: 'restart', labelKey: 'filterRestart' },
  { id: 'codex', labelKey: 'filterCodex' },
  { id: 'claude', labelKey: 'filterClaude' },
  { id: 'problems', labelKey: 'filterProblems' }
];

const FRAMEWORK_FILTERS = [
  { id: 'all', labelKey: 'filterAll' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'openclaw', label: 'OpenClaw' }
];

function PlatformBadge({ platform }) {
  const Icon = PLATFORM_ICON[platform.name] || MessageCircle;
  const connected = platform.state === 'connected';
  const tone = connected ? 'on' : platform.state === 'error' ? 'err' : 'off';
  return (
    <span className={`pf-badge ${tone}`} title={`${platform.name}: ${platform.state}`}>
      <Icon size={12} />
      <span className="pf-name">{platform.name}</span>
      <span className="pf-dot" />
    </span>
  );
}

function ProfileSettingSelect({ label, value, options, disabled, defaultLabel, onChange }) {
  return (
    <label className="profile-setting-select">
      <span>{label}</span>
      <select value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.id === '' ? defaultLabel : opt.label || opt.id || defaultLabel}</option>
        ))}
      </select>
    </label>
  );
}

function formatShortTime(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ko-KR', { hour12: false }); }
  catch { return value; }
}

function ProfileSettingsModal({
  profile, label, runtimeState, opsState, modelOptions, reasoningOptions, busy,
  onClose, onSetDefault, onUpdateModelSettings, onSaveLabel, onRestart,
  onRestoreBackup, onLoadBackups, onLoadLogSummary, t
}) {
  const [labelText, setLabelText] = useState(label?.label || '');
  const [descText, setDescText] = useState(label?.desc || '');
  const [restartNotice, setRestartNotice] = useState(null);
  const [backups, setBackups] = useState([]);
  const [logSummary, setLogSummary] = useState(null);
  const [sectionBusy, setSectionBusy] = useState(false);

  useEffect(() => {
    setLabelText(label?.label || '');
    setDescText(label?.desc || '');
    setRestartNotice(null);
    setBackups([]);
    setLogSummary(null);
    if (!profile) return;
    let active = true;
    setSectionBusy(true);
    Promise.all([
      onLoadBackups(profile.name).catch(() => ({ backups: [] })),
      onLoadLogSummary(profile.name).catch(() => null)
    ]).then(([backupResult, summary]) => {
      if (!active) return;
      setBackups((backupResult && backupResult.backups) || []);
      setLogSummary(summary);
    }).finally(() => { if (active) setSectionBusy(false); });
    return () => { active = false; };
  }, [label, profile?.name]);

  if (!profile) return null;

  const displayName = label?.label || profile.name;
  const effectiveModelOptions = modelOptions.some((opt) => opt.id === profile.model)
    ? modelOptions
    : [{ id: profile.model || '', label: profile.model ? `${profile.model} (${t.currentValue})` : '—' }, ...modelOptions];
  const effectiveReasoningOptions = reasoningOptions.length
    ? reasoningOptions
    : [{ id: profile.reasoning || '', label: profile.reasoning || t.defaultValue }];
  const watchdog = opsState?.watchdog || {};
  const watchdogConfig = watchdog.config || {};
  const watchdogState = watchdog.state || {};
  const watchdogDesired = Array.isArray(watchdogState.desired) && watchdogState.desired.includes(profile.name);
  const retryInfo = Array.isArray(watchdogState.retries)
    ? watchdogState.retries.find((item) => item.name === profile.name)
    : null;
  const profileHistory = (opsState?.history || []).filter((item) => item.profile === profile.name).slice(0, 8);

  const saveLabel = async () => {
    await onSaveLabel(profile.name, labelText, descText);
  };

  const showRestartNotice = (title, body) => setRestartNotice({ title, body });

  const changeRuntimeSetting = async (patch, labelTextForNotice) => {
    const result = await onUpdateModelSettings(profile.name, patch);
    if (result && result.ok && result.requiresRestart) {
      showRestartNotice(
        t.restartChangeTitle(labelTextForNotice),
        t.restartChangeBody
      );
    }
  };

  const restoreBackup = async (backupId) => {
    const result = await onRestoreBackup(profile.name, backupId);
    if (result && result.ok && result.requiresRestart) {
      showRestartNotice(
        t.backupRestartTitle,
        t.backupRestartBody
      );
    }
    const next = await onLoadBackups(profile.name).catch(() => ({ backups: [] }));
    setBackups((next && next.backups) || []);
  };

  const restartNow = async () => {
    const result = await onRestart(profile);
    if (result && result.ok) setRestartNotice(null);
  };

  return (
    <div className="profile-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-label={t.profileSettingsAria(displayName)} onClick={(e) => e.stopPropagation()}>
        <header className="profile-modal-head">
          <div>
            <h3>{t.profileSettingsTitle(displayName)}</h3>
            <p>{profile.name} · {profile.provider || t.providerUnset}</p>
          </div>
          <button className="ghost small icon-only" title={t.close} onClick={onClose}><X size={15} /></button>
        </header>

        <div className="profile-modal-body">
          <section className="profile-modal-section">
            <h4>{t.modelAndReasoning}</h4>
            <div className="profile-modal-grid">
              <ProfileSettingSelect
                label={t.model}
                defaultLabel={t.defaultValue}
                value={profile.model || ''}
                options={effectiveModelOptions}
                disabled={busy}
                onChange={(value) => changeRuntimeSetting({ model: value }, t.model)}
              />
              <ProfileSettingSelect
                label={t.reasoning}
                defaultLabel={t.defaultValue}
                value={profile.reasoning || ''}
                options={effectiveReasoningOptions}
                disabled={busy}
                onChange={(value) => changeRuntimeSetting({ reasoning: value }, t.reasoning)}
              />
            </div>
            <p className="profile-help">
              {t.profileReasoningHelp}
            </p>
            {(restartNotice || runtimeState?.restartNeeded) ? (
              <div className="profile-restart-notice">
                <div>
                  <strong>{restartNotice?.title || t.restartNeededTitle}</strong>
                  <p>{restartNotice?.body || runtimeState?.reason || t.restartNeededBody}</p>
                  {runtimeState?.changedAt ? <small>{t.changedAt(formatShortTime(runtimeState.changedAt))}</small> : null}
                </div>
                <div className="profile-restart-actions">
                  <button className="ghost small" disabled={busy} onClick={() => setRestartNotice(null)}>{t.later}</button>
                  <button className="gw-toggle restart" disabled={busy} onClick={restartNow}>{t.restartNow}</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="profile-modal-section">
            <h4>{t.restoreBackupTitle}</h4>
            <p className="profile-muted-line">{t.restoreBackupHint}</p>
            <div className="profile-backup-list">
              {sectionBusy ? <span className="pf-none">{t.loading}</span> : backups.length ? backups.map((b) => (
                <div className="profile-backup-row" key={b.id}>
                  <span>{b.id}</span>
                  <button className="ghost small" disabled={busy} onClick={() => restoreBackup(b.id)}><RotateCcw size={12} /> {t.restore}</button>
                </div>
              )) : <span className="pf-none">{t.noBackups}</span>}
            </div>
          </section>

          <section className="profile-modal-section">
            <h4>{t.displayName}</h4>
            <div className="profile-label-form">
              <input className="label-input" type="text" maxLength={30} placeholder={t.displayNamePlaceholder(profile.name)} value={labelText} onChange={(e) => setLabelText(e.target.value)} />
              <input className="label-input desc" type="text" maxLength={60} placeholder={t.descriptionOptional} value={descText} onChange={(e) => setDescText(e.target.value)} />
              <button className="ghost small" disabled={busy} onClick={saveLabel}><Check size={13} /> {t.saveLabel}</button>
            </div>
          </section>

          <section className="profile-modal-section profile-two-col">
            <div>
              <h4><Activity size={14} /> {t.recentLogSummary}</h4>
              {logSummary && logSummary.ok ? (
                <div className="profile-summary-box">
                  <span>{t.errorsWarnings(logSummary.errorCount || 0, logSummary.warnCount || 0)}</span>
                  <small>{logSummary.lastLine || t.noRecentLog}</small>
                  {(logSummary.recentIssues || []).slice(-3).map((line, idx) => <code key={idx}>{line}</code>)}
                </div>
              ) : <span className="pf-none">{t.noLogSummary}</span>}
            </div>
            <div>
              <h4><ShieldCheck size={14} /> {t.autoRecovery}</h4>
              <div className="profile-summary-box">
                <span>{watchdogConfig.autoRestartEnabled ? t.autoRestartOn : t.autoRestartOff} · {t.maxAttempts(watchdogConfig.autoRestartMax || 3)}</span>
                <small>{watchdogDesired ? t.watchdogTracked : t.watchdogNotTracked}</small>
                {retryInfo ? <small>{t.recentRetries(retryInfo.count)}</small> : null}
              </div>
            </div>
          </section>

          <section className="profile-modal-section">
            <h4><History size={14} /> {t.changeHistory}</h4>
            <div className="profile-history-list">
              {profileHistory.length ? profileHistory.map((item, idx) => (
                <div className="profile-history-row" key={`${item.at}-${idx}`}>
                  <span>{formatShortTime(item.at)}</span>
                  <strong>{item.action}</strong>
                  <small>{(item.fields || []).join(', ') || item.backupId || ''}</small>
                </div>
              )) : <span className="pf-none">{t.noChangeHistory}</span>}
            </div>
          </section>
        </div>

        <footer className="profile-modal-actions">
          {profile.current ? <span className="chip">{t.currentDefaultProfile}</span> : <button className="ghost small" disabled={busy} onClick={() => onSetDefault(profile.name)}>{t.setDefaultProfile}</button>}
          <button className="ghost small" onClick={onClose}>{t.close}</button>
        </footer>
      </section>
    </div>
  );
}

function ProfileRow({ p, label, crashed, runtimeState, busy, t, onToggle, onRestart, onOpenSettings }) {
  const displayName = label?.label || p.name;
  const displayDesc = label?.desc || null;
  const rowClass = ['prow', p.running ? 'is-running' : '', p.current ? 'is-current' : '', crashed ? 'is-crashed' : '', runtimeState?.restartNeeded ? 'needs-restart' : ''].filter(Boolean).join(' ');

  return (
    <div className={rowClass}>
      <span className={`run-dot ${p.running ? 'on' : ''} ${crashed ? 'crash' : ''}`} />
      <span className="cell-name-stack">
        <span className="cell-name">
          {displayName}
          <span className="framework-chip hermes">Hermes</span>
          {p.current ? <Star size={13} className="star" /> : null}
          {crashed ? <span className="crash-tag" title={t.crashedTitle}><AlertTriangle size={11} /> {t.crashed}</span> : null}
          {runtimeState?.restartNeeded ? <span className="restart-tag">{t.restartNeeded}</span> : null}
        </span>
        {displayDesc ? <span className="cell-desc">{displayDesc}</span> : displayName !== p.name ? <span className="cell-tech-name">{p.name}</span> : null}
      </span>
      <span className="cell-muted profile-summary-cell">
        <span>{p.model || '—'}</span>
        <small>{t.reasoningSummary(p.reasoning || t.defaultValue)}</small>
      </span>
      <span className="cell-platforms">
        {p.platforms && p.platforms.length > 0 ? p.platforms.map((pf) => <PlatformBadge key={pf.name} platform={pf} />) : <span className="pf-none">—</span>}
      </span>
      <span className="cell-action">
        {runtimeState?.restartNeeded && p.running ? <button className="gw-toggle restart" disabled={busy} onClick={() => onRestart(p)}>{t.restartGateway}</button> : null}
        {p.running ? <button className="gw-toggle stop" disabled={busy} onClick={() => onToggle(p)} title={t.stopProfile(displayName)}><Square size={14} /> {t.stopGateway}</button> : <button className="gw-toggle start" disabled={busy} onClick={() => onToggle(p)} title={t.startProfile(displayName)}><Play size={14} /> {t.startGateway}</button>}
        <button className="gw-toggle settings" disabled={busy} onClick={() => onOpenSettings(p)} title={t.settingsFor(displayName)}><Settings size={14} /> {t.settings}</button>
      </span>
    </div>
  );
}

function OpenClawAgentRow({ agent, gatewayRunning, warnings = [], t }) {
  const issueCount = warnings.length;
  return (
    <div className={`prow openclaw-row ${gatewayRunning ? 'is-running' : ''} ${issueCount ? 'needs-attention' : ''}`}>
      <span className={`run-dot ${gatewayRunning ? 'on' : ''}`} />
      <span className="cell-name-stack">
        <span className="cell-name">
          {agent.name || agent.id || 'OpenClaw agent'}
          <span className="framework-chip openclaw">OpenClaw</span>
          {issueCount ? <span className="restart-tag">{t.attentionCount(issueCount)}</span> : null}
        </span>
        <span className="cell-tech-name">{agent.id || 'agent'}{agent.emoji ? ` · ${agent.emoji}` : ''}</span>
      </span>
      <span className="cell-muted profile-summary-cell">
        <span>{agent.model || t.modelUnset}</span>
        <small>{agent.runtime || t.runtimeUnset}</small>
      </span>
      <span className="cell-platforms">
        <span className={`pf-badge ${gatewayRunning ? 'on' : 'off'}`}>
          <Bot size={12} />
          <span className="pf-name">gateway</span>
          <span className="pf-dot" />
        </span>
      </span>
      <span className="cell-action">
        <span className="readonly-pill">{t.readonly}</span>
      </span>
    </div>
  );
}

export default function ProfilesTab({
  t, profiles, frameworks = [], labels, opsState = { runtime: {}, history: [], watchdog: null }, modelOptions = [], reasoningOptions = [], crashed, busyName, loading,
  onReload, onToggle, onRestart, onSetDefault, onUpdateModelSettings, onRestoreBackup, onLoadBackups, onLoadLogSummary, onSaveLabel
}) {
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [filter, setFilter] = useState('all');
  const [frameworkFilter, setFrameworkFilter] = useState('all');
  const [settingsProfileName, setSettingsProfileName] = useState('');
  const runtime = opsState.runtime || {};
  const openclawFramework = frameworks.find((fw) => fw && fw.id === 'openclaw') || null;
  const openclawAgents = Array.isArray(openclawFramework?.agents) ? openclawFramework.agents : [];
  const openclawGatewayRunning = Boolean(openclawFramework?.gateway?.running);
  const openclawWarnings = Array.isArray(openclawFramework?.warnings) ? openclawFramework.warnings : [];

  const rank = (p) => (crashed.has(p.name) ? 0 : runtime[p.name]?.restartNeeded ? 1 : p.running ? 2 : 3);
  const sorted = [...profiles].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const la = labels[a.name]?.label || a.name;
    const lb = labels[b.name]?.label || b.name;
    return la.localeCompare(lb, 'ko');
  });
  const filtered = sorted.filter((p) => {
    if (frameworkFilter === 'openclaw') return false;
    if (onlyRunning && !p.running) return false;
    if (filter === 'running') return p.running;
    if (filter === 'restart') return Boolean(runtime[p.name]?.restartNeeded);
    if (filter === 'codex') return p.provider === 'openai-codex' || /gpt-|codex/i.test(p.model || '');
    if (filter === 'claude') return p.provider === 'anthropic' || /claude/i.test(p.model || '');
    if (filter === 'problems') return crashed.has(p.name) || Boolean(runtime[p.name]?.restartNeeded) || (p.platforms || []).some((pf) => pf.state === 'error');
    return true;
  });
  const filteredOpenClawAgents = openclawAgents.filter((agent) => {
    if (frameworkFilter === 'hermes') return false;
    if (onlyRunning && !openclawGatewayRunning) return false;
    const modelText = `${agent.model || ''} ${agent.runtime || ''}`;
    if (filter === 'running') return openclawGatewayRunning;
    if (filter === 'restart') return false;
    if (filter === 'codex') return /gpt-|codex/i.test(modelText);
    if (filter === 'claude') return /claude/i.test(modelText);
    if (filter === 'problems') return openclawWarnings.length > 0;
    return true;
  });
  const runningCount = profiles.filter((p) => p.running).length;
  const restartCount = profiles.filter((p) => runtime[p.name]?.restartNeeded).length;
  const visibleCount = filtered.length + filteredOpenClawAgents.length;
  const totalCount = profiles.length + openclawAgents.length;
  const settingsProfile = profiles.find((p) => p.name === settingsProfileName) || null;

  const frameworkCounts = { all: totalCount, hermes: profiles.length, openclaw: openclawAgents.length };
  const action = (
    <div className="panel-actions profile-panel-actions">
      <div className="framework-segment" role="group" aria-label={t.frameworkFilterLabel}>
        {FRAMEWORK_FILTERS.map((item) => (
          <button key={item.id} type="button" className={frameworkFilter === item.id ? 'active' : ''} onClick={() => setFrameworkFilter(item.id)}>
            <span>{item.label || t[item.labelKey]}</span>
            <em>{frameworkCounts[item.id] || 0}</em>
          </button>
        ))}
      </div>
      <div className="profile-filter-wrap">
        <span>{t.view}</span>
        <select className="profile-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((item) => <option key={item.id} value={item.id}>{t[item.labelKey]}</option>)}
        </select>
      </div>
      <label className="mini-toggle"><ToggleSwitch checked={onlyRunning} onChange={setOnlyRunning} label={t.onlyRunning} /><span>{t.onlyRunning}</span></label>
      <button className="ghost small reload-soft" disabled={loading} onClick={onReload} title={t.refreshButton}><RefreshCw size={15} className={loading ? 'spin' : ''} /> {t.refreshButton}</button>
    </div>
  );

  return (
    <>
      <Panel icon={Bot} title={t.tabProfiles} action={action}>
        {visibleCount === 0 && !loading ? <div className="empty">{t.profilesEmpty}</div> : (
          <div className="table profiles-table">
            {filtered.map((p) => <ProfileRow key={`hermes-${p.name}`} p={p} label={labels[p.name]} crashed={crashed.has(p.name)} runtimeState={runtime[p.name]} busy={busyName === p.name} t={t} onToggle={onToggle} onRestart={onRestart} onOpenSettings={(profile) => setSettingsProfileName(profile.name)} />)}
            {filteredOpenClawAgents.map((agent) => <OpenClawAgentRow key={`openclaw-${agent.id || agent.name}`} agent={agent} gatewayRunning={openclawGatewayRunning} warnings={openclawWarnings} t={t} />)}
          </div>
        )}
      </Panel>
      <ProfileSettingsModal
        profile={settingsProfile}
        label={settingsProfile ? labels[settingsProfile.name] : null}
        runtimeState={settingsProfile ? runtime[settingsProfile.name] : null}
        opsState={opsState}
        modelOptions={modelOptions}
        reasoningOptions={reasoningOptions}
        busy={Boolean(settingsProfile && busyName === settingsProfile.name)}
        onClose={() => setSettingsProfileName('')}
        onSetDefault={onSetDefault}
        onUpdateModelSettings={onUpdateModelSettings}
        onRestoreBackup={onRestoreBackup}
        onLoadBackups={onLoadBackups}
        onLoadLogSummary={onLoadLogSummary}
        onSaveLabel={onSaveLabel}
        t={t}
        onRestart={onRestart}
      />
    </>
  );
}
