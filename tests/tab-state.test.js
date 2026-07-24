import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateStore, badgeTextFor } from '../src/background/tab-state.js';

function fakeSessionStorage(initial = {}) {
  let store = { ...initial };
  return {
    get: async (key) => {
      await Promise.resolve();
      return key in store ? { [key]: store[key] } : {};
    },
    set: async (obj) => {
      await Promise.resolve();
      store = { ...store, ...obj };
    },
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

test('addItem cross-field dedup matches existing manifestUrl against incoming progressiveUrl', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  // Item detected via HLS sniffing — manifestUrl is set, progressiveUrl is null.
  await store.addItem(1, { id: 'a', manifestUrl: 'https://x/stream.m3u8', progressiveUrl: null, title: 'HLS stream' });
  // Same URL now reported via DOM scan — progressiveUrl is set, manifestUrl is null.
  await store.addItem(
    1,
    { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/stream.m3u8', title: 'DOM title' },
    (existing, incoming) => ({ ...existing, title: existing.title || incoming.title })
  );
  const items = await store.getItems(1);
  assert.equal(items.length, 1, 'must not duplicate across manifestUrl/progressiveUrl fields for the same URL');
  assert.equal(items[0].id, 'a', 'original HLS item identity preserved');
});

test('tab state store clearTab removes all items for that tab only', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(2, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  await store.clearTab(1);
  assert.deepEqual(await store.getItems(1), []);
  assert.equal((await store.getItems(2)).length, 1);
});


test('tab state store persists across independent store instances backed by the same storage (simulates a service-worker restart)', async () => {
  const sharedBackingStorage = fakeSessionStorage();
  const storeBeforeRestart = createTabStateStore(sharedBackingStorage);
  await storeBeforeRestart.addItem(7, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  const storeAfterRestart = createTabStateStore(sharedBackingStorage);
  assert.equal((await storeAfterRestart.getItems(7)).length, 1);
});

test('tab state store serializes concurrent addItem calls for the same tab so neither write is lost', async () => {
  const storage = fakeSessionStorage();
  const store = createTabStateStore(storage);

  // Fired concurrently, without awaiting the first before starting the
  // second — this mirrors handleCandidate's fire-and-forget dispatch in
  // production, where several near-simultaneous network candidates (or
  // several frames under content_scripts' all_frames: true) can each call
  // addItem for the same tab before the previous call's write lands.
  // Without per-tab serialization this deterministically loses a write:
  // both calls' getItems() read would resolve against the same
  // pre-update empty array (Node's microtask queue runs both async
  // storage reads before either write commits), both compute a
  // one-item "updated" array, and the second setItems() call overwrites
  // the first's write instead of building on it.
  const [a, b] = await Promise.all([
    store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' }),
    store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' }),
  ]);

  const finalItems = await store.getItems(1);
  assert.equal(finalItems.length, 2, 'both concurrently-added items must survive, not just the last write');
});

test('addItem mergeDuplicate merges into the existing matching item instead of appending a duplicate', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: null, posterUrl: null });

  await store.addItem(
    1,
    { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: 'FromDOM', posterUrl: 'poster.jpg' },
    (existing, incoming) => ({ ...existing, title: existing.title || incoming.title, posterUrl: existing.posterUrl || incoming.posterUrl })
  );

  const items = await store.getItems(1);
  assert.equal(items.length, 1, 'mergeDuplicate must not create a new item');
  assert.equal(items[0].title, 'FromDOM', 'mergeDuplicate fills null fields from incoming');
  assert.equal(items[0].posterUrl, 'poster.jpg', 'mergeDuplicate fills null posterUrl');
  assert.equal(items[0].id, 'a', 'mergeDuplicate preserves the existing item identity');
});

test('concurrent duplicate enrichment under the per-tab lock does not drop or duplicate items', async () => {
  const store = createTabStateStore(fakeSessionStorage());

  // One item already stored.
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: null, posterUrl: null });

  // Two concurrent operations: one enriches the existing duplicate, one adds a fresh item.
  const mergeFn = (existing, incoming) => ({
    ...existing,
    title: existing.title || incoming.title,
    posterUrl: existing.posterUrl || incoming.posterUrl,
  });
  await Promise.all([
    store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: 'Enriched', posterUrl: 'p.jpg' }, mergeFn),
    store.addItem(1, { id: 'c', manifestUrl: null, progressiveUrl: 'https://x/2.mp4', title: 'Fresh', posterUrl: 'q.jpg' }),
  ]);

  const items = await store.getItems(1);
  assert.equal(items.length, 2, 'two unique urls after concurrent operations');
  const first = items.find((i) => i.progressiveUrl === 'https://x/1.mp4');
  assert.equal(first.title, 'Enriched', 'existing item enriched atomically');
  assert.equal(first.posterUrl, 'p.jpg', 'existing item poster enriched');
  assert.equal(first.id, 'a', 'original id preserved through merge');
  const second = items.find((i) => i.progressiveUrl === 'https://x/2.mp4');
  assert.equal(second.title, 'Fresh', 'fresh item added concurrently survives');
  assert.equal(second.id, 'c', 'fresh item id preserved');
});
