// Semver-style version comparison shared by the Windows and Linux main processes.
//
// GitHub's /releases/latest only returns stable releases, so a beta build must
// treat `0.3.0` as newer than `0.3.0-beta.1`. Prerelease identifiers are compared
// field by field (numeric fields numerically, others lexically), per semver 2.0.

function parseVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '').split('+')[0];
  const dash = text.indexOf('-');
  const core = dash === -1 ? text : text.slice(0, dash);
  const pre = dash === -1 ? '' : text.slice(dash + 1);
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  return {
    core: [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0)),
    pre: pre ? pre.split('.') : []
  };
}

function comparePrereleaseField(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = left.core[i] - right.core[i];
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (!left.pre.length || !right.pre.length) {
    if (left.pre.length === right.pre.length) return 0;
    return left.pre.length ? -1 : 1;
  }
  const len = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < len; i += 1) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const diff = comparePrereleaseField(left.pre[i], right.pre[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

module.exports = { compareVersions };
