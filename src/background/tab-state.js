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

  async function addItem(tabId, item) {
    const existing = await getItems(tabId);
    const isDuplicate = existing.some(
      (i) => i.manifestUrl === item.manifestUrl && i.progressiveUrl === item.progressiveUrl
    );
    if (isDuplicate) return existing;
    const updated = [...existing, item];
    await setItems(tabId, updated);
    return updated;
  }

  async function clearTab(tabId) {
    await storageApi.remove(keyFor(tabId));
  }

  return { getItems, setItems, addItem, clearTab };
}

export function badgeTextFor(itemCount) {
  return itemCount > 0 ? String(itemCount) : '';
}
