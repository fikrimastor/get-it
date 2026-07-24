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

// URL.createObjectURL()/revokeObjectURL() are unavailable in the extension
// service worker (a real, permanent Chromium restriction, not a version
// gate -- see https://issues.chromium.org/issues/40876652). This function
// is only ever called from the offscreen document (src/offscreen/offscreen.js),
// which has a real DOM/window and can create object URLs; the resulting
// blob: URL string is then handed to downloadUrl() below, which the
// service worker calls with chrome.downloads (offscreen documents cannot
// call chrome.downloads themselves -- only chrome.runtime is exposed to
// them). Node's test runner also implements URL.createObjectURL, so this
// is directly unit-testable without a browser.
export function createObjectUrl(blob, revokeDelayMs = 30000) {
  const url = URL.createObjectURL(blob);
  // chrome.downloads.download() reads the blob URL asynchronously;
  // revoking immediately can race that read, so revoke after a delay.
  // .unref() (Node-only) keeps this timer from blocking process exit in
  // tests; browser timer ids have no .unref, so the guard is a safe no-op.
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
  if (typeof revokeTimer.unref === 'function') revokeTimer.unref();
  return url;
}

export async function downloadUrl(url, path, downloadsApi = chrome.downloads, saveAs = false) {
  return downloadsApi.download({ url, filename: path, saveAs });
}
