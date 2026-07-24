// src/background/offscreen-client.js
//
// Manages the single offscreen document used to create blob: object URLs
// (URL.createObjectURL is unavailable in the extension service worker --
// see the note in downloader.js). An extension may have at most one
// offscreen document open at a time, and several downloads can be racing
// concurrently (see concurrency-limiter.js, up to 10 at once), so creation
// is guarded by a shared in-flight promise to avoid
// "Only a single offscreen document may be created" errors.

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

let creating = null;

export async function ensureOffscreenDocument(offscreenApi = chrome.offscreen, runtimeApi = chrome.runtime) {
  const offscreenUrl = runtimeApi.getURL(OFFSCREEN_URL);
  // chrome.runtime.getContexts() requires Chrome 116+; every target this
  // extension supports (Chrome/Brave/Edge, MV3) is well past that baseline.
  const existingContexts = await runtimeApi.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  creating = offscreenApi.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['BLOBS'],
    justification: 'Merge HLS/DASH segments into a Blob and create an object URL for chrome.downloads.',
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}
