// Linux main process (electron/main-linux.cjs) with every external call faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/electron-harness.cjs');

// The gateway watchdog polls every 20 s; track its interval timers.
const WATCHDOG_POLL_MS = 20000;
const activeWatchdogTimers = new Set();
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
global.setInterval = (fn, ms, ...args) => {
  const timer = realSetInterval(fn, ms, ...args);
  if (ms === WATCHDOG_POLL_MS) activeWatchdogTimers.add(timer);
  return timer;
};
global.clearInterval = (timer) => {
  activeWatchdogTimers.delete(timer);
  return realClearInterval(timer);
};

const harness = createHarness({
  dialogResponse: 0,
  execStdout(_file, args) {
    const command = args.at(-1) || '';
    if (/hermes profile list/.test(command)) return 'Profile  Model  Gateway  Alias\nalpha  gpt-5.5  stopped  —\n';
    return '';
  }
});
harness.writeSettings({ labRoot: '/home/me/lab', hermesHome: '/home/me/.hermes' });
harness.load('main-linux.cjs');
harness.ready();

test.after(() => harness.quit());

test('starting a framework after "stop all gateways" re-arms the crash watchdog', async () => {
  assert.equal(activeWatchdogTimers.size, 1, 'watchdog runs after startup');
  const stopped = await harness.invoke('hermes:shutdownWsl');
  assert.equal(stopped.cancelled, false);
  assert.equal(activeWatchdogTimers.size, 0, 'stop all gateways halts the watchdog');
  await harness.invoke('hermes:frameworkStart', 'hermes');
  assert.equal(activeWatchdogTimers.size, 1, 'framework start re-arms the watchdog');
});

test('changing settings of a stopped profile does not flag a restart', async () => {
  const result = await harness.invoke('hermes:setProfileModelSettings', 'alpha', { reasoning: 'high' });
  assert.equal(result.ok, true);
  const statePath = path.join(harness.userData, 'profile-runtime-state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  assert.notEqual(state.alpha && state.alpha.restartNeeded, true);
});
