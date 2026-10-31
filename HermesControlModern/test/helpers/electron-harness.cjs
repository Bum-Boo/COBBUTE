// Loads electron/main.cjs or electron/main-linux.cjs with `electron`,
// `child_process`, `http` and `https` replaced by fakes. No real process is
// spawned and no network request is made; every call is recorded instead.
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const ELECTRON_DIR = path.resolve(__dirname, '..', '..', 'electron');

function createHarness({ execStdout = () => '', dialogResponse = 1 } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-test-'));
  const handlers = {};
  const execCalls = [];
  const spawnCalls = [];
  const httpCalls = [];
  const sent = [];
  let whenReadyCb = null;

  function fakeExecFile(file, args, _opts, cb) {
    execCalls.push({ file, args });
    const child = new EventEmitter();
    setImmediate(() => cb && cb(null, execStdout(file, args), ''));
    return child;
  }

  function fakeSpawn(file, args) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      // A real process reports `close` asynchronously after the kill.
      setTimeout(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit('close', null, 'SIGTERM');
      }, 5);
      return true;
    };
    spawnCalls.push({ file, args, child });
    return child;
  }

  function fakeHttpModule(protocol) {
    return {
      get(url, _opts, _cb) {
        httpCalls.push({ protocol, url: String(url) });
        const req = new EventEmitter();
        req.destroy = () => {};
        setImmediate(() => req.emit('error', new Error('network disabled in tests')));
        return req;
      }
    };
  }

  const childProcess = {
    ...require('node:child_process'),
    execFile: fakeExecFile,
    spawn: fakeSpawn,
    exec: () => { throw new Error('exec is not allowed in tests'); },
    execSync: () => { throw new Error('execSync is not allowed in tests'); }
  };

  const app = new EventEmitter();
  Object.assign(app, {
    setPath() {},
    getPath: (name) => (name === 'exe' ? '/fake/exe' : userData),
    disableHardwareAcceleration() {},
    requestSingleInstanceLock: () => true,
    exit() {},
    quit() {},
    getVersion: () => '0.3.0-beta.1',
    isPackaged: false,
    setLoginItemSettings() {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    whenReady: () => ({ then: (cb) => { whenReadyCb = cb; return { catch() {} }; } })
  });

  class FakeWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.webContents = { send: (channel, payload) => sent.push({ channel, payload }) };
    }
    removeMenu() {}
    loadFile() {}
    loadURL() {}
    isDestroyed() { return false; }
    show() {}
    hide() {}
    isMinimized() { return false; }
    isVisible() { return true; }
    restore() {}
    focus() {}
  }
  class FakeTray extends EventEmitter { setImage() {} setToolTip() {} setContextMenu() {} }

  const electron = {
    app,
    BrowserWindow: FakeWindow,
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu() {} },
    nativeImage: { createFromDataURL: () => ({}), createFromPath: () => ({ resize: () => ({}) }), createEmpty: () => ({}) },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    dialog: { showMessageBox: async () => ({ response: dialogResponse }) },
    Notification: class { show() {} static isSupported() { return false; } },
    powerMonitor: { getSystemIdleTime: () => 0, on() {} },
    powerSaveBlocker: { start: () => 1, stop() {}, isStarted: () => false }
  };

  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') return electron;
    if (request === 'node:child_process' || request === 'child_process') return childProcess;
    if (request === 'node:https' || request === 'https') return fakeHttpModule('https');
    if (request === 'node:http' || request === 'http') return fakeHttpModule('http');
    return originalLoad.call(this, request, ...rest);
  };

  return {
    userData,
    handlers,
    execCalls,
    spawnCalls,
    httpCalls,
    sent,
    load(file) { require(path.join(ELECTRON_DIR, file)); },
    ready() { if (whenReadyCb) whenReadyCb(); },
    invoke(channel, ...args) { return handlers[channel]({}, ...args); },
    writeSettings(settings) {
      fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
    },
    quit() { app.emit('before-quit'); }
  };
}

module.exports = { createHarness };
