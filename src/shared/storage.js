// src/shared/storage.js

export const DEFAULT_SETTINGS = Object.freeze({
  subfolder: 'GetIt',
  filenameTemplate: '{title}-{quality}.{ext}',
  askWhereToSave: false,
  theme: 'system',
  blacklist: [],
  maxConcurrentDownloads: 3,
});

export async function getSettings(storageApi = chrome.storage.sync) {
  const stored = await storageApi.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(partial, storageApi = chrome.storage.sync) {
  await storageApi.set(partial);
}

export function isBlacklisted(hostname, settings) {
  if (!hostname || !settings || !Array.isArray(settings.blacklist)) return false;
  return settings.blacklist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    const host = hostname.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}
