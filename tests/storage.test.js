// tests/storage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, setSettings, isBlacklisted, DEFAULT_SETTINGS } from '../src/shared/storage.js';

function fakeStorage(initial = {}) {
  let store = { ...initial };
  return {
    get: async (defaults) => ({ ...defaults, ...store }),
    set: async (partial) => { store = { ...store, ...partial }; },
    _dump: () => store,
  };
}

test('getSettings merges stored values over defaults', async () => {
  const storage = fakeStorage({ subfolder: 'Custom' });
  const settings = await getSettings(storage);
  assert.equal(settings.subfolder, 'Custom');
  assert.equal(settings.filenameTemplate, DEFAULT_SETTINGS.filenameTemplate);
});

test('setSettings persists a partial update', async () => {
  const storage = fakeStorage();
  await setSettings({ theme: 'dark' }, storage);
  assert.equal(storage._dump().theme, 'dark');
});

test('isBlacklisted matches exact hostname', () => {
  const settings = { blacklist: ['example.com'] };
  assert.equal(isBlacklisted('example.com', settings), true);
  assert.equal(isBlacklisted('other.com', settings), false);
});

test('isBlacklisted matches subdomains of a blacklisted domain', () => {
  const settings = { blacklist: ['example.com'] };
  assert.equal(isBlacklisted('cdn.example.com', settings), true);
});

test('isBlacklisted returns false for an empty blacklist', () => {
  assert.equal(isBlacklisted('example.com', { blacklist: [] }), false);
});
