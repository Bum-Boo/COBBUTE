import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'README.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'SUPPORT.md',
  'electron-builder.yml', 'electron/bootstrap.cjs', 'electron/main.cjs',
  'electron/main-linux.cjs', 'build/icon.png', 'build/icon.ico',
  '.github/workflows/release.yml'
];
const failures = [];

for (const file of required) {
  try { await fs.access(path.join(root, file)); }
  catch { failures.push(`missing required file: ${file}`); }
}

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.main !== 'electron/bootstrap.cjs') failures.push('package.json main must use the platform bootstrap');
if (!pkg.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) failures.push('package version is not valid semver');
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME.startsWith('v') && process.env.GITHUB_REF_NAME.slice(1) !== pkg.version) {
  failures.push(`tag ${process.env.GITHUB_REF_NAME} does not match package version ${pkg.version}`);
}

const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
for (const expected of ['Windows', 'Linux', 'WSL2', 'AppImage', 'Security']) {
  if (!readme.includes(expected)) failures.push(`README is missing ${expected} documentation`);
}
if (/\uFFFD|Settings \?\?|\?곌|\?▲/.test(readme)) failures.push('README contains encoding corruption');

const ignored = new Set(['node_modules', 'dist', 'release', '.git', 'build']);
const secretPatterns = [
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{32,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['Discord token', /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,40}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];

async function scan(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name === 'package-lock.json') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await scan(full);
    else {
      const stat = await fs.stat(full);
      if (stat.size > 2 * 1024 * 1024) continue;
      const text = await fs.readFile(full, 'utf8').catch(() => '');
      for (const [label, pattern] of secretPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) failures.push(`${label} pattern found in ${path.relative(root, full)}`);
      }
    }
  }
}
await scan(root);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Release checks passed for v${pkg.version}.`);
