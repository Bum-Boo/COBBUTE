const { spawn } = require('node:child_process');
const readline = require('node:readline');

const ALL_LOGS = '__all__';

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createLinuxLogStreamer({ hermesHome, onLine, onEnd }) {
  let child = null;
  let requestedName = null;

  function stop() {
    if (child && !child.killed) child.kill('SIGTERM');
    child = null;
    requestedName = null;
  }

  function start(name) {
    stop();
    if (typeof name !== 'string' || (name !== ALL_LOGS && !/^[A-Za-z0-9_-]+$/.test(name))) {
      return { ok: false, error: 'invalid profile name' };
    }

    requestedName = name;
    const root = `${hermesHome}/profiles`;
    const selector = name === ALL_LOGS
      ? `find ${shQuote(root)} -type f \\( -name gateway.log -o -name gateway.controller.log \\) -print0 2>/dev/null`
      : `find ${shQuote(`${root}/${name}/logs`)} -maxdepth 1 -type f \\( -name gateway.log -o -name gateway.controller.log \\) -print0 2>/dev/null`;
    const script = [
      'set -o pipefail',
      `mapfile -d '' files < <(${selector})`,
      'if [ ${#files[@]} -eq 0 ]; then echo "No gateway logs found yet."; exec sleep infinity; fi',
      'exec tail -n 160 -F "${files[@]}"'
    ].join('; ');

    const proc = spawn('/bin/bash', ['-lc', script], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child = proc;

    // A stopped stream closes asynchronously, possibly after a newer stream has
    // started; only the stream that still owns `child` may touch shared state.
    const stdout = readline.createInterface({ input: proc.stdout });
    const stderr = readline.createInterface({ input: proc.stderr });
    stdout.on('line', (line) => { if (child === proc) onLine(name, line); });
    stderr.on('line', (line) => { if (child === proc) onLine(name, line); });
    proc.once('close', () => {
      if (child !== proc) return;
      child = null;
      requestedName = null;
      onEnd(name);
    });
    return { ok: true };
  }

  return { start, stop };
}

module.exports = { createLinuxLogStreamer };
