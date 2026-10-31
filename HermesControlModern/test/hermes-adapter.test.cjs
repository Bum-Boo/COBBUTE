const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHermesAdapter } = require('../electron/hermes-adapter.cjs');

function decode(command) {
  const match = /^echo ([A-Za-z0-9+/=]+) \| base64 -d \| bash$/.exec(command);
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : null;
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-hermes-'));
  const backups = path.join(home, 'backups', 'controller-profile-models');
  for (const id of ['20260101-090000-b', '20260102-090000-team-b', '20260103-090000-b-old', 'notes-b']) {
    fs.mkdirSync(path.join(backups, id), { recursive: true });
    fs.writeFileSync(path.join(backups, id, 'config.yaml'), `model: ${id}\n`);
  }
  return home;
}

function adapterFor(home, calls) {
  // Runs the decoded script with the local bash, as WSL would.
  const runWsl = async (command) => {
    calls.push(command);
    const script = decode(command);
    if (script === null) return { ok: true, stdout: '', stderr: '' };
    try {
      return { ok: true, stdout: execFileSync('bash', ['-c', script], { encoding: 'utf8' }), stderr: '' };
    } catch (error) {
      return { ok: false, stdout: error.stdout || '', stderr: error.stderr || '', error: error.message };
    }
  };
  return createHermesAdapter(runWsl, { labRoot: home, hermesHome: home });
}

test('backup listing only returns backups taken from that exact profile', async () => {
  const home = makeHome();
  const result = await adapterFor(home, []).listProfileBackups('b');
  assert.equal(result.ok, true);
  assert.deepEqual(result.backups.map((b) => b.id), ['20260101-090000-b']);
});

test('restore refuses a backup that belongs to a different profile', async () => {
  const calls = [];
  const adapter = adapterFor(makeHome(), calls);
  for (const backupId of ['20260102-090000-team-b', '20260103-090000-b-old', 'notes-b', 'b', '../x-b', 12345, null]) {
    assert.deepEqual(await adapter.restoreProfileBackup('b', backupId), { ok: false, error: 'invalid backup id' });
  }
  assert.equal(calls.length, 0, 'no command may run for a rejected backup id');
});

test('restore accepts a backup id produced for the same profile', async () => {
  const calls = [];
  await adapterFor(makeHome(), calls).restoreProfileBackup('b', '20260101-090000-b');
  assert.equal(calls.length, 1);
  assert.match(decode(calls[0]), /controller-profile-models\/20260101-090000-b\/config\.yaml/);
});
