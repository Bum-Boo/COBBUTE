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

    child = spawn('/bin/bash', ['-lc', script], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });
    stdout.on('line', (line) => onLine(requestedName, line));
    stderr.on('line', (line) => onLine(requestedName, line));
    child.once('close', () => {
      const endedName = requestedName;
      child = null;
      requestedName = null;
      if (endedName) onEnd(endedName);
    });
    return { ok: true };
  }

  return { start, stop };
}

module.exports = { createLinuxLogStreamer };
