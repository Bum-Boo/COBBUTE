const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/electron-harness.cjs');

const harness = createHarness();
const { createLinuxLogStreamer } = require('../electron/log-streamer-linux.cjs');

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('restarting a stream keeps the new stream alive and correctly named', async () => {
  const events = [];
  const streamer = createLinuxLogStreamer({
    hermesHome: '/home/me/.hermes',
    onLine: (name, line) => events.push(['line', name, line]),
    onEnd: (name) => events.push(['end', name])
  });

  assert.equal(streamer.start('alpha').ok, true);
  const first = harness.spawnCalls.at(-1).child;
  assert.equal(streamer.start('__all__').ok, true);
  const second = harness.spawnCalls.at(-1).child;
  assert.notEqual(first, second);

  // The first child's `close` arrives after the second stream started.
  await tick(20);
  second.stdout.write('fresh line\n');
  await tick(5);

  assert.deepEqual(events, [['line', '__all__', 'fresh line']]);

  streamer.stop();
  assert.equal(second.killed, true, 'stop() must still reach the current child');
  await tick(20);
  assert.deepEqual(events.at(-1), ['line', '__all__', 'fresh line'], 'a stopped stream does not report end');
});

test('a stream that exits on its own reports end once', async () => {
  const events = [];
  const streamer = createLinuxLogStreamer({
    hermesHome: '/home/me/.hermes',
    onLine: () => {},
    onEnd: (name) => events.push(name)
  });
  streamer.start('alpha');
  const child = harness.spawnCalls.at(-1).child;
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);
  await tick(5);
  assert.deepEqual(events, ['alpha']);
});
