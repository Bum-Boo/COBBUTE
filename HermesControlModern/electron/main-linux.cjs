const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { createHermesAdapter } = require('./hermes-adapter.cjs');
const { createOpenClawAdapter } = require('./openclaw-adapter.cjs');
const { createGatewayWatchdog } = require('./gateway-watchdog.cjs');
const { createLinuxLogStreamer } = require('./log-streamer-linux.cjs');
const { compareVersions } = require('./version.cjs');

const ROOT = path.join(__dirname, '..');
const RELEASE_REPO = process.env.HERMES_CONTROLLER_RELEASE_REPO || 'Bum-Boo/COBBUTE';
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;
const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
const OPENCLAW_DASHBOARD_URL = 'http://127.0.0.1:18789/';
const SUPPORTED_LANGUAGES = new Set(['en', 'ko', 'zh', 'ja']);
const SUPPORTED_THEMES = new Set(['system', 'light', 'dark']);
const home = os.homedir();
const detectedLabRoot = fs.existsSync(path.join(home, 'hermes-lab')) ? path.join(home, 'hermes-lab') : '';
const detectedHermesHome = fs.existsSync(path.join(home, '.hermes')) ? path.join(home, '.hermes') : '';

const SETTINGS_DEFAULTS = {
  language: 'ko',
  theme: 'system',
  autoServerEnabled: false,
  idleThresholdMinutes: 20,
  serverCpuMax: 70,
  turnOffDisplayOnServer: false,
  wslDistro: 'Linux',
  dashboardUrl: process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119',
  dashboardTaskName: '',
  labUnc: '',
  labRoot: process.env.HERMES_LAB_ROOT || detectedLabRoot,
  hermesHome: process.env.HERMES_HOME || detectedHermesHome,
  autoRestartEnabled: false,
  autoRestartMax: 3
};

let CONFIG = { ...SETTINGS_DEFAULTS };
let mainWindow = null;
let tray = null;
let pollTimer = null;
let adapter = null;
let openclawAdapter = null;
let watchdog = null;
let logStreamer = null;
let currentStatus = null;
let lastReady = null;

function runLocal(command, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = execFile('/bin/bash', ['-lc', command], {
      env: process.env,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && Number.isInteger(error.code) ? error.code : (error ? 1 : 0),
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : ''
      });
    });
    child.on('error', (error) => resolve({ ok: false, code: 1, stdout: '', stderr: '', error: error.message }));
  });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function cleanString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeSettings(raw) {
  const base = { ...SETTINGS_DEFAULTS, ...(raw || {}) };
  return {
    language: SUPPORTED_LANGUAGES.has(base.language) ? base.language : SETTINGS_DEFAULTS.language,
    theme: SUPPORTED_THEMES.has(base.theme) ? base.theme : SETTINGS_DEFAULTS.theme,
    autoServerEnabled: false,
    idleThresholdMinutes: clampInt(base.idleThresholdMinutes, 1, 240, SETTINGS_DEFAULTS.idleThresholdMinutes),
    serverCpuMax: clampInt(base.serverCpuMax, 20, 100, SETTINGS_DEFAULTS.serverCpuMax),
    turnOffDisplayOnServer: false,
    wslDistro: 'Linux',
    dashboardUrl: cleanString(base.dashboardUrl, SETTINGS_DEFAULTS.dashboardUrl),
    dashboardTaskName: '',
    labUnc: '',
    labRoot: cleanString(base.labRoot),
    hermesHome: cleanString(base.hermesHome),
    autoRestartEnabled: base.autoRestartEnabled === true,
    autoRestartMax: clampInt(base.autoRestartMax, 1, 10, SETTINGS_DEFAULTS.autoRestartMax)
  };
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return normalizeSettings(SETTINGS_DEFAULTS);
  }
}

function writeSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2));
  return normalized;
}

function autostartPath() {
  return path.join(home, '.config', 'autostart', 'ai-framework-controller.desktop');
}

function desktopExecQuote(value) {
  return `"${String(value).replace(/(["\\`$])/g, '\\$1')}"`;
}

function setStartupEnabled(enabled) {
  const file = autostartPath();
  if (!enabled) {
    try { fs.unlinkSync(file); } catch { /* already absent */ }
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const executable = app.isPackaged ? app.getPath('exe') : process.execPath;
  const args = app.isPackaged ? '--minimized' : `${desktopExecQuote(ROOT)} --minimized`;
  fs.writeFileSync(file, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=AI Framework Controller',
    `Exec=${desktopExecQuote(executable)} ${args}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Comment=Local Hermes and OpenClaw controller',
    ''
  ].join('\n'));
  return true;
}

function applySettings(settings) {
  CONFIG = { ...CONFIG, ...normalizeSettings(settings) };
}

function isConnectionConfigured() {
  return Boolean(CONFIG.labRoot && CONFIG.hermesHome);
}

function connectionSummary() {
  return {
    configured: isConnectionConfigured(),
    distro: 'Linux',
    dashboardUrl: CONFIG.dashboardUrl,
    dashboardTaskName: '',
    labUnc: CONFIG.labRoot,
    labRoot: CONFIG.labRoot,
    hermesHome: CONFIG.hermesHome
  };
}

function getSettings() {
  return {
    ...readSettings(),
    startupEnabled: fs.existsSync(autostartPath()),
    runtimePlatform: 'linux'
  };
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch { /* desktop notifications unavailable */ }
}

function createClients() {
  adapter = createHermesAdapter(runLocal, CONFIG);
  openclawAdapter = createOpenClawAdapter(runLocal);
  if (logStreamer) logStreamer.stop();
  logStreamer = createLinuxLogStreamer({
    hermesHome: CONFIG.hermesHome,
    onLine: (name, line) => sendToWindow('hermes:logLine', { name, line }),
    onEnd: (name) => sendToWindow('hermes:logEnd', { name })
  });
}

async function updateSettings(rawPatch) {
  const patch = rawPatch && typeof rawPatch === 'object' ? rawPatch : {};
  const before = readSettings();
  const next = { ...before };
  for (const key of ['language', 'theme', 'dashboardUrl', 'labRoot', 'hermesHome']) {
    if (typeof patch[key] === 'string') next[key] = patch[key];
  }
  if (typeof patch.autoRestartEnabled === 'boolean') next.autoRestartEnabled = patch.autoRestartEnabled;
  if (patch.autoRestartMax !== undefined) next.autoRestartMax = patch.autoRestartMax;
  if (typeof patch.startupEnabled === 'boolean') setStartupEnabled(patch.startupEnabled);
  const saved = writeSettings(next);
  const connectionChanged = ['dashboardUrl', 'labRoot', 'hermesHome'].some((key) => saved[key] !== before[key]);
  if (connectionChanged) {
    applySettings(saved);
    createClients();
    await publishStatus();
  }
  const result = getSettings();
  sendToWindow('hermes:settingsChanged', result);
  return result;
}

function requestJson(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const request = https.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'AI-Framework-Controller', Accept: 'application/vnd.github+json' }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: response.statusCode, error: 'invalid JSON response' }); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve({ ok: false, status: 0, error: 'request timed out' }); });
    request.on('error', (error) => resolve({ ok: false, status: 0, error: error.message }));
  });
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const result = await requestJson(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`);
  if (!result.ok) return { ok: false, currentVersion, status: result.status, error: result.error, releaseRepo: RELEASE_REPO, releasesUrl: RELEASES_URL, latestReleaseUrl: LATEST_RELEASE_URL };
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

function checkHttp(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve(false); return; }
    const client = parsed.protocol === 'https:' ? https : require('node:http');
    const request = client.get(parsed, { timeout: timeoutMs }, (response) => { response.resume(); resolve((response.statusCode || 500) < 500); });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function commandExists(name) {
  const result = await runLocal(`command -v ${shQuote(name)} >/dev/null 2>&1`, 3000);
  return result.ok;
}

async function getGatewayStatus() {
  const result = await runLocal([
    'if systemctl --user is-active --quiet hermes-gateway.service 2>/dev/null; then echo active;',
    "elif systemctl --user list-units 'hermes-gateway*.service' --state=running --no-legend --no-pager 2>/dev/null | grep -q .; then echo active;",
    'else systemctl --user is-active hermes-gateway.service 2>/dev/null || echo inactive; fi'
  ].join(' '), 7000);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || 'unknown';
}

async function getAuthStatus(installed) {
  if (!installed || !isConnectionConfigured()) return installed ? 'not configured' : 'not installed';
  const result = await runLocal(`cd ${shQuote(CONFIG.labRoot)} && HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes auth status openai-codex 2>&1 | head -n 1`, 12000);
  const value = result.stdout.trim();
  return /logged in/i.test(value) ? 'logged in' : (value || 'unknown');
}

async function getStatus() {
  const [installed, dashboardOnline, gateway] = await Promise.all([
    commandExists('hermes'),
    checkHttp(CONFIG.dashboardUrl),
    getGatewayStatus()
  ]);
  const codexAuth = await getAuthStatus(installed);
  const configured = isConnectionConfigured();
  const ready = Boolean(configured && installed && dashboardOnline && gateway === 'active' && codexAuth === 'logged in');
  let statusMessage = 'Hermes is configured on Linux, but one or more services are offline.';
  if (!configured) statusMessage = 'Configure the Hermes paths in Settings to begin.';
  else if (!installed) statusMessage = 'The Hermes CLI is not installed or is not on PATH.';
  else if (ready) statusMessage = 'Hermes is online and ready on this Linux host.';
  return {
    runtimePlatform: 'linux',
    hostLabel: 'Linux',
    shutdownLabel: 'Stop all gateways',
    shutdownHint: 'Gracefully stop Hermes and OpenClaw user services.',
    statusMessage,
    wslRunning: true,
    dashboardOnline,
    gateway: configured ? gateway : 'not configured',
    codexAuth: configured ? codexAuth : 'not configured',
    ready,
    connection: connectionSummary(),
    checkedAt: new Date().toISOString()
  };
}

async function publishStatus({ notifyChange = false } = {}) {
  const status = await getStatus();
  currentStatus = status;
  sendToWindow('hermes:statusChanged', status);
  if (notifyChange && lastReady !== null && lastReady !== status.ready) {
    notify(status.ready ? 'AI Framework Controller connected' : 'AI Framework Controller disconnected', status.statusMessage);
  }
  lastReady = status.ready;
  refreshTray();
  return status;
}

async function listProfiles() {
  if (!adapter) return { ok: false, error: 'adapter not ready', profiles: [] };
  return adapter.listProfiles();
}

async function listFrameworks() {
  const status = currentStatus || await getStatus();
  const installed = await commandExists('hermes');
  const warnings = [];
  if (!isConnectionConfigured()) warnings.push('not-configured');
  if (!installed) warnings.push('not-installed');
  if (status.gateway !== 'active') warnings.push('gateway-offline');
  const hermes = {
    id: 'hermes', name: 'Hermes', kind: 'framework', installed,
    gateway: { state: status.gateway, running: status.gateway === 'active' },
    dashboardUrl: CONFIG.dashboardUrl, warnings
  };
  const openclawResult = openclawAdapter ? await openclawAdapter.getStatus() : null;
  const openclaw = openclawResult && openclawResult.framework
    ? openclawResult.framework
    : { id: 'openclaw', name: 'OpenClaw', installed: false, gateway: { state: 'unknown', running: false }, agents: [], warnings: ['adapter-not-ready'] };
  return { ok: true, frameworks: [hermes, openclaw] };
}

async function runFrameworkAction(id, start) {
  let result;
  if (id === 'hermes') {
    const verb = start ? 'start' : 'stop';
    const script = start
      ? 'systemctl --user start hermes-dashboard.service >/dev/null 2>&1 || true; systemctl --user start hermes-gateway.service'
      : `systemctl --user stop hermes-dashboard.service >/dev/null 2>&1 || true; HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway stop >/dev/null 2>&1 || systemctl --user stop hermes-gateway.service`;
    result = await runLocal(script, 20000);
    if (!result.ok) result.error = result.stderr || result.error || `Hermes ${verb} failed`;
  } else if (id === 'openclaw') {
    result = await runLocal(`systemctl --user ${start ? 'start' : 'stop'} openclaw-gateway.service`, 18000);
    if (!result.ok) result.error = result.stderr || result.error || `OpenClaw ${start ? 'start' : 'stop'} failed`;
  } else {
    return { ok: false, error: 'unknown framework' };
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  const status = await publishStatus({ notifyChange: true });
  // stopAllGateways() halts the watchdog; starting a framework re-arms it.
  if (watchdog && start) watchdog.start();
  if (watchdog) watchdog.refreshNow();
  return { ok: result.ok, error: result.ok ? '' : result.error, status };
}

async function stopAllGateways() {
  await runLocal([
    'systemctl --user stop hermes-dashboard.service >/dev/null 2>&1 || true',
    "systemctl --user stop 'hermes-gateway*.service' >/dev/null 2>&1 || true",
    'systemctl --user stop openclaw-gateway.service >/dev/null 2>&1 || true',
    `HERMES_HOME=${shQuote(CONFIG.hermesHome)} hermes gateway stop >/dev/null 2>&1 || true`
  ].join('; '), 20000);
  if (watchdog) watchdog.stop();
  return publishStatus({ notifyChange: true });
}

function safeLocalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  } catch { return false; }
}

function openFrameworkDashboard(id) {
  const url = id === 'hermes' ? CONFIG.dashboardUrl : id === 'openclaw' ? OPENCLAW_DASHBOARD_URL : '';
  if (!url || !safeLocalUrl(url)) return { ok: false, error: 'invalid local dashboard URL' };
  shell.openExternal(url);
  return { ok: true, url };
}

function jsonPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(jsonPath(name), 'utf8')); } catch { return fallback; }
}

function writeJson(name, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(jsonPath(name), JSON.stringify(value, null, 2));
  return value;
}

function readLabels() {
  const labels = readJson('profile-labels.json', {});
  return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
}

function setLabel(name, label, desc) {
  const labels = readLabels();
  const cleanLabel = String(label || '').trim();
  const cleanDesc = String(desc || '').trim();
  if (!cleanLabel && !cleanDesc) delete labels[name];
  else labels[name] = { label: cleanLabel, desc: cleanDesc };
  return writeJson('profile-labels.json', labels);
}

function validProfile(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name);
}

function appendHistory(entry) {
  const history = readJson('profile-change-history.json', []);
  const next = [{ at: new Date().toISOString(), ...entry }, ...(Array.isArray(history) ? history : [])].slice(0, 200);
  return writeJson('profile-change-history.json', next);
}

function runtimeState() {
  const state = readJson('profile-runtime-state.json', {});
  return state && typeof state === 'object' ? state : {};
}

function markRestart(name, fields) {
  const state = runtimeState();
  state[name] = { ...(state[name] || {}), restartNeeded: true, reason: 'Profile runtime settings changed.', fields, changedAt: new Date().toISOString() };
  return writeJson('profile-runtime-state.json', state);
}

function clearRestart(name) {
  const state = runtimeState();
  if (state[name]) state[name] = { ...state[name], restartNeeded: false, clearedAt: new Date().toISOString() };
  return writeJson('profile-runtime-state.json', state);
}

async function setProfileModelSettings(name, patch) {
  if (!validProfile(name) || !adapter) return { ok: false, error: 'invalid profile or adapter unavailable' };
  const beforeList = await adapter.listProfiles();
  const before = beforeList && Array.isArray(beforeList.profiles)
    ? beforeList.profiles.find((p) => p.name === name)
    : null;
  const result = await adapter.setProfileModelSettings(name, patch);
  if (result.ok) {
    const fields = Object.keys(patch || {});
    // Only a running gateway has stale settings loaded, matching main.cjs.
    if (before && before.running && fields.length) markRestart(name, fields);
    appendHistory({ profile: name, action: 'settings.update', fields });
  }
  return result;
}

function getProfileOpsState() {
  const settings = readSettings();
  return {
    runtime: runtimeState(),
    history: readJson('profile-change-history.json', []),
    watchdog: {
      config: { autoRestartEnabled: settings.autoRestartEnabled, autoRestartMax: settings.autoRestartMax },
      state: watchdog ? watchdog.getState() : {}
    }
  };
}

async function diagnostics() {
  return {
    platform: 'linux',
    activePlan: { guid: 'linux', name: 'Linux systemd user services' },
    plans: [{ guid: 'linux', name: `${os.type()} ${os.release()}`, active: true }],
    linux: {
      memory: `${Math.round(os.totalmem() / (1024 ** 3))} GB`,
      processors: String(os.cpus().length),
      kernel: os.release()
    },
    wslConfig: { exists: false },
    requests: { ok: true, accessDenied: false, categories: {} }
  };
}

function appIcon() {
  return path.join(ROOT, 'build', 'icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 820,
    minWidth: 860,
    minHeight: 720,
    title: 'AI Framework Controller',
    icon: appIcon(),
    backgroundColor: '#111317',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--minimized')) mainWindow.show();
    publishStatus().then(() => watchdog && watchdog.refreshNow()).catch(() => {});
  });
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    { type: 'separator' },
    { label: 'Start Hermes', click: () => runFrameworkAction('hermes', true) },
    { label: 'Stop Hermes', click: () => runFrameworkAction('hermes', false) },
    { label: 'Start OpenClaw', click: () => runFrameworkAction('openclaw', true) },
    { label: 'Stop OpenClaw', click: () => runFrameworkAction('openclaw', false) },
    { type: 'separator' },
    { label: 'Quit Controller', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
}

function createTray() {
  try {
    const image = nativeImage.createFromPath(appIcon()).resize({ width: 22, height: 22 });
    tray = new Tray(image);
    tray.setToolTip('AI Framework Controller');
    tray.setContextMenu(trayMenu());
    tray.on('double-click', showWindow);
  } catch {
    tray = null;
  }
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(currentStatus && currentStatus.ready ? 'AI Framework Controller: connected' : 'AI Framework Controller: attention needed');
  tray.setContextMenu(trayMenu());
}

ipcMain.handle('hermes:getStatus', () => publishStatus());
ipcMain.handle('hermes:start', async () => (await runFrameworkAction('hermes', true)).status);
ipcMain.handle('hermes:stop', async () => (await runFrameworkAction('hermes', false)).status);
ipcMain.handle('hermes:shutdownWsl', async () => {
  const options = { type: 'warning', buttons: ['Stop gateways', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Stop all gateways', message: 'Stop Hermes and OpenClaw gateways?', detail: 'The Linux host stays running. Only controller-managed user services are stopped.' };
  const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  if (response !== 0) return { cancelled: true, status: currentStatus };
  return { cancelled: false, status: await stopAllGateways() };
});
ipcMain.handle('hermes:openDashboard', () => openFrameworkDashboard('hermes'));
ipcMain.handle('hermes:openFrameworkDashboard', (_event, id) => openFrameworkDashboard(id));
ipcMain.handle('hermes:openLabFolder', () => CONFIG.labRoot ? shell.openPath(CONFIG.labRoot) : { ok: false, error: 'Lab path is not configured.' });
ipcMain.handle('hermes:getAppInfo', () => ({ version: app.getVersion(), releaseRepo: RELEASE_REPO, releasesUrl: RELEASES_URL, latestReleaseUrl: LATEST_RELEASE_URL, runtimePlatform: 'linux' }));
ipcMain.handle('hermes:checkForUpdates', () => checkForUpdates());
ipcMain.handle('hermes:openReleasePage', () => shell.openExternal(LATEST_RELEASE_URL));
ipcMain.handle('hermes:getSettings', () => getSettings());
ipcMain.handle('hermes:updateSettings', (_event, patch) => updateSettings(patch));
ipcMain.handle('hermes:getMode', () => null);
ipcMain.handle('hermes:enterServerMode', () => null);
ipcMain.handle('hermes:exitServerMode', () => null);
ipcMain.handle('hermes:getModeHistory', () => []);
ipcMain.handle('hermes:getProfiles', () => listProfiles());
ipcMain.handle('hermes:getFrameworks', () => listFrameworks());
ipcMain.handle('hermes:frameworkStart', (_event, id) => runFrameworkAction(id, true));
ipcMain.handle('hermes:frameworkStop', (_event, id) => runFrameworkAction(id, false));
ipcMain.handle('hermes:getModelOptions', () => adapter ? adapter.modelOptions() : { ok: false, models: [], reasoning: [] });
ipcMain.handle('hermes:setProfileModelSettings', (_event, name, patch) => setProfileModelSettings(name, patch));
ipcMain.handle('hermes:getProfileOpsState', () => getProfileOpsState());
ipcMain.handle('hermes:getProfileBackups', (_event, name) => validProfile(name) && adapter ? adapter.listProfileBackups(name) : { ok: false, backups: [] });
ipcMain.handle('hermes:restoreProfileBackup', async (_event, name, backupId) => {
  if (!validProfile(name) || !adapter) return { ok: false, error: 'invalid profile or adapter unavailable' };
  const result = await adapter.restoreProfileBackup(name, backupId);
  if (result.ok) appendHistory({ profile: name, action: 'backup.restore', backupId });
  return result;
});
ipcMain.handle('hermes:getProfileLogSummary', (_event, name) => validProfile(name) && adapter ? adapter.profileLogSummary(name) : { ok: false });
ipcMain.handle('hermes:useProfile', (_event, name) => validProfile(name) && adapter ? adapter.useProfile(name) : { ok: false });
ipcMain.handle('hermes:gatewayStart', async (_event, name) => {
  if (!validProfile(name) || !adapter) return { ok: false };
  if (watchdog) { watchdog.setDesired(name, true); watchdog.start(); }
  const result = await adapter.gatewayStartProfile(name);
  if (result.ok) { clearRestart(name); appendHistory({ profile: name, action: 'gateway.start' }); }
  if (watchdog) setTimeout(() => watchdog.refreshNow(), 1800);
  return result;
});
ipcMain.handle('hermes:gatewayStop', async (_event, name) => {
  if (!validProfile(name) || !adapter) return { ok: false };
  if (watchdog) watchdog.setDesired(name, false);
  const result = await adapter.gatewayStopProfile(name);
  if (result.ok) appendHistory({ profile: name, action: 'gateway.stop' });
  if (watchdog) watchdog.refreshNow();
  return result;
});
ipcMain.handle('hermes:getDiagnostics', () => diagnostics());
ipcMain.handle('hermes:getRequestsElevated', () => ({ ok: true, accessDenied: false, categories: {} }));
ipcMain.handle('hermes:getProfileLabels', () => readLabels());
ipcMain.handle('hermes:setProfileLabel', (_event, name, label, desc) => validProfile(name) ? setLabel(name, label, desc) : readLabels());
ipcMain.handle('hermes:getWslMemory', () => ({ unsupported: true, totalGb: Math.round(os.totalmem() / (1024 ** 3)), currentGb: null, raw: null, exists: false }));
ipcMain.handle('hermes:setWslMemory', () => ({ ok: false, unsupported: true, restarted: false }));
ipcMain.handle('hermes:logStart', (_event, name) => logStreamer ? logStreamer.start(name) : { ok: false });
ipcMain.handle('hermes:logStop', () => { if (logStreamer) logStreamer.stop(); return { ok: true }; });

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    applySettings(readSettings());
    createClients();
    watchdog = createGatewayWatchdog({
      listProfiles: () => adapter.listProfiles(),
      startProfile: (name) => adapter.gatewayStartProfile(name),
      getConfig: () => readSettings(),
      onEvent: (event) => sendToWindow('hermes:gatewayEvent', event),
      onProfiles: (payload) => sendToWindow('hermes:profilesUpdated', payload),
      notify: ({ title, body }) => notify(title, body)
    });
    createTray();
    createWindow();
    watchdog.start();
    pollTimer = setInterval(() => publishStatus({ notifyChange: true }), 15000);
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
  if (watchdog) watchdog.stop();
  if (logStreamer) logStreamer.stop();
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
