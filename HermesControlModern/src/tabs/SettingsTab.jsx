import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Gauge, Languages, LifeBuoy, MemoryStick, MonitorOff, Moon, Power, RefreshCw, RotateCcw, Save, Settings, Timer, Zap } from 'lucide-react';
import { Panel, SettingRow, ToggleSwitch } from '../components.jsx';
import { languageOptions, themeOptions } from '../i18n.js';
import LogTab from './LogTab.jsx';

// Slider whose thumb tracks the drag locally and immediately (smooth, snaps to
// `step`), while the backend write is debounced. Persisting on every tick made
// the input go `disabled` mid-drag (settingsBusy) and reset the thumb to the
// stale prop value before the IPC round-trip returned — which felt like it only
// moved ~10 per grab. Local state decouples the visual from the async write.
function DebouncedSlider({ icon: Icon, min, max, step, value, disabled, unit, onCommit }) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef(null);
  const draggingRef = useRef(false);

  // Sync from props only when not actively dragging, so an external update
  // (or the echoed value coming back from the backend) doesn't fight the drag.
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = (next) => {
    draggingRef.current = true;
    setLocal(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      draggingRef.current = false;
      onCommit(next);
    }, 250);
  };

  const commitNow = () => {
    clearTimeout(timerRef.current);
    draggingRef.current = false;
    onCommit(local);
  };

  return (
    <div className="slider-wrap">
      <Icon size={15} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => handleChange(Number(e.target.value))}
        onMouseUp={commitNow}
        onKeyUp={commitNow}
        onTouchEnd={commitNow}
      />
      <span className="slider-value">{local}{unit}</span>
    </div>
  );
}

// WSL RAM allocation editor. Writes %USERPROFILE%\.wslconfig ([wsl2] memory=NGB).
// Changes need a `wsl --shutdown` to take effect — offered as a separate
// "Apply now" button so saving and restarting are distinct choices.
function WslMemoryPanel({ t, onToast }) {
  const [info, setInfo] = useState(null); // { totalGb, currentGb, raw, exists }
  const [limit, setLimit] = useState(true); // false => auto (no memory= line)
  const [gb, setGb] = useState(8);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const res = await window.hermes.getWslMemory();
    setInfo(res);
    if (res.currentGb && res.currentGb > 0) {
      setLimit(true);
      setGb(res.currentGb);
    } else {
      setLimit(false);
      setGb(Math.max(2, Math.round((res.totalGb || 16) / 2)));
    }
  };

  useEffect(() => { reload(); }, []);

  const maxGb = info ? Math.max(4, info.totalGb - 2) : 32; // leave headroom for Windows

  const save = async (applyNow) => {
    if (applyNow && !window.confirm(t.wslRestartApplyConfirm)) return;
    setBusy(true);
    try {
      const value = limit ? gb : 0; // 0 => clear the limit (WSL auto-default)
      const res = await window.hermes.setWslMemory(value, applyNow);
      if (onToast) {
        if (res && res.restarted) onToast(limit ? t.wslMemoryApplied(gb) : t.wslMemoryLimitRemovedApplied, 'ok');
        else onToast(limit ? t.wslMemorySavedRestart(gb) : t.wslMemoryLimitRemovedSaved, 'info', 6000);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      icon={MemoryStick}
      title={t.wslMemoryTitle}
      subtitle={info ? t.wslMemorySubtitle(info.totalGb, info.raw) : t.wslMemorySubtitleLoading}
    >
      <div className="settings-grid">
        <SettingRow title={t.memoryDirectLimit} hint={t.memoryDirectLimitHint}>
          <ToggleSwitch checked={limit} disabled={busy} label={t.memoryDirectLimit} onChange={setLimit} />
        </SettingRow>

        <SettingRow title={t.maxMemory} hint={t.maxMemoryHint(maxGb)}>
          <DebouncedSlider
            icon={MemoryStick}
            min={2}
            max={maxGb}
            step={1}
            value={gb}
            disabled={busy || !limit}
            unit="GB"
            onCommit={setGb}
          />
        </SettingRow>
      </div>

      <div className="wsl-mem-actions">
        <div className="wsl-mem-note">
          {t.changesApplyAfterWslRestart}
        </div>
        <button className="ghost small" disabled={busy} onClick={() => save(false)}>
          <Save size={15} /> {t.save}
        </button>
        <button className="gw-toggle start" disabled={busy} onClick={() => save(true)}>
          <Zap size={15} /> {t.saveAndApplyNow}
        </button>
      </div>
    </Panel>
  );
}

function ConnectionPanel({ settings, settingsBusy, t, onUpdate, onToast }) {
  const [draft, setDraft] = useState({
    wslDistro: settings.wslDistro || 'Ubuntu',
    labRoot: settings.labRoot || '',
    hermesHome: settings.hermesHome || '',
    labUnc: settings.labUnc || '',
    dashboardUrl: settings.dashboardUrl || 'http://127.0.0.1:9119',
    dashboardTaskName: settings.dashboardTaskName || 'Hermes Dashboard 9119'
  });

  useEffect(() => {
    setDraft({
      wslDistro: settings.wslDistro || 'Ubuntu',
      labRoot: settings.labRoot || '',
      hermesHome: settings.hermesHome || '',
      labUnc: settings.labUnc || '',
      dashboardUrl: settings.dashboardUrl || 'http://127.0.0.1:9119',
      dashboardTaskName: settings.dashboardTaskName || 'Hermes Dashboard 9119'
    });
  }, [settings.wslDistro, settings.labRoot, settings.hermesHome, settings.labUnc, settings.dashboardUrl, settings.dashboardTaskName]);

  const configured = Boolean(settings.labRoot && settings.hermesHome);
  const setField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const save = async () => {
    const next = await onUpdate(draft);
    if (onToast) {
      const ok = Boolean((next || draft).labRoot && (next || draft).hermesHome);
      onToast(ok ? t.connectionSavedToast : t.connectionMissingToast, ok ? 'ok' : 'warn', 6500);
    }
  };

  return (
    <Panel
      icon={Settings}
      title={t.connectionTitle}
      subtitle={configured ? t.connectionSubtitleConfigured(settings.wslDistro, settings.labRoot) : t.connectionSubtitleUnconfigured}
    >
      <div className="connection-notice">
        {t.connectionNotice}
      </div>
      <div className="settings-grid connection-grid">
        <SettingRow title={t.wslDistro} hint={t.wslDistroHint}>
          <input className="path-input" value={draft.wslDistro} disabled={settingsBusy} onChange={(e) => setField('wslDistro', e.target.value)} placeholder="Ubuntu" />
        </SettingRow>

        <SettingRow title={t.hermesLabRoot} hint={t.hermesLabRootHint}>
          <input className="path-input" value={draft.labRoot} disabled={settingsBusy} onChange={(e) => setField('labRoot', e.target.value)} placeholder="/home/<user>/hermes-lab" />
        </SettingRow>

        <SettingRow title={t.hermesHome} hint={t.hermesHomeHint}>
          <input className="path-input" value={draft.hermesHome} disabled={settingsBusy} onChange={(e) => setField('hermesHome', e.target.value)} placeholder="/home/<user>/.hermes" />
        </SettingRow>

        <SettingRow title={t.windowsLabFolder} hint={t.windowsLabFolderHint}>
          <input className="path-input" value={draft.labUnc} disabled={settingsBusy} onChange={(e) => setField('labUnc', e.target.value)} placeholder="\\\\wsl.localhost\\Ubuntu\\home\\<user>\\hermes-lab" />
        </SettingRow>

        <SettingRow title={t.dashboardUrlLabel} hint={t.dashboardUrlHint}>
          <input className="path-input" value={draft.dashboardUrl} disabled={settingsBusy} onChange={(e) => setField('dashboardUrl', e.target.value)} placeholder="http://127.0.0.1:9119" />
        </SettingRow>

        <SettingRow title={t.dashboardTask} hint={t.dashboardTaskHint}>
          <input className="path-input" value={draft.dashboardTaskName} disabled={settingsBusy} onChange={(e) => setField('dashboardTaskName', e.target.value)} placeholder="Hermes Dashboard 9119" />
        </SettingRow>
      </div>

      <div className="connection-actions">
        <div className={`connection-state ${configured ? 'ok' : 'warn'}`}>
          {configured ? t.connectionSavedState : t.connectionMissingState}
        </div>
        <button className="gw-toggle start" disabled={settingsBusy} onClick={save}>
          <Save size={15} /> {t.saveConnection}
        </button>
      </div>
    </Panel>
  );
}

function BasicSettingsPanel({ settings, settingsBusy, t, onUpdate }) {
  return (
    <Panel icon={Settings} title={t.settings} subtitle={t.settingsSubtitle}>
      <div className="settings-grid">
        <SettingRow title={t.launchOnStartup} hint={t.launchOnStartupHint}>
          <ToggleSwitch
            checked={settings.startupEnabled}
            disabled={settingsBusy}
            label={t.launchOnStartup}
            onChange={(v) => onUpdate({ startupEnabled: v })}
          />
        </SettingRow>

        <label className="setting-row" htmlFor="theme-select">
          <div className="setting-copy">
            <span>{t.theme}</span>
            <small>{t.themeHint}</small>
          </div>
          <div className="select-wrap">
            <Moon size={17} />
            <select
              id="theme-select"
              value={settings.theme || 'system'}
              disabled={settingsBusy}
              onChange={(event) => onUpdate({ theme: event.target.value })}
            >
              {themeOptions.map((option) => (
                <option key={option.value} value={option.value}>{t[option.labelKey]}</option>
              ))}
            </select>
          </div>
        </label>

        <label className="setting-row" htmlFor="language-select">
          <div className="setting-copy">
            <span>{t.language}</span>
            <small>{t.languageHint}</small>
          </div>
          <div className="select-wrap">
            <Languages size={17} />
            <select
              id="language-select"
              value={settings.language}
              disabled={settingsBusy}
              onChange={(event) => onUpdate({ language: event.target.value })}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </label>
      </div>
    </Panel>
  );
}

function UpdatePanel({ t, onToast }) {
  const [appInfo, setAppInfo] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    window.hermes.getAppInfo().then((info) => {
      if (active) setAppInfo(info || null);
    }).catch(() => {
      if (active) setAppInfo(null);
    });
    return () => { active = false; };
  }, []);

  const check = async () => {
    setBusy(true);
    try {
      const next = await window.hermes.checkForUpdates();
      setUpdateInfo(next || null);
      if (onToast) {
        if (!next || !next.ok) {
          const message = next && next.status === 404 ? t.updateMissingToast : t.updateFailedToast;
          onToast(message, 'warn', 6500);
        } else if (next.hasUpdate) onToast(t.updateAvailableToast(next.latestVersion), 'ok', 6500);
        else onToast(t.updateCurrentToast, 'ok');
      }
    } finally {
      setBusy(false);
    }
  };

  const openReleasePage = async () => {
    await window.hermes.openReleasePage();
  };

  const version = appInfo?.version || updateInfo?.currentVersion || t.checkingVersion;
  const displayVersion = version === t.checkingVersion ? version : `v${version}`;
  const releaseHint = t.releaseHint(appInfo?.releaseRepo);
  let statusText = t.updateNotChecked;
  let stateTone = 'warn';
  if (updateInfo) {
    if (!updateInfo.ok) {
      statusText = updateInfo.status === 404 ? t.updateReleaseMissing : t.updateCheckFailed;
      stateTone = 'warn';
    } else if (updateInfo.hasUpdate) {
      statusText = t.updateAvailable(updateInfo.latestVersion);
      stateTone = 'ok';
    } else {
      statusText = t.updateCurrent;
      stateTone = 'ok';
    }
  }

  return (
    <Panel icon={RefreshCw} title={t.updateTitle} subtitle={t.updateSubtitle}>
      <div className="settings-grid">
        <div className="setting-row">
          <div className="setting-copy">
            <span>{t.currentVersion}</span>
            <small>{releaseHint}</small>
          </div>
          <strong>{displayVersion}</strong>
        </div>
      </div>

      <div className="connection-actions">
        <div className={`connection-state ${stateTone}`}>{statusText}</div>
        <button className="ghost small" disabled={busy} onClick={check}>
          <RefreshCw size={15} /> {t.checkLatestVersion}
        </button>
        <button className="gw-toggle start" disabled={busy} onClick={openReleasePage}>
          <ExternalLink size={15} /> {t.downloadNewVersion}
        </button>
      </div>
    </Panel>
  );
}

export default function SettingsTab({ settings, settingsBusy, t, onUpdate, onToast }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="settings-stack">
      <BasicSettingsPanel settings={settings} settingsBusy={settingsBusy} t={t} onUpdate={onUpdate} />

      <UpdatePanel t={t} onToast={onToast} />

      <section className="actions settings-details-actions">
        <button className={`ghost details-toggle ${detailsOpen ? 'open' : ''}`} disabled={settingsBusy} onClick={() => setDetailsOpen((v) => !v)}>
          <ChevronDown size={18} /> {detailsOpen ? t.detailsClose : t.detailsOpen}
        </button>
      </section>

      {detailsOpen ? (
        <section className="status-details" aria-label={t.detailsSettingsLabel}>
          <ConnectionPanel settings={settings} settingsBusy={settingsBusy} t={t} onUpdate={onUpdate} onToast={onToast} />

          <Panel icon={Power} title={t.powerSettings} subtitle={t.powerSettingsSubtitle}>
            <div className="settings-grid">
              <SettingRow title={t.autoServerMode} hint={t.autoServerModeHint}>
                <ToggleSwitch
                  checked={settings.autoServerEnabled}
                  disabled={settingsBusy}
                  label={t.autoServerMode}
                  onChange={(v) => onUpdate({ autoServerEnabled: v })}
                />
              </SettingRow>

              <SettingRow title={t.displayOff} hint={t.displayOffHint}>
                <ToggleSwitch
                  checked={settings.turnOffDisplayOnServer}
                  disabled={settingsBusy}
                  label={t.displayOff}
                  onChange={(v) => onUpdate({ turnOffDisplayOnServer: v })}
                />
              </SettingRow>

              <SettingRow title={t.idleThreshold} hint={t.idleThresholdHint}>
                <DebouncedSlider
                  icon={Timer}
                  min={1}
                  max={120}
                  step={1}
                  value={settings.idleThresholdMinutes}
                  disabled={!settings.autoServerEnabled}
                  unit={t.minutesUnit}
                  onCommit={(v) => onUpdate({ idleThresholdMinutes: v })}
                />
              </SettingRow>

              <SettingRow title={t.cpuCapLabel} hint={t.cpuCapHint}>
                <DebouncedSlider
                  icon={Gauge}
                  min={20}
                  max={100}
                  step={5}
                  value={settings.serverCpuMax}
                  unit={t.percentUnit}
                  onCommit={(v) => onUpdate({ serverCpuMax: v })}
                />
              </SettingRow>
            </div>
          </Panel>

          <Panel icon={LifeBuoy} title={t.gatewayRecoveryTitle} subtitle={t.gatewayRecoverySubtitle}>
            <div className="settings-grid">
              <SettingRow title={t.crashAutoRestart} hint={t.crashAutoRestartHint}>
                <ToggleSwitch
                  checked={settings.autoRestartEnabled}
                  disabled={settingsBusy}
                  label={t.autoRestart}
                  onChange={(v) => onUpdate({ autoRestartEnabled: v })}
                />
              </SettingRow>

              <SettingRow title={t.maxRetries} hint={t.maxRetriesHint}>
                <DebouncedSlider
                  icon={RotateCcw}
                  min={1}
                  max={10}
                  step={1}
                  value={settings.autoRestartMax}
                  disabled={!settings.autoRestartEnabled}
                  unit={t.attemptsUnit}
                  onCommit={(v) => onUpdate({ autoRestartMax: v })}
                />
              </SettingRow>
            </div>
          </Panel>

          <WslMemoryPanel t={t} onToast={onToast} />

          <LogTab t={t} />
        </section>
      ) : null}
    </div>
  );
}
