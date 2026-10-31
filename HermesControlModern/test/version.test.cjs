const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions } = require('../electron/version.cjs');

test('a stable release is newer than its own prerelease', () => {
  assert.equal(compareVersions('0.3.0-beta.1', '0.3.0') < 0, true);
  assert.equal(compareVersions('0.3.0', '0.3.0-beta.1') > 0, true);
});

test('prerelease identifiers are compared field by field', () => {
  assert.equal(compareVersions('0.3.0-beta.1', '0.3.0-beta.2'), -1);
  assert.equal(compareVersions('0.3.0-beta.2', '0.3.0-beta.10'), -1);
  assert.equal(compareVersions('0.3.0-beta.2', '0.3.0-rc.1'), -1);
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0-beta.2'), 1);
  assert.equal(compareVersions('0.3.0-beta', '0.3.0-beta.1'), -1);
});

test('core versions and the v prefix', () => {
  assert.equal(compareVersions('v0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.3.0', '0.3.1'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0);
  assert.equal(compareVersions('0.4.0-beta.1', '0.3.0'), 1);
});
