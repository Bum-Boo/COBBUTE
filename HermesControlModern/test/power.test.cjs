const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers/electron-harness.cjs');

createHarness();
const power = require('../electron/power.cjs');

test('the powercfg helper is resolved outside app.asar in a packaged build', () => {
  assert.equal(
    power.asarUnpackedPath('C:\\Program Files\\AI Framework Controller\\resources\\app.asar\\electron\\powercfg-helper.ps1'),
    'C:\\Program Files\\AI Framework Controller\\resources\\app.asar.unpacked\\electron\\powercfg-helper.ps1'
  );
  assert.equal(
    power.asarUnpackedPath('/opt/AI Framework Controller/resources/app.asar/electron/powercfg-helper.ps1'),
    '/opt/AI Framework Controller/resources/app.asar.unpacked/electron/powercfg-helper.ps1'
  );
});

test('development paths are left unchanged', () => {
  const dev = path.join('C:\\src\\COBBUTE\\HermesControlModern', 'electron', 'powercfg-helper.ps1');
  assert.equal(power.asarUnpackedPath(dev), dev);
});

test('electron-builder unpacks the helper so powershell.exe can read it', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
  assert.match(config, /^asarUnpack:\n(?:\s+- .*\n)*\s+- electron\/powercfg-helper\.ps1$/m);
});
