// src/background/downloader.js

export function sanitizeFilenameSegment(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function renderFilename(template, { title, quality, ext } = {}) {
  const safeTitle = sanitizeFilenameSegment(title || 'video');
  const safeQuality = sanitizeFilenameSegment(quality || '');
  const safeExt = sanitizeFilenameSegment(ext || 'mp4');
  return template
    .replace(/\{title\}/g, safeTitle)
    .replace(/\{quality\}/g, safeQuality)
    .replace(/\{ext\}/g, safeExt)
    .replace(/-+/g, '-')
    .replace(/^-|-(?=\.)/g, '');
}

export function buildDownloadPath(subfolder, filename) {
  const safeSubfolder = sanitizeFilenameSegment(subfolder || '');
  return safeSubfolder ? `${safeSubfolder}/${filename}` : filename;
}

export async function downloadBlob(blob, path, downloadsApi = chrome.downloads, saveAs = false) {
  const url = URL.createObjectURL(blob);
  try {
    return await downloadsApi.download({ url, filename: path, saveAs });
  } finally {
    // chrome.downloads.download() reads the blob URL asynchronously;
    // revoking immediately can race that read, so revoke after a delay.
    // .unref() (Node-only) keeps this timer from blocking process exit in
    // tests; browser/service-worker timer ids have no .unref, so the guard
    // is a safe no-op there.
    const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (typeof revokeTimer.unref === 'function') revokeTimer.unref();
  }
}

export async function downloadUrl(url, path, downloadsApi = chrome.downloads, saveAs = false) {
  return downloadsApi.download({ url, filename: path, saveAs });
}
