export function createTabStateStore() {
  const itemsByTab = new Map();

  function getItems(tabId) {
    return itemsByTab.get(tabId) || [];
  }

  function addItem(tabId, item) {
    const existing = itemsByTab.get(tabId) || [];
    const isDuplicate = existing.some(
      (i) => i.manifestUrl === item.manifestUrl && i.progressiveUrl === item.progressiveUrl
    );
    if (isDuplicate) return existing;
    const updated = [...existing, item];
    itemsByTab.set(tabId, updated);
    return updated;
  }

  function clearTab(tabId) {
    itemsByTab.delete(tabId);
  }

  return { getItems, addItem, clearTab };
}

export function badgeTextFor(itemCount) {
  return itemCount > 0 ? String(itemCount) : '';
}
