import React, { useEffect, useRef, useState } from 'react';
import { Gauge, Languages, LifeBuoy, MemoryStick, MonitorOff, Moon, Power, RotateCcw, Save, Settings, Timer, Zap } from 'lucide-react';
import { Panel, SettingRow, ToggleSwitch } from '../components.jsx';
import { languageOptions } from '../i18n.js';
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
// "지금 적용" button so saving and restarting are distinct choices.
function WslMemoryPanel({ onToast }) {
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
    if (applyNow && !window.confirm('WSL을 지금 재시작해서 새 메모리 설정을 적용할까요?\n실행 중인 게이트웨이가 잠시 중지됩니다.')) return;
    setBusy(true);
    try {
      const value = limit ? gb : 0; // 0 => clear the limit (WSL auto-default)
      const res = await window.hermes.setWslMemory(value, applyNow);
      if (onToast) {
        if (res && res.restarted) onToast(limit ? `WSL 메모리 ${gb}GB 적용 완료` : 'WSL 메모리 제한 해제 (적용됨)', 'ok');
        else onToast(limit ? `WSL 메모리 ${gb}GB 저장됨 · WSL 재시작 후 적용` : 'WSL 메모리 제한 해제 저장됨', 'info', 6000);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      icon={MemoryStick}
      title="WSL 메모리 할당"
      subtitle={info ? `이 PC 총 RAM ${info.totalGb}GB · 현재 설정 ${info.raw || '자동(기본 50%)'}` : 'WSL에 할당할 최대 메모리'}
    >
      <div className="settings-grid">
        <SettingRow title="메모리 직접 제한" hint="끄면 WSL이 자동으로 관리합니다(기본: 전체 RAM의 50%).">
          <ToggleSwitch checked={limit} disabled={busy} label="메모리 직접 제한" onChange={setLimit} />
        </SettingRow>

        <SettingRow title="할당할 최대 메모리" hint={`2GB ~ ${maxGb}GB (Windows용 여유를 남깁니다).`}>
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
          변경 사항은 <strong>WSL 재시작</strong> 후에 적용됩니다.
        </div>
        <button className="ghost small" disabled={busy} onClick={() => save(false)}>
          <Save size={15} /> 저장
        </button>
        <button className="gw-toggle start" disabled={busy} onClick={() => save(true)}>
          <Zap size={15} /> 저장하고 지금 적용
        </button>
      </div>
    </Panel>
  );
}

function ConnectionPanel({ settings, settingsBusy, onUpdate, onToast }) {
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
      onToast(ok ? 'Hermes 연결 경로를 저장했습니다' : '연결 경로가 비어 있어 미설정 상태로 저장했습니다', ok ? 'ok' : 'warn', 6500);
    }
  };

  return (
    <Panel
      icon={Settings}
      title="Hermes 연결 경로"
      subtitle={configured ? `현재 ${settings.wslDistro || 'Ubuntu'} · ${settings.labRoot}` : '처음 설치한 컴퓨터에서 본인의 WSL Hermes 경로를 지정합니다.'}
    >
      <div className="connection-notice">
        기본값으로 특정 사용자 폴더를 가정하지 않습니다. 새 PC에서는 이 값을 저장한 뒤 상태 확인과 프로필 제어가 동작합니다.
      </div>
      <div className="settings-grid connection-grid">
        <SettingRow title="WSL 배포판" hint="예: Ubuntu, Debian. Windows의 `wsl -l -v` 이름과 같아야 합니다.">
          <input className="path-input" value={draft.wslDistro} disabled={settingsBusy} onChange={(e) => setField('wslDistro', e.target.value)} placeholder="Ubuntu" />
        </SettingRow>

        <SettingRow title="Hermes Lab Root" hint="WSL 내부 Hermes 작업 폴더. 예: /home/me/hermes-lab">
          <input className="path-input" value={draft.labRoot} disabled={settingsBusy} onChange={(e) => setField('labRoot', e.target.value)} placeholder="/home/<user>/hermes-lab" />
        </SettingRow>

        <SettingRow title="Hermes Home" hint="프로필과 설정이 있는 Hermes home. 예: /home/me/hermes-lab/.hermes 또는 /home/me/.hermes">
          <input className="path-input" value={draft.hermesHome} disabled={settingsBusy} onChange={(e) => setField('hermesHome', e.target.value)} placeholder="/home/<user>/.hermes" />
        </SettingRow>

        <SettingRow title="Windows에서 열 Lab 폴더" hint="선택값. 비워두면 폴더 열기 버튼만 비활성처럼 동작합니다.">
          <input className="path-input" value={draft.labUnc} disabled={settingsBusy} onChange={(e) => setField('labUnc', e.target.value)} placeholder="\\\\wsl.localhost\\Ubuntu\\home\\<user>\\hermes-lab" />
        </SettingRow>

        <SettingRow title="Dashboard URL" hint="대부분 http://127.0.0.1:9119 입니다.">
          <input className="path-input" value={draft.dashboardUrl} disabled={settingsBusy} onChange={(e) => setField('dashboardUrl', e.target.value)} placeholder="http://127.0.0.1:9119" />
        </SettingRow>

        <SettingRow title="Windows Scheduled Task" hint="Start 버튼이 실행할 작업 이름. 없으면 Dashboard 자동 시작만 실패할 수 있습니다.">
          <input className="path-input" value={draft.dashboardTaskName} disabled={settingsBusy} onChange={(e) => setField('dashboardTaskName', e.target.value)} placeholder="Hermes Dashboard 9119" />
        </SettingRow>
      </div>

      <div className="connection-actions">
        <div className={`connection-state ${configured ? 'ok' : 'warn'}`}>
          {configured ? '연결 경로 저장됨' : '연결 경로 미설정'}
        </div>
        <button className="gw-toggle start" disabled={settingsBusy} onClick={save}>
          <Save size={15} /> 연결 경로 저장
        </button>
      </div>
    </Panel>
  );
}

export default function SettingsTab({ settings, settingsBusy, t, onUpdate, onToast }) {
  return (
    <div className="settings-stack">
      <ConnectionPanel settings={settings} settingsBusy={settingsBusy} onUpdate={onUpdate} onToast={onToast} />

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

      <Panel icon={LifeBuoy} title="게이트웨이 자동 복구" subtitle="크래시 감지는 항상 켜져 있고, 자동 재시작만 선택입니다.">
        <div className="settings-grid">
          <SettingRow title="크래시 시 자동 재시작" hint="실행 중이던 게이트웨이가 멈추면 자동으로 다시 시작합니다. (Hermes 자체 복구와 겹칠 수 있어 기본 꺼짐)">
            <ToggleSwitch
              checked={settings.autoRestartEnabled}
              disabled={settingsBusy}
              label="자동 재시작"
              onChange={(v) => onUpdate({ autoRestartEnabled: v })}
            />
          </SettingRow>

          <SettingRow title="최대 재시도 횟수" hint="10분 안에 이 횟수만큼 재시도한 뒤 멈춥니다. 무한 루프 방지.">
            <DebouncedSlider
              icon={RotateCcw}
              min={1}
              max={10}
              step={1}
              value={settings.autoRestartMax}
              disabled={!settings.autoRestartEnabled}
              unit="회"
              onCommit={(v) => onUpdate({ autoRestartMax: v })}
            />
          </SettingRow>
        </div>
      </Panel>

      <WslMemoryPanel onToast={onToast} />

      <LogTab t={t} />

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
    </div>
  );
}
