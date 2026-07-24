// src/background/tab-state.js
//
// Per-tab detected-media store, backed by chrome.storage.session (not a
// plain in-memory Map). MV3 service workers are terminated aggressively by
// Chrome after brief idle periods — a plain Map loses everything on restart,
// so items detected moments before a restart vanish by the time the user
// opens the popup. chrome.storage.session exists specifically to survive
// service-worker restarts within a browsing session while still being
// cleared when the browser closes (unlike .local/.sync, which persist
// forever and would leak stale per-tab detection state indefinitely).

const STORAGE_PREFIX = 'tabItems_';

export function createTabStateStore(storageApi = chrome.storage.session) {
  // Serializes read-modify-write operations per tabId. chrome.storage.session
  // has no atomic read-modify-write primitive, and candidates can legitimately
  // arrive concurrently for the same tab (multiple near-simultaneous network
  // responses, or several frames independently reporting via content_scripts'
  // all_frames: true) — an unserialized get-then-set race would let the
  // second write silently clobber the first, dropping a detected item.
  const tabLocks = new Map();

  function withLock(tabId, fn) {
    const previous = tabLocks.get(tabId) || Promise.resolve();
    const next = previous.then(fn, fn);
    const tail = next.catch(() => {});
    tabLocks.set(tabId, tail);
    tail.finally(() => {
      if (tabLocks.get(tabId) === tail) tabLocks.delete(tabId);
    });
    return next;
  }

  function keyFor(tabId) {
    return `${STORAGE_PREFIX}${tabId}`;
  }

  async function getItems(tabId) {
    const key = keyFor(tabId);
    const stored = await storageApi.get(key);
    return stored[key] || [];
  }

  async function setItems(tabId, items) {
    await storageApi.set({ [keyFor(tabId)]: items });
  }

  function addItem(tabId, item, mergeDuplicate) {
    return withLock(tabId, async () => {
      const existing = await getItems(tabId);
      const itemUrls = [item.manifestUrl, item.progressiveUrl].filter(Boolean);
      const dupeIndex = existing.findIndex(
        (i) => itemUrls.includes(i.manifestUrl) || itemUrls.includes(i.progressiveUrl)
      );
      if (dupeIndex !== -1) {
        if (mergeDuplicate) {
          const updated = [...existing];
          updated[dupeIndex] = mergeDuplicate(updated[dupeIndex], item);
          await setItems(tabId, updated);
          return updated;
        }
        return existing;
      }
      const updated = [...existing, item];
      await setItems(tabId, updated);
      return updated;
    });
  }

  function clearTab(tabId) {
    return withLock(tabId, async () => {
      await storageApi.remove(keyFor(tabId));
    });
  }

  // Applies patchFn to every stored item for a tab (e.g. a page-wide title
  // upgrade discovered after the item was first detected). patchFn returning
  // the same item reference unchanged is a safe no-op for items it doesn't
  // want to touch.
  function updateItems(tabId, patchFn) {
    return withLock(tabId, async () => {
      const existing = await getItems(tabId);
      const updated = existing.map(patchFn);
      await setItems(tabId, updated);
      return updated;
    });
  }

  return { getItems, addItem, clearTab, updateItems };
}

export function badgeTextFor(itemCount) {
  return itemCount > 0 ? String(itemCount) : '';
}
