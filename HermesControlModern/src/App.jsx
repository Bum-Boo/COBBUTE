import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Cpu, LayoutGrid, Settings } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { Tabs, ToastStack } from './components.jsx';
import { makeStrings, messageKeyForStatus, formatTime } from './i18n.js';
import StatusTab from './tabs/StatusTab.jsx';
import ProfilesTab from './tabs/ProfilesTab.jsx';
import DiagnosticsTab from './tabs/DiagnosticsTab.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';
import './styles.css';

const emptyStatus = {
  wslRunning: false,
  dashboardOnline: false,
  gateway: 'unknown',
  codexAuth: 'unknown',
  ready: false,
  checkedAt: null
};


function applyThemePreference(theme) {
  const normalized = theme === 'light' || theme === 'dark' ? theme : '';
  if (normalized) {
    document.documentElement.dataset.theme = normalized;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

const defaultSettings = {
  language: 'ko',
  theme: 'system',
  startupEnabled: false,
  autoServerEnabled: true,
  idleThresholdMinutes: 20,
  serverCpuMax: 70,
  turnOffDisplayOnServer: true,
  wslDistro: 'Ubuntu',
  dashboardUrl: 'http://127.0.0.1:9119',
  dashboardTaskName: 'Hermes Dashboard 9119',
  labUnc: '',
  labRoot: '',
  hermesHome: '',
  autoRestartEnabled: false,
  autoRestartMax: 3
};

function App() {
  const [status, setStatus] = useState(emptyStatus);
  const [mode, setMode] = useState(null);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [messageKey, setMessageKey] = useState('checking');
  const [tab, setTab] = useState('status');
  const [frameworks, setFrameworks] = useState([]);

  // Lifted profile state (shared by Status summary + Profiles table + Logs).
  const [profiles, setProfiles] = useState([]);
  const [labels, setLabels] = useState({});
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [busyName, setBusyName] = useState('');
  const [modelOptions, setModelOptions] = useState({ models: [], reasoning: [] });
  const [opsState, setOpsState] = useState({ runtime: {}, history: [], watchdog: null });
  const [crashed, setCrashed] = useState(() => new Set());

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const t = useMemo(() => makeStrings(settings.language), [settings.language]);
  const tRef = useRef(t);

  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => {
    applyThemePreference(settings.theme);
  }, [settings.theme]);

  const pushToast = useCallback((msg, tone = 'info', ttl = 4500) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-4), { id, msg, tone }]);
    if (ttl > 0) setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl);
  }, []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  const clearRecoveredCrashBadges = useCallback((nextProfiles) => {
    const runningNames = new Set((nextProfiles || []).filter((p) => p && p.running).map((p) => p.name));
    if (runningNames.size === 0) return;
    setCrashed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const name of runningNames) {
        if (next.delete(name)) changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const refresh = async () => {
    const next = await window.hermes.getStatus();
    setStatus(next);
    setMessageKey(messageKeyForStatus(next));
    const fw = await window.hermes.getFrameworks();
    if (fw && Array.isArray(fw.frameworks)) setFrameworks(fw.frameworks);
  };

  const refreshHistory = async () => {
    const h = await window.hermes.getModeHistory();
    setHistory(Array.isArray(h) ? h : []);
  };

  const loadProfiles = useCallback(async (spin = true) => {
    if (spin) setProfilesLoading(true);
    try {
      const [result, lbls, ops, fw] = await Promise.all([
        window.hermes.getProfiles(),
        window.hermes.getProfileLabels(),
        window.hermes.getProfileOpsState(),
        window.hermes.getFrameworks()
      ]);
      if (result && result.ok) {
        const nextProfiles = result.profiles || [];
        setProfiles(nextProfiles);
        clearRecoveredCrashBadges(nextProfiles);
      } else if (result && result.profiles) {
        setProfiles(result.profiles);
        clearRecoveredCrashBadges(result.profiles);
      }
      if (fw && Array.isArray(fw.frameworks)) setFrameworks(fw.frameworks);
      setLabels(lbls || {});
      if (ops) setOpsState({ runtime: ops.runtime || {}, history: ops.history || [], watchdog: ops.watchdog || null });
    } finally {
      setProfilesLoading(false);
    }
  }, [clearRecoveredCrashBadges]);

  // Display name resolver used in toast messages.
  const nameOf = useCallback((tech) => (labels[tech]?.label || tech), [labels]);

  useEffect(() => {
    let active = true;
    window.hermes.getSettings().then((next) => { if (active) setSettings({ ...defaultSettings, ...next }); });
    window.hermes.getModelOptions().then((next) => {
      if (active && next) setModelOptions({ models: next.models || [], reasoning: next.reasoning || [] });
    });
    window.hermes.getMode().then((m) => { if (active && m) setMode(m); });
    refresh();
    refreshHistory();
    loadProfiles();

    const unsubscribeStatus = window.hermes.onStatusChanged((next) => {
      setStatus(next);
      setMessageKey(messageKeyForStatus(next));
    });
    const unsubscribeMode = window.hermes.onModeChanged((next) => {
      setMode(next);
      refreshHistory();
    });
    const unsubscribeSettings = window.hermes.onSettingsChanged((next) => {
      setSettings({ ...defaultSettings, ...next });
    });
    // Watchdog pushes the full profile list on its own cadence (~20s).
    const unsubscribeProfiles = window.hermes.onProfilesUpdated((payload) => {
      if (payload && Array.isArray(payload.profiles)) {
        setProfiles(payload.profiles);
        clearRecoveredCrashBadges(payload.profiles);
      }
    });
    // Gateway lifecycle events → toasts + crash badges.
    const unsubscribeGw = window.hermes.onGatewayEvent((e) => {
      if (!e || !e.name) return;
      const label = nameOf(e.name);
      const text = tRef.current;
      if (e.type === 'crash') {
        setCrashed((prev) => new Set(prev).add(e.name));
        pushToast(text.gatewayCrashedToast(label), 'warn', 7000);
      } else if (e.type === 'restarting') {
        pushToast(text.gatewayRestartingToast(label, e.attempt, e.max), 'busy', 4000);
      } else if (e.type === 'restarted') {
        setCrashed((prev) => { const n = new Set(prev); n.delete(e.name); return n; });
        pushToast(text.gatewayRestartedToast(label), 'ok');
      } else if (e.type === 'restart-failed') {
        pushToast(text.gatewayRestartFailedToast(label), 'err', 7000);
      }
    });

    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      unsubscribeStatus();
      unsubscribeMode();
      unsubscribeSettings();
      unsubscribeProfiles();
      unsubscribeGw();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAction = async (action) => {
    setBusy(true);
    setMessageKey(action === 'start' ? 'starting' : 'stopping');
    try {
      const next = action === 'start' ? await window.hermes.start() : await window.hermes.stop();
      setStatus(next);
      setMessageKey(next.ready ? 'readyMessage' : action === 'stop' ? 'stoppedClean' : 'startSent');
    } finally {
      setBusy(false);
    }
  };

  const shutdownWsl = async () => {
    setBusy(true);
    setMessageKey('stopping');
    try {
      const res = await window.hermes.shutdownWsl();
      if (res && res.cancelled) {
        if (res.status) setStatus(res.status);
        return;
      }
      if (res && res.status) {
        setStatus(res.status);
        setMessageKey(messageKeyForStatus(res.status));
      }
      pushToast(t.wslShutdownDoneToast, 'ok');
    } finally {
      setBusy(false);
    }
  };

  const enterServer = async () => {
    setBusy(true);
    try {
      const next = await window.hermes.enterServerMode();
      if (next) setMode(next);
      await refreshHistory();
    } finally { setBusy(false); }
  };

  const exitServer = async () => {
    setBusy(true);
    try {
      const next = await window.hermes.exitServerMode();
      if (next) setMode(next);
      await refreshHistory();
    } finally { setBusy(false); }
  };

  const updateSettings = async (patch) => {
    setSettingsBusy(true);
    try {
      const next = await window.hermes.updateSettings(patch);
      setSettings({ ...defaultSettings, ...next });
      return next;
    } finally { setSettingsBusy(false); }
  };

  // --- profile actions (lifted so Status + Profiles + watchdog stay in sync) ---
  const toggleGateway = async (p) => {
    setBusyName(p.name);
    const label = nameOf(p.name);
    try {
      if (p.running) {
        await window.hermes.gatewayStop(p.name);
        pushToast(t.gatewayStoppedToast(label), 'info');
      } else {
        // Clear any prior crash flag — the user is deliberately (re)starting it.
        setCrashed((prev) => { const n = new Set(prev); n.delete(p.name); return n; });
        await window.hermes.gatewayStart(p.name);
        pushToast(t.gatewayStartedToast(label), 'ok');
      }
      await loadProfiles(false);
      setTimeout(() => loadProfiles(false), 2500);
    } finally {
      setBusyName('');
    }
  };

  const setDefaultProfile = async (name) => {
    setBusyName(name);
    try {
      await window.hermes.useProfile(name);
      pushToast(t.defaultProfileSetToast(nameOf(name)), 'ok');
      await loadProfiles(false);
    } finally { setBusyName(''); }
  };

  const restartGateway = async (p) => {
    setBusyName(p.name);
    const label = nameOf(p.name);
    try {
      await window.hermes.gatewayStop(p.name);
      setCrashed((prev) => { const n = new Set(prev); n.delete(p.name); return n; });
      await window.hermes.gatewayStart(p.name);
      pushToast(t.gatewayRestartedManualToast(label), 'ok');
      await loadProfiles(false);
      setTimeout(() => loadProfiles(false), 2500);
      return { ok: true };
    } catch (error) {
      pushToast(t.gatewayRestartFailedManualToast(label), 'err', 7000);
      return { ok: false, error };
    } finally {
      setBusyName('');
    }
  };

  const saveLabel = async (name, label, desc) => {
    const updated = await window.hermes.setProfileLabel(name, label, desc);
    setLabels(updated || {});
  };

  const updateProfileModelSettings = async (name, patch) => {
    setBusyName(name);
    try {
      const result = await window.hermes.setProfileModelSettings(name, patch);
      if (!result || !result.ok) {
        pushToast(t.profileSettingsFailedToast(nameOf(name)), 'err', 7000);
        return { ok: false, result };
      }
      const changed = Object.prototype.hasOwnProperty.call(patch, 'model') ? t.modelChanged : t.reasoningChanged;
      const isRunning = profiles.some((p) => p.name === name && p.running);
      pushToast(t.profileSettingSavedToast(nameOf(name), changed, isRunning), 'ok', 6500);
      await loadProfiles(false);
      return { ok: true, result, requiresRestart: isRunning, changed };
    } finally { setBusyName(''); }
  };

  const restoreProfileBackup = async (name, backupId) => {
    setBusyName(name);
    try {
      const result = await window.hermes.restoreProfileBackup(name, backupId);
      if (!result || !result.ok) {
        pushToast(t.backupRestoreFailedToast(nameOf(name)), 'err', 7000);
        return { ok: false, result };
      }
      const isRunning = profiles.some((p) => p.name === name && p.running);
      pushToast(t.backupRestoreDoneToast(nameOf(name), isRunning), 'ok', 6500);
      await loadProfiles(false);
      return { ok: true, result, requiresRestart: isRunning };
    } finally { setBusyName(''); }
  };

  const loadProfileBackups = async (name) => window.hermes.getProfileBackups(name);
  const loadProfileLogSummary = async (name) => window.hermes.getProfileLogSummary(name);

  const profileSummary = useMemo(() => {
    const running = profiles.filter((p) => p.running);
    const platformsConnected = profiles.reduce((acc, p) => {
      (p.platforms || []).forEach((pf) => { if (pf.state === 'connected') acc += 1; });
      return acc;
    }, 0);
    return {
      running: running.length,
      total: profiles.length,
      connected: platformsConnected,
      crashed: crashed.size
    };
  }, [profiles, crashed]);

  const tabs = [
    { id: 'status', label: t.tabStatus, icon: LayoutGrid },
    { id: 'profiles', label: t.tabProfiles, icon: Bot },
    { id: 'diagnostics', label: t.tabDiagnostics, icon: Cpu },
    { id: 'settings', label: t.tabSettings, icon: Settings }
  ];

  return (
    <main className="app-shell">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'status' && (
        <StatusTab
          status={status}
          mode={mode}
          history={history}
          summary={profileSummary}
          frameworks={frameworks}
          t={t}
          busy={busy}
          messageKey={messageKey}
          onAction={runAction}
          onRefresh={refresh}
          onShutdownWsl={shutdownWsl}
          onEnterServer={enterServer}
          onExitServer={exitServer}
        />
      )}
      {tab === 'profiles' && (
        <ProfilesTab
          t={t}
          profiles={profiles}
          frameworks={frameworks}
          labels={labels}
          modelOptions={modelOptions.models}
          reasoningOptions={modelOptions.reasoning}
          opsState={opsState}
          crashed={crashed}
          busyName={busyName}
          loading={profilesLoading}
          onReload={() => loadProfiles(true)}
          onToggle={toggleGateway}
          onRestart={restartGateway}
          onSetDefault={setDefaultProfile}
          onUpdateModelSettings={updateProfileModelSettings}
          onRestoreBackup={restoreProfileBackup}
          onLoadBackups={loadProfileBackups}
          onLoadLogSummary={loadProfileLogSummary}
          onSaveLabel={saveLabel}
        />
      )}
      {tab === 'diagnostics' && <DiagnosticsTab t={t} />}
      {tab === 'settings' && <SettingsTab settings={settings} settingsBusy={settingsBusy} t={t} onUpdate={updateSettings} onToast={pushToast} />}

      <footer>
        <span>{t.localOnly}</span>
        <strong>127.0.0.1:9119</strong>
        <span>{t.lastChecked} {formatTime(status.checkedAt)}</span>
      </footer>

      <ToastStack toasts={toasts} onDismiss={dismissToast} t={t} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
