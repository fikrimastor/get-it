import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateStore, badgeTextFor } from '../src/background/tab-state.js';

function fakeSessionStorage(initial = {}) {
  let store = { ...initial };
  return {
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { store = { ...store, ...obj }; },
    remove: async (key) => { delete store[key]; },
    _dump: () => store,
  };
}

test('badgeTextFor renders an empty string for zero items', () => {
  assert.equal(badgeTextFor(0), '');
});

test('badgeTextFor renders the count as a string otherwise', () => {
  assert.equal(badgeTextFor(3), '3');
});

test('tab state store returns an empty array for an unknown tab', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  assert.deepEqual(await store.getItems(999), []);
});

test('tab state store accumulates items per tab', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  assert.equal((await store.getItems(1)).length, 2);
});

test('tab state store de-duplicates items with the same source url', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  assert.equal((await store.getItems(1)).length, 1);
});

test('tab state store clearTab removes all items for that tab only', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(2, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  await store.clearTab(1);
  assert.deepEqual(await store.getItems(1), []);
  assert.equal((await store.getItems(2)).length, 1);
});

test('setItems overwrites the full list for a tab (used for in-place metadata patches)', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: null });
  const items = await store.getItems(1);
  items[0] = { ...items[0], title: 'Patched' };
  await store.setItems(1, items);
  assert.equal((await store.getItems(1))[0].title, 'Patched');
});

test('tab state store persists across independent store instances backed by the same storage (simulates a service-worker restart)', async () => {
  const sharedBackingStorage = fakeSessionStorage();
  const storeBeforeRestart = createTabStateStore(sharedBackingStorage);
  await storeBeforeRestart.addItem(7, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });

  // A fresh createTabStateStore() call models what happens when the service
  // worker's top-level script re-executes after Chrome restarts it — a new
  // in-memory closure, but the same underlying chrome.storage.session data.
  const storeAfterRestart = createTabStateStore(sharedBackingStorage);
  assert.equal((await storeAfterRestart.getItems(7)).length, 1);
});
