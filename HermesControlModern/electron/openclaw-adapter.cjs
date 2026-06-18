// Read-only adapter for OpenClaw inside WSL.
//
// This adapter deliberately avoids raw config dumps and never returns token
// values. It reports framework/gateway/agent shape only so the controller can
// show OpenClaw beside Hermes without becoming an OpenClaw executor.

function createOpenClawAdapter(runWsl) {
  function b64wrap(script) {
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    return `echo ${b64} | base64 -d | bash`;
  }

  async function getStatus() {
    const script = String.raw`python3 - <<'PY'
import json, os, re, subprocess, sys
from pathlib import Path

out = {
    'id': 'openclaw',
    'name': 'OpenClaw',
    'kind': 'framework',
    'installed': False,
    'version': None,
    'gateway': {'service': 'openclaw-gateway.service', 'state': 'unknown', 'running': False, 'pid': None, 'port': 18789},
    'dashboardUrl': 'http://127.0.0.1:18789/',
    'agents': [],
    'plugins': [],
    'channels': [],
    'warnings': [],
}

def run(cmd, timeout=8):
    try:
        return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    except Exception as exc:
        class R:
            returncode = 1
            stdout = ''
            stderr = str(exc)
        return R()

res = run(['bash', '-lc', 'command -v openclaw'], 4)
if res.returncode == 0 and res.stdout.strip():
    out['installed'] = True
    out['binary'] = res.stdout.strip()
else:
    print(json.dumps(out, ensure_ascii=False))
    raise SystemExit(0)

ver = run(['openclaw', '--version'], 6)
if ver.returncode == 0:
    out['version'] = ver.stdout.strip().splitlines()[0] if ver.stdout.strip() else None

svc = run(['systemctl', '--user', 'show', 'openclaw-gateway.service', '--property=ActiveState,MainPID,ExecMainStatus', '--no-page'], 6)
if svc.returncode == 0:
    props = {}
    for line in svc.stdout.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            props[k] = v
    state = props.get('ActiveState') or 'unknown'
    pid = props.get('MainPID') or '0'
    out['gateway']['state'] = state
    out['gateway']['running'] = state == 'active'
    out['gateway']['pid'] = int(pid) if pid.isdigit() and int(pid) > 0 else None
else:
    out['gateway']['state'] = 'unavailable'

cfg_path = Path.home() / '.openclaw' / 'openclaw.json'
out['configPath'] = str(cfg_path)
out['stateRoot'] = str(Path.home() / '.openclaw')
if cfg_path.exists():
    try:
        data = json.loads(cfg_path.read_text(encoding='utf-8'))
        agents = ((data.get('agents') or {}).get('list') or [])
        for agent in agents:
            runtime = None
            models = agent.get('models') or {}
            primary = (agent.get('model') or {}).get('primary')
            if primary and isinstance(models.get(primary), dict):
                runtime = ((models[primary].get('agentRuntime') or {}).get('id'))
            out['agents'].append({
                'id': agent.get('id'),
                'name': agent.get('name') or agent.get('id'),
                'model': primary,
                'runtime': runtime,
                'workspace': agent.get('workspace'),
                'emoji': ((agent.get('identity') or {}).get('emoji')),
            })
        plugins = data.get('plugins') or {}
        entries = plugins.get('entries') or {}
        out['plugins'] = [name for name, meta in entries.items() if isinstance(meta, dict) and meta.get('enabled')]
        channels = data.get('channels') or {}
        for cname, channel in channels.items():
            accounts = []
            for aid, account in ((channel or {}).get('accounts') or {}).items():
                accounts.append({'id': aid, 'name': account.get('name') or aid, 'enabled': account.get('enabled') is True, 'hasTokenFile': bool(account.get('tokenFile'))})
            out['channels'].append({'name': cname, 'enabled': (channel or {}).get('enabled') is True, 'accounts': accounts})
        if ((data.get('gateway') or {}).get('auth') or {}).get('token'):
            out['warnings'].append('gateway-auth-token-inline')
    except Exception as exc:
        out['warnings'].append('config-parse-failed')
        out['configError'] = str(exc)
else:
    out['warnings'].append('config-missing')

print(json.dumps(out, ensure_ascii=False))
PY`;
    const result = await runWsl(b64wrap(script), 12000);
    try {
      const status = JSON.parse(result.stdout || '{}');
      return { ok: result.ok, framework: status };
    } catch {
      return { ok: false, framework: { id: 'openclaw', name: 'OpenClaw', installed: false, gateway: { state: 'unknown', running: false }, agents: [], warnings: ['status-parse-failed'] }, error: result.stderr || result.error || 'openclaw status parse failed' };
    }
  }

  return { getStatus };
}

module.exports = { createOpenClawAdapter };
