// Windows (WSL) log streamer: the generated bash/python script must treat the
// profile name and Hermes Home as data. The decoded script is executed with the
// real bash/python3 against a temp dir, with `tail` replaced by a stub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('./helpers/electron-harness.cjs');

const harness = createHarness();
const { createLogStreamer } = require('../electron/log-streamer.cjs');

function decodeScript(spawnCall) {
  const wrapped = spawnCall.args[spawnCall.args.length - 1];
  const match = /^echo ([A-Za-z0-9+/=]+) \| base64 -d \| bash$/.exec(wrapped);
  assert.ok(match, `unexpected wrapper: ${wrapped}`);
  return Buffer.from(match[1], 'base64').toString('utf8');
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afc-log-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'tail'), '#!/bin/sh\nfor a in "$@"; do echo "TAIL_ARG:$a"; done\n', { mode: 0o755 });
  return { dir, bin, marker: path.join(dir, 'INJECTED') };
}

function runDecoded(script, box) {
  return execFileSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}` },
    encoding: 'utf8'
  });
}

function streamerFor(hermesHome) {
  return createLogStreamer({ wslPath: 'wsl.exe', distro: 'Ubuntu', hermesHome, onLine() {}, onEnd() {} });
}

test('rejects profile names outside the safe charset without spawning', () => {
  const before = harness.spawnCalls.length;
  const streamer = streamerFor('/home/me/.hermes');
  for (const name of ['x$(touch /tmp/afc-pwn)', 'a b', '../etc', 42, null]) {
    assert.deepEqual(streamer.start(name), { ok: false, error: 'invalid profile name' });
  }
  assert.equal(harness.spawnCalls.length, before);
});

test('single-profile script keeps a hostile Hermes Home literal', () => {
  const box = sandbox();
  const home = `${box.dir}/h"; touch ${box.marker}; echo "$(touch ${box.marker})'`;
  const streamer = streamerFor(home);
  assert.equal(streamer.start('alpha').ok, true);
  const output = runDecoded(decodeScript(harness.spawnCalls.at(-1)), box);
  streamer.stop();
  assert.equal(fs.existsSync(box.marker), false, 'Hermes Home was executed as shell code');
  assert.match(output, new RegExp(`TAIL_ARG:${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/profiles/alpha/logs/gateway.controller.log`));
});

test('all-profiles script passes Hermes Home to python as data', () => {
  const box = sandbox();
  const home = `${box.dir}/h')\nopen(${JSON.stringify(box.marker)}, 'w').close()\n#`;
  const streamer = streamerFor(home);
  assert.equal(streamer.start('__all__').ok, true);
  const output = runDecoded(decodeScript(harness.spawnCalls.at(-1)), box);
  streamer.stop();
  assert.equal(fs.existsSync(box.marker), false, 'Hermes Home was executed as python code');
  assert.match(output, /\[all\] No log files found\./);
});

test('all-profiles script still finds gateway logs under a normal Hermes Home', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'hermes home');
  fs.mkdirSync(path.join(home, 'profiles', 'alpha', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles', 'alpha', 'logs', 'gateway.log'), 'hello\n');
  const streamer = streamerFor(home);
  streamer.start('__all__');
  const script = decodeScript(harness.spawnCalls.at(-1));
  streamer.stop();
  // The stub `tail` prints its arguments, which the script tags with the profile name.
  const output = runDecoded(script, box);
  assert.match(output, /\[all\] TAIL_ARG:.*hermes home\/profiles\/alpha\/logs\/gateway\.log/);
});
