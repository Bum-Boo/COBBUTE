// Windows main process (electron/main.cjs) with every external call faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/electron-harness.cjs');

const DISTRO = 'Ubuntu(dev)';
const TASK = `T"; Write-Output PWNED; $x="'`;

const harness = createHarness({
  execStdout(file, args) {
    if (args[0] === '-l' && args[1] === '-v') return `  NAME           STATE    VERSION\n* ${DISTRO}    Running  2\n`;
    return '';
  }
});
harness.writeSettings({
  wslDistro: DISTRO,
  dashboardUrl: 'https://127.0.0.1:9119',
  dashboardTaskName: TASK,
  labRoot: '/home/me/lab',
  hermesHome: '/home/me/.hermes'
});
harness.load('main.cjs');
harness.ready();

test.after(() => harness.quit());

test('status works with an https dashboard URL and a distro name containing regex characters', async () => {
  const status = await harness.invoke('hermes:getStatus');
  assert.equal(status.wslRunning, true);
  assert.equal(status.dashboardOnline, false);
  assert.ok(harness.httpCalls.some((call) => call.protocol === 'https' && call.url.startsWith('https://127.0.0.1:9119')));
});

test('scheduled task name is passed to PowerShell as a single-quoted literal', async () => {
  await harness.invoke('hermes:start');
  const ps = harness.execCalls.find((call) => call.file === 'powershell.exe' && /Start-ScheduledTask/.test(call.args.at(-1)));
  assert.ok(ps, 'Start-ScheduledTask was not invoked');
  assert.equal(ps.args.at(-1), `Start-ScheduledTask -TaskName 'T"; Write-Output PWNED; $x="'''`);
});

test('log streaming rejects an unsafe profile name before reaching WSL', async () => {
  const before = harness.spawnCalls.length;
  const result = await harness.invoke('hermes:logStart', 'x$(touch /tmp/afc-pwn)');
  assert.equal(result.ok, false);
  assert.equal(harness.spawnCalls.length, before);
  assert.equal((await harness.invoke('hermes:logStart', 'alpha')).ok, true);
  assert.equal((await harness.invoke('hermes:logStart', '__all__')).ok, true);
  await harness.invoke('hermes:logStop');
});

test('updateSettings tolerates a non-object payload', async () => {
  const settings = await harness.invoke('hermes:updateSettings', null);
  assert.equal(settings.wslDistro ?? settings.settings?.wslDistro ?? DISTRO, DISTRO);
});
