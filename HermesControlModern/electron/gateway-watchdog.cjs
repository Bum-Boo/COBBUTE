// Gateway watchdog: polls every profile's gateway state on a cadence, detects
// crashes (a gateway that was confirmed running and is now stopped without the
// user asking for it), and — only when the user opts in — auto-restarts it.
//
// Auto-restart defaults OFF on purpose: the Hermes lab already has its own
// gateway supervisor/restart logic, so blindly restarting here can fight it.
// Crash DETECTION (badge + toast + notification) is always on and side-effect
// free; the actual restart ACTION is gated behind a setting.
//
// "Desired" = the set of gateways the controller believes should be running.
// Seeded from whatever is running at first poll, then updated by user start/stop
// and by externally-observed running gateways (with a short suppression window
// after a manual stop so a slow stop isn't misread as a crash).

const DEFAULT_POLL_MS = 20000;
const RETRY_WINDOW_MS = 10 * 60 * 1000; // retry budget resets after 10 min
const STOP_SUPPRESS_MS = 15000; // ignore a name for 15s after a manual stop

function createGatewayWatchdog(deps) {
  const {
    listProfiles, // () => Promise<{ ok, profiles:[{name,running,...}] }>
    startProfile, // (name) => Promise<{ ok }>
    getConfig, // () => { autoRestartEnabled, autoRestartMax }
    onEvent, // ({ type, name, ... }) => void
    onProfiles, // ({ profiles, at }) => void
    notify, // ({ title, body }) => void
    getText, // () => native notification strings
    pollMs = DEFAULT_POLL_MS
  } = deps;

  let timer = null;
  let polling = false;
  let lastRunning = null; // Set<string> | null (null until first poll)
  const desired = new Set();
  const suppress = new Map(); // name -> untilTs
  const retries = new Map(); // name -> { count, windowStart }

  function text() {
    const fallback = {
      crashTitle: 'Gateway interruption detected',
      crashBody: (name) => `${name} gateway stopped unexpectedly.`,
      restartStoppedTitle: 'Auto restart stopped',
      restartStoppedBody: (name, max) => `${name}: exceeded max retries (${max}).`,
      autoRestartTitle: 'Gateway auto restart',
      autoRestartBody: (name, count, max) => `${name} (attempt ${count}/${max})`
    };
    return { ...fallback, ...(typeof getText === 'function' ? getText() : {}) };
  }

  function isSuppressed(name, nowTs) {
    const until = suppress.get(name);
    if (until === undefined) return false;
    if (nowTs >= until) { suppress.delete(name); return false; }
    return true;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const res = await listProfiles();
      if (!res || !res.ok) return;
      const profiles = res.profiles || [];
      const nowTs = Date.now();
      const running = new Set(profiles.filter((p) => p.running).map((p) => p.name));

      if (typeof onProfiles === 'function') onProfiles({ profiles, at: nowTs });

      // Crash detection: was up last poll, desired, now down, not just-stopped.
      if (lastRunning) {
        for (const name of lastRunning) {
          if (!running.has(name) && desired.has(name) && !isSuppressed(name, nowTs)) {
            handleCrash(name);
          }
        }
      }

      // Infer desired from what is actually running (covers externally-started
      // gateways), except names a user just asked to stop.
      for (const name of running) {
        if (!isSuppressed(name, nowTs)) desired.add(name);
      }

      lastRunning = running;
    } finally {
      polling = false;
    }
  }

  async function handleCrash(name) {
    if (typeof onEvent === 'function') onEvent({ type: 'crash', name, at: Date.now() });
    if (typeof notify === 'function') {
      notify({ title: text().crashTitle, body: text().crashBody(name) });
    }

    const cfg = getConfig() || {};
    if (!cfg.autoRestartEnabled) return;

    const max = Math.max(1, Number(cfg.autoRestartMax) || 3);
    const nowTs = Date.now();
    const r = retries.get(name) || { count: 0, windowStart: nowTs };
    if (nowTs - r.windowStart > RETRY_WINDOW_MS) { r.count = 0; r.windowStart = nowTs; }

    if (r.count >= max) {
      retries.set(name, r);
      if (typeof onEvent === 'function') onEvent({ type: 'restart-failed', name, reason: 'max-retries' });
      if (typeof notify === 'function') notify({ title: text().restartStoppedTitle, body: text().restartStoppedBody(name, max) });
      return;
    }

    r.count += 1;
    retries.set(name, r);
    if (typeof onEvent === 'function') onEvent({ type: 'restarting', name, attempt: r.count, max });
    try {
      const result = await startProfile(name);
      if (result && result.ok !== false) {
        if (typeof onEvent === 'function') onEvent({ type: 'restarted', name, attempt: r.count, max });
        if (typeof notify === 'function') notify({ title: text().autoRestartTitle, body: text().autoRestartBody(name, r.count, max) });
      } else {
        if (typeof onEvent === 'function') onEvent({ type: 'restart-failed', name, reason: (result && result.output) || 'start failed' });
      }
    } catch (error) {
      if (typeof onEvent === 'function') onEvent({ type: 'restart-failed', name, reason: String(error && error.message ? error.message : error) });
    }
  }

  return {
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, pollMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    refreshNow() {
      return poll();
    },
    // Called from the start/stop IPC handlers so user intent drives `desired`.
    setDesired(name, on) {
      if (on) {
        desired.add(name);
        retries.delete(name);
        suppress.delete(name);
      } else {
        desired.delete(name);
        suppress.set(name, Date.now() + STOP_SUPPRESS_MS);
      }
    },
    getState() {
      return {
        desired: Array.from(desired).sort(),
        lastRunning: lastRunning ? Array.from(lastRunning).sort() : [],
        retries: Array.from(retries.entries()).map(([name, value]) => ({ name, ...value })),
        suppressed: Array.from(suppress.entries()).map(([name, until]) => ({ name, until }))
      };
    }
  };
}

module.exports = { createGatewayWatchdog };
