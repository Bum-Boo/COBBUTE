const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification, powerMonitor, powerSaveBlocker } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const power = require('./power.cjs');
const { createHermesAdapter } = require('./hermes-adapter.cjs');
const { createOpenClawAdapter } = require('./openclaw-adapter.cjs');
const { createModeManager } = require('./mode-manager.cjs');
const { createGatewayWatchdog } = require('./gateway-watchdog.cjs');
const { createLogStreamer } = require('./log-streamer.cjs');
const { makeMainStrings } = require('./i18n.cjs');

// Keep the persisted controller identity stable even though the visible product
// name changed from Hermes Lab Controller to AI Framework Controller. Electron's
// default userData path follows the package/app name; without this, the renamed
// app starts with an empty settings.json and reports Hermes/WSL as stopped even
// while the existing Hermes services are running.
app.setPath('userData', path.join(app.getPath('appData'), 'hermes-lab-controller'));
app.disableHardwareAcceleration();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showWindow();
    }
  });
}

const ROOT = path.resolve(__dirname, '..');
const HELPER_PS1 = path.join(__dirname, 'powercfg-helper.ps1');
const CONFIG = {
  distro: process.env.HERMES_WSL_DISTRO || 'Ubuntu',
  dashboardUrl: process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119',
  dashboardTaskName: process.env.HERMES_DASHBOARD_TASK_NAME || 'Hermes Dashboard 9119',
  labUnc: process.env.HERMES_LAB_UNC || '',
  labRoot: process.env.HERMES_LAB_ROOT || '',
  hermesHome: process.env.HERMES_HOME || '',
  pollMs: Number(process.env.HERMES_CONTROLLER_POLL_MS || 15000)
};

const SETTINGS_DEFAULTS = {
  language: 'ko',
  theme: 'system',
  // Power / server-mode settings
  autoServerEnabled: true,
  idleThresholdMinutes: 20,
  serverCpuMax: 70,
  turnOffDisplayOnServer: true,
  serverPlanGuid: '',
  // User-selected Hermes connection target. Keep path defaults empty so a
  // downloaded controller does not assume a particular user's WSL layout.
  wslDistro: process.env.HERMES_WSL_DISTRO || 'Ubuntu',
  dashboardUrl: process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119',
  dashboardTaskName: process.env.HERMES_DASHBOARD_TASK_NAME || 'Hermes Dashboard 9119',
  labUnc: process.env.HERMES_LAB_UNC || '',
  labRoot: process.env.HERMES_LAB_ROOT || '',
  hermesHome: process.env.HERMES_HOME || '',
  // Gateway watchdog
  autoRestartEnabled: false,
  autoRestartMax: 3
};
const SUPPORTED_LANGUAGES = new Set(['ko', 'zh', 'ja', 'en']);
const SUPPORTED_THEMES = new Set(['system', 'light', 'dark']);
const STARTUP_SHORTCUT_NAME = 'Hermes Lab Controller.lnk';
const RELEASE_REPO = process.env.HERMES_CONTROLLER_RELEASE_REPO || 'Bum-Boo/COBBUTE';
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;
const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
const OPENCLAW_DASHBOARD_URL = process.env.OPENCLAW_DASHBOARD_URL || 'http://127.0.0.1:18789/';

let mainWindow = null;
let tray = null;
let lastReady = null;
let pollTimer = null;
let modeManager = null;
let adapter = null;
let openclawAdapter = null;
let watchdog = null;
let watchdogRunning = false;
let logStreamer = null;
let currentStatus = null;
let currentMode = null;

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wslPath() {
  return path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
}

function run(file, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code !== 'undefined' ? error.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : ''
      });
    });
    child.on('error', (error) => {
      resolve({ ok: false, code: -1, stdout: '', stderr: '', error: error.message });
    });
  });
}

function runPowerShell(command, timeoutMs = 10000) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], timeoutMs);
}

function requestJson(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': `AI-Framework-Controller/${app.getVersion()}`
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
          return;
        }
        try {
          resolve({ ok: true, status: res.statusCode, data: JSON.parse(body) });
        } catch (error) {
          resolve({ ok: false, status: res.statusCode, error: error.message });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', (error) => resolve({ ok: false, status: 0, error: error.message }));
  });
}

function comparableVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(a, b) {
  const left = comparableVersion(a);
  const right = comparableVersion(b);
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getAppInfo() {
  return {
    version: app.getVersion(),
    releaseRepo: RELEASE_REPO,
    releasesUrl: RELEASES_URL,
    latestReleaseUrl: LATEST_RELEASE_URL
  };
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const apiUrl = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
  const result = await requestJson(apiUrl, 10000);
  if (!result.ok) {
    return {
      ok: false,
      currentVersion,
      releaseRepo: RELEASE_REPO,
      releasesUrl: RELEASES_URL,
      latestReleaseUrl: LATEST_RELEASE_URL,
      error: result.error || 'update check failed',
      status: result.status || 0
    };
  }

  const release = result.data || {};
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '') || currentVersion;
  return {
    ok: true,
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(currentVersion, latestVersion) < 0,
    releaseName: release.name || release.tag_name || latestVersion,
    releaseUrl: release.html_url || LATEST_RELEASE_URL,
    publishedAt: release.published_at || '',
    assetCount: Array.isArray(release.assets) ? release.assets.length : 0,
    releasesUrl: RELEASES_URL,
    latestReleaseUrl: LATEST_RELEASE_URL
  };
}

function runWsl(command, timeoutMs = 10000) {
  return run(wslPath(), ['-d', CONFIG.distro, '--', 'bash', '-lc', command], timeoutMs);
}

function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeSettings(raw) {
  const base = { ...SETTINGS_DEFAULTS, ...(raw || {}) };
  return {
    language: SUPPORTED_LANGUAGES.has(base.language) ? base.language : SETTINGS_DEFAULTS.language,
    theme: SUPPORTED_THEMES.has(base.theme) ? base.theme : SETTINGS_DEFAULTS.theme,
    autoServerEnabled: base.autoServerEnabled !== false,
    idleThresholdMinutes: clampInt(base.idleThresholdMinutes, 1, 240, SETTINGS_DEFAULTS.idleThresholdMinutes),
    serverCpuMax: clampInt(base.serverCpuMax, 20, 100, SETTINGS_DEFAULTS.serverCpuMax),
    turnOffDisplayOnServer: base.turnOffDisplayOnServer !== false,
    serverPlanGuid: typeof base.serverPlanGuid === 'string' ? base.serverPlanGuid : '',
    wslDistro: cleanString(base.wslDistro, SETTINGS_DEFAULTS.wslDistro),
    dashboardUrl: cleanString(base.dashboardUrl, SETTINGS_DEFAULTS.dashboardUrl),
    dashboardTaskName: cleanString(base.dashboardTaskName, SETTINGS_DEFAULTS.dashboardTaskName),
    labUnc: cleanString(base.labUnc),
    labRoot: cleanString(base.labRoot),
    hermesHome: cleanString(base.hermesHome),
    autoRestartEnabled: base.autoRestartEnabled === true,
    autoRestartMax: clampInt(base.autoRestartMax, 1, 10, SETTINGS_DEFAULTS.autoRestartMax)
  };
}

function applyConnectionSettings(settings) {
  const normalized = normalizeSettings(settings);
  CONFIG.distro = normalized.wslDistro;
  CONFIG.dashboardUrl = normalized.dashboardUrl;
  CONFIG.dashboardTaskName = normalized.dashboardTaskName;
  CONFIG.labUnc = normalized.labUnc;
  CONFIG.labRoot = normalized.labRoot;
  CONFIG.hermesHome = normalized.hermesHome;
  return CONFIG;
}

function isConnectionConfigured() {
  return Boolean(CONFIG.distro && CONFIG.labRoot && CONFIG.hermesHome);
}

function connectionSummary() {
  return {
    configured: isConnectionConfigured(),
    distro: CONFIG.distro,
    dashboardUrl: CONFIG.dashboardUrl,
    dashboardTaskName: CONFIG.dashboardTaskName,
    labUnc: CONFIG.labUnc,
    labRoot: CONFIG.labRoot,
    hermesHome: CONFIG.hermesHome
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}



function mainStrings() {
  return makeMainStrings(readSettings().language);
}

function writeSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2));
  return normalized;
}

// Profile labels: user-assigned display names + descriptions per profile.
// Stored in userData/profile-labels.json as { [technicalName]: { label, desc } }.
function profileLabelsPath() {
  return path.join(app.getPath('userData'), 'profile-labels.json');
}

function readProfileLabels() {
  try {
    const raw = JSON.parse(fs.readFileSync(profileLabelsPath(), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch { /* file missing or corrupt → return empty */ }
  return {};
}

function writeProfileLabel(name, label, desc) {
  const labels = readProfileLabels();
  const trimLabel = (label || '').trim();
  const trimDesc = (desc || '').trim();
  if (!trimLabel && !trimDesc) {
    delete labels[name];
  } else {
    labels[name] = { label: trimLabel, desc: trimDesc };
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(profileLabelsPath(), JSON.stringify(labels, null, 2));
  return labels;
}


function profileRuntimePath() {
  return path.join(app.getPath('userData'), 'profile-runtime-state.json');
}

function profileHistoryPath() {
  return path.join(app.getPath('userData'), 'profile-change-history.json');
}

function readJsonObject(file, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch { return fallback; }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readProfileRuntimeState() {
  return readJsonObject(profileRuntimePath(), {});
}

function writeProfileRuntimeState(state) {
  writeJsonFile(profileRuntimePath(), state || {});
  return state || {};
}

function markProfileRestartNeeded(name, reason, fields = []) {
  const state = readProfileRuntimeState();
  state[name] = {
    ...(state[name] || {}),
    restartNeeded: true,
    reason,
    fields,
    changedAt: new Date().toISOString()
  };
  return writeProfileRuntimeState(state);
}

function clearProfileRestartNeeded(name) {
  const state = readProfileRuntimeState();
  if (state[name]) {
    state[name] = { ...state[name], restartNeeded: false, clearedAt: new Date().toISOString() };
  }
  return writeProfileRuntimeState(state);
}

function readProfileChangeHistory() {
  const raw = readJsonObject(profileHistoryPath(), []);
  return Array.isArray(raw) ? raw : [];
}

function appendProfileChangeHistory(entry) {
  const history = readProfileChangeHistory();
  history.unshift({ at: new Date().toISOString(), ...entry });
  const trimmed = history.slice(0, 200);
  writeJsonFile(profileHistoryPath(), trimmed);
  return trimmed;
}

function getProfileOpsState() {
  return {
    runtime: readProfileRuntimeState(),
    history: readProfileChangeHistory().slice(0, 60),
    watchdog: {
      config: readSettings(),
      state: watchdog && typeof watchdog.getState === 'function' ? watchdog.getState() : null
    }
  };
}

async function setProfileModelSettings(name, patch) {
  if (!adapter) return { ok: false, error: 'adapter not ready' };
  const beforeList = await adapter.listProfiles();
  const before = beforeList && Array.isArray(beforeList.profiles)
    ? beforeList.profiles.find((p) => p.name === name)
    : null;
  const result = await adapter.setProfileModelSettings(name, patch || {});
  if (result && result.ok) {
    const fields = [];
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'model')) fields.push('model');
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'reasoning')) fields.push('reasoning');
    appendProfileChangeHistory({
      profile: name,
      action: 'settings.update',
      fields,
      patch,
      backup: result.output || '',
      requiresRestart: Boolean(before && before.running)
    });
    if (before && before.running && fields.length) {
      markProfileRestartNeeded(name, mainStrings().restartReasonSettings, fields);
    }
  }
  return result;
}

async function restoreProfileBackup(name, backupId) {
  if (!adapter) return { ok: false, error: 'adapter not ready' };
  const beforeList = await adapter.listProfiles();
  const before = beforeList && Array.isArray(beforeList.profiles)
    ? beforeList.profiles.find((p) => p.name === name)
    : null;
  const result = await adapter.restoreProfileBackup(name, backupId);
  if (result && result.ok) {
    appendProfileChangeHistory({
      profile: name,
      action: 'backup.restore',
      backupId,
      rollback: result.output || '',
      requiresRestart: Boolean(before && before.running)
    });
    if (before && before.running) {
      markProfileRestartNeeded(name, mainStrings().restartReasonBackup, ['restore']);
    }
  }
  return result;
}

function startupFolderPath() {
  const appData = process.env.APPDATA || app.getPath('appData');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function startupShortcutPath() {
  return path.join(startupFolderPath(), STARTUP_SHORTCUT_NAME);
}

function startupTargetPath() {
  return path.join(ROOT, 'Start-HermesControl-Minimized.cmd');
}

async function readShortcutTarget(shortcutPath) {
  if (!fs.existsSync(shortcutPath)) return '';
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut('${psSingleQuote(shortcutPath)}')`,
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Write-Output $shortcut.TargetPath'
  ].join('; ');
  const result = await runPowerShell(command, 5000);
  return result.stdout.trim();
}

async function getStartupState() {
  const shortcutPath = startupShortcutPath();
  const targetPath = await readShortcutTarget(shortcutPath);
  const normalizedTarget = targetPath.toLowerCase();
  const expectedTarget = startupTargetPath().toLowerCase();
  return {
    enabled: Boolean(targetPath && normalizedTarget === expectedTarget),
    managed: Boolean(targetPath && normalizedTarget.includes('\\hermescontrol')),
    shortcutPath,
    targetPath
  };
}

async function setStartupEnabled(enabled) {
  const shortcutPath = startupShortcutPath();
  if (enabled) {
    fs.mkdirSync(startupFolderPath(), { recursive: true });
    const iconPath = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$shell = New-Object -ComObject WScript.Shell',
      `$shortcut = $shell.CreateShortcut('${psSingleQuote(shortcutPath)}')`,
      `$shortcut.TargetPath = '${psSingleQuote(startupTargetPath())}'`,
      `$shortcut.WorkingDirectory = '${psSingleQuote(ROOT)}'`,
      `$shortcut.IconLocation = '${psSingleQuote(`${iconPath},0`)}'`,
      "$shortcut.Description = 'Start Hermes Lab controller minimized'",
      '$shortcut.Save()'
    ].join('; ');
    await runPowerShell(command, 8000);
    return getStartupState();
  }

  const state = await getStartupState();
  if (fs.existsSync(shortcutPath) && (!state.targetPath || state.managed)) {
    fs.unlinkSync(shortcutPath);
  }
  return getStartupState();
}

async function getAppSettings() {
  const [settings, startup] = await Promise.all([readSettings(), getStartupState()]);
  return {
    ...settings,
    connection: connectionSummary(),
    startupEnabled: startup.enabled,
    startupShortcutPath: startup.shortcutPath
  };
}

function recreateHermesClients() {
  adapter = createHermesAdapter(runWsl, CONFIG);
  openclawAdapter = createOpenClawAdapter(runWsl);
  if (logStreamer) {
    logStreamer.stop();
    logStreamer = createLogStreamer({
      wslPath: wslPath(),
      distro: CONFIG.distro,
      hermesHome: CONFIG.hermesHome,
      onLine: (name, line) => sendToWindow('hermes:logLine', { name, line }),
      onEnd: (name) => sendToWindow('hermes:logEnd', { name })
    });
  }
}

async function updateAppSettings(patch = {}) {
  const before = readSettings();
  const next = { ...before };
  if (typeof patch.language === 'string') next.language = patch.language;
  if (typeof patch.autoServerEnabled === 'boolean') next.autoServerEnabled = patch.autoServerEnabled;
  if (typeof patch.turnOffDisplayOnServer === 'boolean') next.turnOffDisplayOnServer = patch.turnOffDisplayOnServer;
  if (typeof patch.autoRestartEnabled === 'boolean') next.autoRestartEnabled = patch.autoRestartEnabled;
  if (patch.autoRestartMax !== undefined) next.autoRestartMax = patch.autoRestartMax;
  if (patch.idleThresholdMinutes !== undefined) next.idleThresholdMinutes = patch.idleThresholdMinutes;
  if (patch.serverCpuMax !== undefined) next.serverCpuMax = patch.serverCpuMax;
  for (const key of ['wslDistro', 'dashboardUrl', 'dashboardTaskName', 'labUnc', 'labRoot', 'hermesHome']) {
    if (typeof patch[key] === 'string') next[key] = patch[key];
  }
  writeSettings(next);

  if (typeof patch.startupEnabled === 'boolean') {
    await setStartupEnabled(patch.startupEnabled);
  }

  const after = readSettings();
  const connectionChanged = ['wslDistro', 'dashboardUrl', 'dashboardTaskName', 'labUnc', 'labRoot', 'hermesHome']
    .some((key) => after[key] !== before[key]);
  if (connectionChanged) {
    applyConnectionSettings(after);
    recreateHermesClients();
    await publishStatus({ notify: false });
  }

  // Re-apply CPU cap / threshold to a live server plan if those changed.
  if (modeManager && (after.serverCpuMax !== before.serverCpuMax || after.idleThresholdMinutes !== before.idleThresholdMinutes)) {
    await modeManager.refreshConfig();
  }

  const settings = await getAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:settingsChanged', settings);
  }
  return settings;
}

function checkHttp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function isWslRunning() {
  const result = await run(wslPath(), ['-l', '-v'], 6000);
  const text = `${result.stdout}\n${result.stderr}`.replace(/\0/g, '');
  return new RegExp(`^\\s*\\*?\\s*${CONFIG.distro}\\s+Running\\s+2\\s*$`, 'm').test(text);
}

async function getGatewayStatus(wslRunning) {
  if (!wslRunning) return 'WSL off';
  const cmd = [
    'if systemctl --user is-active --quiet hermes-gateway.service 2>/dev/null; then',
    '  echo active;',
    "elif systemctl --user list-units 'hermes-gateway*.service' --state=running --no-legend --no-pager 2>/dev/null | grep -q .; then",
    '  echo active;',
    'else',
    "  systemctl --user is-active hermes-gateway.service 2>/dev/null || echo inactive;",
    'fi'
  ].join(' ');
  const result = await runWsl(cmd, 8000);
  const value = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  return value || 'unknown';
}

async function getAuthStatus(wslRunning) {
  if (!isConnectionConfigured()) return 'not configured';
  if (!wslRunning) return 'WSL off';
  const cmd = `cd ${shQuote(CONFIG.labRoot)} && HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes auth status openai-codex 2>&1 | head -n 1`;
  const result = await runWsl(cmd, 12000);
  const value = result.stdout.trim();
  if (/logged in/i.test(value)) return 'logged in';
  return value || 'unknown';
}

async function getStatus() {
  if (!isConnectionConfigured()) {
    return {
      wslRunning: false,
      dashboardOnline: false,
      gateway: 'not configured',
      codexAuth: 'not configured',
      ready: false,
      connection: connectionSummary(),
      checkedAt: new Date().toISOString()
    };
  }
  const [wslRunning, dashboardOnline] = await Promise.all([
    isWslRunning(),
    checkHttp(CONFIG.dashboardUrl)
  ]);
  const [gateway, codexAuth] = await Promise.all([
    getGatewayStatus(wslRunning),
    getAuthStatus(wslRunning)
  ]);
  const ready = Boolean(wslRunning && dashboardOnline && codexAuth === 'logged in');
  return {
    wslRunning,
    dashboardOnline,
    gateway,
    codexAuth,
    ready,
    connection: connectionSummary(),
    checkedAt: new Date().toISOString()
  };
}

async function publishStatus({ notify = false } = {}) {
  const status = await getStatus();
  currentStatus = status;
  reconcileWatchdogWithStatus(status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:statusChanged', status);
  }
  if (notify && lastReady !== null && lastReady !== status.ready) {
    new Notification({
      title: status.ready ? 'AI Framework Controller connected' : 'AI Framework Controller disconnected',
      body: status.ready ? 'Dashboard and Codex OAuth are online.' : 'Hermes is stopped or partially disconnected.'
    }).show();
  }
  lastReady = status.ready;
  applyTray();
  return status;
}

function reconcileWatchdogWithStatus(status) {
  if (!watchdog) return;
  if (status && status.wslRunning) {
    startWatchdogIfNeeded();
    return;
  }
  stopWatchdogIfRunning();
}

function startWatchdogIfNeeded() {
  if (!watchdog || watchdogRunning) return;
  watchdog.start();
  watchdogRunning = true;
}

function stopWatchdogIfRunning() {
  if (!watchdog || !watchdogRunning) return;
  watchdog.stop();
  watchdogRunning = false;
}

async function refreshProfilesIfWslRunning() {
  if (!watchdog) return { ok: false, skipped: 'watchdog-not-ready' };
  const wslRunning = currentStatus ? currentStatus.wslRunning : await isWslRunning();
  if (!wslRunning) {
    stopWatchdogIfRunning();
    sendToWindow('hermes:profilesUpdated', { profiles: [], at: Date.now(), skipped: 'wsl-off' });
    return { ok: true, skipped: 'wsl-off', profiles: [] };
  }
  startWatchdogIfNeeded();
  return watchdog.refreshNow();
}

async function listProfilesIfWslRunning() {
  if (!adapter) return { ok: false, error: 'adapter not ready', profiles: [] };
  const wslRunning = currentStatus ? currentStatus.wslRunning : await isWslRunning();
  if (!wslRunning) {
    return { ok: true, skipped: 'wsl-off', profiles: [] };
  }
  return adapter.listProfiles();
}

function openClawFrameworkWhenWslOff() {
  return {
    id: 'openclaw',
    name: 'OpenClaw',
    kind: 'framework',
    installed: Boolean(openclawAdapter),
    gateway: { service: 'openclaw-gateway.service', state: 'WSL off', running: false, port: 18789 },
    dashboardUrl: OPENCLAW_DASHBOARD_URL,
    agents: [],
    warnings: ['wsl-off']
  };
}

async function listFrameworksIfWslRunning() {
  const wslRunning = currentStatus ? currentStatus.wslRunning : await isWslRunning();
  const hermesFramework = {
    id: 'hermes',
    name: 'Hermes',
    kind: 'framework',
    installed: isConnectionConfigured(),
    gateway: { state: wslRunning ? (currentStatus ? currentStatus.gateway : 'unknown') : 'WSL off', running: Boolean(wslRunning && currentStatus && currentStatus.gateway === 'active') },
    dashboardUrl: CONFIG.dashboardUrl,
    warnings: isConnectionConfigured() ? [] : ['not-configured']
  };
  if (!wslRunning) {
    return { ok: true, skipped: 'wsl-off', frameworks: [hermesFramework, openClawFrameworkWhenWslOff()] };
  }
  const openclaw = openclawAdapter ? await openclawAdapter.getStatus() : { ok: false, framework: { id: 'openclaw', name: 'OpenClaw', installed: false, gateway: { state: 'unknown', running: false }, agents: [], warnings: ['adapter-not-ready'] } };
  return { ok: true, frameworks: [hermesFramework, openclaw.framework] };
}

async function startHermes() {
  if (!isConnectionConfigured()) return publishStatus({ notify: false });
  await runPowerShell(`Start-ScheduledTask -TaskName "${CONFIG.dashboardTaskName}"`, 10000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await runWsl(`cd ${shQuote(CONFIG.labRoot)} && HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway status >/dev/null 2>&1 || true`, 12000);
  const status = await publishStatus({ notify: true });
  new Notification({ title: 'AI Framework Controller', body: 'Start command sent.' }).show();
  return status;
}

async function stopHermes() {
  if (!isConnectionConfigured()) return publishStatus({ notify: false });
  await runPowerShell(`Stop-ScheduledTask -TaskName "${CONFIG.dashboardTaskName}"`, 10000).catch(() => {});
  await runWsl(`systemctl --user stop hermes-dashboard.service >/dev/null 2>&1 || true; HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway stop >/dev/null 2>&1 || systemctl --user stop hermes-gateway.service >/dev/null 2>&1 || true`, 15000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const status = await publishStatus({ notify: true });
  new Notification({ title: 'AI Framework Controller', body: 'Hermes services were stopped.' }).show();
  return status;
}

async function startOpenClaw() {
  const result = await runWsl('systemctl --user start openclaw-gateway.service', 18000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const status = await publishStatus({ notify: true });
  if (!result.ok) return { ok: false, status, error: result.stderr || result.error || 'OpenClaw start failed' };
  return { ok: true, status };
}

async function stopOpenClaw() {
  const result = await runWsl('systemctl --user stop openclaw-gateway.service', 15000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const status = await publishStatus({ notify: true });
  if (!result.ok) return { ok: false, status, error: result.stderr || result.error || 'OpenClaw stop failed' };
  return { ok: true, status };
}

async function startFramework(id) {
  if (id === 'hermes') return { ok: true, status: await startHermes() };
  if (id === 'openclaw') return startOpenClaw();
  return { ok: false, error: 'unknown framework' };
}

async function stopFramework(id) {
  if (id === 'hermes') return { ok: true, status: await stopHermes() };
  if (id === 'openclaw') return stopOpenClaw();
  return { ok: false, error: 'unknown framework' };
}

// Full WSL shutdown: `wsl --shutdown` stops the entire WSL2 backend VM (every
// distro + the utility VM), releasing all of its RAM — heavier than stopHermes,
// which only terminates the Ubuntu distro. Stops the gateways first so they get
// a chance to finalize sessions instead of being hard-killed mid-write.
async function shutdownWsl() {
  if (!isConnectionConfigured()) return publishStatus({ notify: false });
  await runPowerShell(`Stop-ScheduledTask -TaskName "${CONFIG.dashboardTaskName}"`, 10000).catch(() => {});
  // Best-effort graceful gateway stop before pulling the VM out from under them.
  await runWsl(`HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway stop >/dev/null 2>&1 || true`, 12000).catch(() => {});
  await run(wslPath(), ['--shutdown'], 25000);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const status = await publishStatus({ notify: true });
  new Notification({ title: 'WSL', body: mainStrings().wslShutdownNotice }).show();
  return status;
}

function makeTrayImage(color = '#6b7280') {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#111827"/>
      <circle cx="16" cy="16" r="8" fill="${color}"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

// Tray reflects BOTH power mode and Hermes status. Mode takes visual priority
// while in/transitioning to server mode.
function applyTray() {
  if (!tray) return;
  const status = currentStatus;
  const mode = currentMode;

  let color = '#6b7280';
  let tip = 'AI Framework Controller';

  if (mode && mode.transitioning) {
    color = '#eab308';
    tip = 'AI Framework Controller: switching mode…';
  } else if (mode && mode.mode === 'server') {
    color = mode.trigger === 'manual' ? '#3b82f6' : '#38bdf8';
    tip = mode.trigger === 'manual' ? 'AI Framework Controller: server mode (manual)' : 'AI Framework Controller: server mode (auto)';
  } else if (status) {
    color = status.ready ? '#22c55e' : status.wslRunning ? '#f59e0b' : '#ef4444';
    tip = status.ready ? 'AI Framework Controller: connected' : status.wslRunning ? 'AI Framework Controller: partial' : 'AI Framework Controller: stopped';
  }

  tray.setImage(makeTrayImage(color));
  tray.setToolTip(tip);
  refreshTrayMenu();
}

function onModeChanged(state) {
  currentMode = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hermes:modeChanged', state);
  }
  applyTray();
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function buildTrayMenu() {
  const inServer = currentMode && currentMode.mode === 'server';
  return Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    { type: 'separator' },
    { label: 'Start Hermes', click: () => startHermes() },
    { label: 'Stop Hermes', click: () => stopHermes() },
    { type: 'separator' },
    inServer
      ? { label: 'Return to user mode', click: () => modeManager && modeManager.exitServerMode() }
      : { label: 'Enter server mode', click: () => modeManager && modeManager.enterServerMode() },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => shell.openExternal(CONFIG.dashboardUrl) },
    { label: 'Open Lab Folder', click: () => shell.openPath(CONFIG.labUnc) },
    { type: 'separator' },
    { label: 'Quit Controller', click: () => app.quit() }
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(makeTrayImage());
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', showWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 820,
    minWidth: 860,
    minHeight: 720,
    title: 'AI Framework Controller',
    backgroundColor: '#111317',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--minimized')) {
      mainWindow.show();
    }
    publishStatus()
      .then(() => refreshProfilesIfWslRunning())
      .catch(() => {});
    if (process.argv.includes('--capture')) {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(ROOT, 'preview.png'), image.toPNG());
        app.exit(0);
      }, 1600);
    }
  });
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// --- diagnostics aggregation -------------------------------------------------

async function getDiagnostics() {
  const [activePlan, plans, requests] = await Promise.all([
    power.getActivePlan(),
    power.listPlans(),
    power.getPowerRequests()
  ]);
  return {
    wslConfig: power.readWslConfig(),
    activePlan,
    plans,
    requests
  };
}

// --- IPC ---------------------------------------------------------------------

function isValidProfileName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name);
}

function invalidProfileResult(extra = {}) {
  return { ok: false, error: 'invalid profile name', ...extra };
}

function dashboardUrlForFramework(id) {
  if (id === 'hermes') return CONFIG.dashboardUrl;
  if (id === 'openclaw') return OPENCLAW_DASHBOARD_URL;
  return '';
}

function openFrameworkDashboard(id) {
  const url = dashboardUrlForFramework(id);
  if (!url) return { ok: false, error: 'unknown framework dashboard' };
  shell.openExternal(url);
  return { ok: true, url };
}

ipcMain.handle('hermes:getStatus', () => publishStatus());
ipcMain.handle('hermes:start', () => startHermes());
ipcMain.handle('hermes:stop', () => stopHermes());
ipcMain.handle('hermes:shutdownWsl', async () => {
  const opts = {
    type: 'warning',
    buttons: [mainStrings().wslShutdownButton, mainStrings().cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: mainStrings().wslShutdownTitle,
    message: mainStrings().wslShutdownMessage,
    detail: mainStrings().wslShutdownDetail
  };
  const { response } = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, opts)
    : await dialog.showMessageBox(opts);
  if (response !== 0) return { cancelled: true, status: currentStatus };
  const status = await shutdownWsl();
  return { cancelled: false, status };
});
ipcMain.handle('hermes:openDashboard', () => openFrameworkDashboard('hermes'));
ipcMain.handle('hermes:openFrameworkDashboard', (_event, id) => openFrameworkDashboard(id));
ipcMain.handle('hermes:openLabFolder', () => {
  if (!CONFIG.labUnc) return { ok: false, error: 'Lab folder path is not configured.' };
  return shell.openPath(CONFIG.labUnc);
});
ipcMain.handle('hermes:getAppInfo', () => getAppInfo());
ipcMain.handle('hermes:checkForUpdates', () => checkForUpdates());
ipcMain.handle('hermes:openReleasePage', () => shell.openExternal(LATEST_RELEASE_URL));
ipcMain.handle('hermes:getSettings', () => getAppSettings());
ipcMain.handle('hermes:updateSettings', (_event, patch) => updateAppSettings(patch));

ipcMain.handle('hermes:getMode', () => (modeManager ? modeManager.getState() : null));
ipcMain.handle('hermes:enterServerMode', () => (modeManager ? modeManager.enterServerMode() : null));
ipcMain.handle('hermes:exitServerMode', () => (modeManager ? modeManager.exitServerMode() : null));
ipcMain.handle('hermes:getModeHistory', () => (modeManager ? modeManager.getHistory() : []));

ipcMain.handle('hermes:getProfiles', () => listProfilesIfWslRunning());
ipcMain.handle('hermes:getFrameworks', () => listFrameworksIfWslRunning());
ipcMain.handle('hermes:frameworkStart', (_event, id) => startFramework(id));
ipcMain.handle('hermes:frameworkStop', (_event, id) => stopFramework(id));
ipcMain.handle('hermes:getModelOptions', () => (adapter ? adapter.modelOptions() : { ok: false, models: [], reasoning: [] }));
ipcMain.handle('hermes:setProfileModelSettings', (_event, name, patch) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  return setProfileModelSettings(name, patch);
});
ipcMain.handle('hermes:getProfileOpsState', () => getProfileOpsState());
ipcMain.handle('hermes:getProfileBackups', (_event, name) => {
  if (!isValidProfileName(name)) return invalidProfileResult({ backups: [] });
  return adapter ? adapter.listProfileBackups(name) : { ok: false, backups: [] };
});
ipcMain.handle('hermes:restoreProfileBackup', (_event, name, backupId) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  return restoreProfileBackup(name, backupId);
});
ipcMain.handle('hermes:getProfileLogSummary', (_event, name) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  return adapter ? adapter.profileLogSummary(name) : { ok: false };
});
ipcMain.handle('hermes:useProfile', (_event, name) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  return adapter ? adapter.useProfile(name) : { ok: false };
});

ipcMain.handle('hermes:gatewayStart', async (_event, name) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  if (!adapter) return { ok: false };
  if (watchdog) watchdog.setDesired(name, true); // mark intent before acting
  const result = await adapter.gatewayStartProfile(name);
  if (result && result.ok !== false) {
    clearProfileRestartNeeded(name);
    appendProfileChangeHistory({ profile: name, action: 'gateway.start' });
  }
  if (watchdog) setTimeout(() => watchdog.refreshNow(), 2500); // let it settle, then re-poll
  return result;
});

ipcMain.handle('hermes:gatewayStop', async (_event, name) => {
  if (!isValidProfileName(name)) return invalidProfileResult();
  if (!adapter) return { ok: false };
  if (watchdog) watchdog.setDesired(name, false); // suppress crash detection for this stop
  const result = await adapter.gatewayStopProfile(name);
  if (result && result.ok !== false) appendProfileChangeHistory({ profile: name, action: 'gateway.stop' });
  if (watchdog) watchdog.refreshNow();
  return result;
});

ipcMain.handle('hermes:getDiagnostics', () => getDiagnostics());
ipcMain.handle('hermes:getRequestsElevated', () => power.getPowerRequestsElevated(HELPER_PS1));

ipcMain.handle('hermes:getProfileLabels', () => readProfileLabels());
ipcMain.handle('hermes:setProfileLabel', (_event, name, label, desc) => {
  if (!isValidProfileName(name)) return readProfileLabels();
  return writeProfileLabel(name, label, desc);
});

ipcMain.handle('hermes:logStart', (_event, name) => (logStreamer ? logStreamer.start(name) : { ok: false }));
ipcMain.handle('hermes:logStop', () => { if (logStreamer) logStreamer.stop(); return { ok: true }; });

// WSL memory allocation lives in %USERPROFILE%\.wslconfig ([wsl2] memory=NGB).
ipcMain.handle('hermes:getWslMemory', () => {
  const cfg = power.readWslConfig();
  const totalGb = Math.round(os.totalmem() / (1024 ** 3));
  // Parse the current "NGB"/"NMB" value into integer GB, if present.
  let currentGb = null;
  if (cfg.memory) {
    const m = String(cfg.memory).match(/^(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?/i);
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] || 'gb').toLowerCase();
      currentGb = unit.startsWith('m') ? Math.round(n / 1024) : Math.round(n);
    }
  }
  return { exists: cfg.exists, raw: cfg.memory, currentGb, totalGb, path: cfg.path };
});

ipcMain.handle('hermes:setWslMemory', async (_event, gb, applyNow) => {
  const n = Number(gb);
  const value = Number.isFinite(n) && n > 0 ? `${n}GB` : null; // null => clear (WSL auto-default)
  const res = power.setWslConfigValue('memory', value);
  let restarted = false;
  if (applyNow) {
    await runPowerShell(`Stop-ScheduledTask -TaskName "${CONFIG.dashboardTaskName}"`, 10000).catch(() => {});
    await runWsl(`HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway stop >/dev/null 2>&1 || true`, 12000).catch(() => {});
    await run(wslPath(), ['--shutdown'], 25000);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await publishStatus({ notify: false });
    restarted = true;
    new Notification({ title: mainStrings().wslMemoryTitle, body: mainStrings().wslMemoryApplied(value) }).show();
  }
  return { ...res, restarted };
});

app.whenReady().then(() => {
  applyConnectionSettings(readSettings());
  adapter = createHermesAdapter(runWsl, CONFIG);
  openclawAdapter = createOpenClawAdapter(runWsl);

  modeManager = createModeManager({
    powerMonitor,
    powerSaveBlocker,
    power,
    getConfig: () => readSettings(),
    persistServerPlanGuid: (guid) => writeSettings({ ...readSettings(), serverPlanGuid: guid }),
    onChange: onModeChanged,
    notify: ({ title, body }) => new Notification({ title, body }).show(),
    historyFile: path.join(app.getPath('userData'), 'mode-history.json')
  });

  watchdog = createGatewayWatchdog({
    listProfiles: () => adapter.listProfiles(),
    startProfile: (name) => adapter.gatewayStartProfile(name),
    getConfig: () => readSettings(),
    onEvent: (event) => sendToWindow('hermes:gatewayEvent', event),
    onProfiles: (payload) => sendToWindow('hermes:profilesUpdated', payload),
    notify: ({ title, body }) => new Notification({ title, body }).show(),
    getText: () => mainStrings()
  });

  logStreamer = createLogStreamer({
    wslPath: wslPath(),
    distro: CONFIG.distro,
    hermesHome: CONFIG.hermesHome,
    onLine: (name, line) => sendToWindow('hermes:logLine', { name, line }),
    onEnd: (name) => sendToWindow('hermes:logEnd', { name })
  });

  createTray();
  createWindow();
  modeManager.start();

  pollTimer = setInterval(() => publishStatus({ notify: true }), CONFIG.pollMs);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (modeManager) modeManager.stop();
  if (watchdog) watchdog.stop();
  if (logStreamer) logStreamer.stop();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
