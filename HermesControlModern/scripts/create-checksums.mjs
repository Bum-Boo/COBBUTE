import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'release');
const output = path.join(root, 'SHA256SUMS.txt');

async function filesUnder(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else if (full !== output && !entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) out.push(full);
  }
  return out;
}

const files = (await filesUnder(root)).sort();
const lines = [];
for (const file of files) {
  const hash = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  lines.push(`${hash}  ${path.relative(root, file).split(path.sep).join('/')}`);
}
await fs.writeFile(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} checksums to ${output}`);
