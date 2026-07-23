import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateStore, badgeTextFor } from '../src/background/tab-state.js';

test('badgeTextFor renders an empty string for zero items', () => {
  assert.equal(badgeTextFor(0), '');
});

test('badgeTextFor renders the count as a string otherwise', () => {
  assert.equal(badgeTextFor(3), '3');
});

test('tab state store returns an empty array for an unknown tab', () => {
  const store = createTabStateStore();
  assert.deepEqual(store.getItems(999), []);
});

test('tab state store accumulates items per tab', () => {
  const store = createTabStateStore();
  store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  assert.equal(store.getItems(1).length, 2);
});

test('tab state store de-duplicates items with the same source url', () => {
  const store = createTabStateStore();
  store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  assert.equal(store.getItems(1).length, 1);
});

test('tab state store clearTab removes all items for that tab only', () => {
  const store = createTabStateStore();
  store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  store.addItem(2, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  store.clearTab(1);
  assert.deepEqual(store.getItems(1), []);
  assert.equal(store.getItems(2).length, 1);
});
