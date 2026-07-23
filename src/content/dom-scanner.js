// src/content/dom-scanner.js
// Classic (non-module) content script. Scans the DOM for <video>/<audio>
// elements with a plain (non-blob) source and reports them to the
// background service worker for metadata enrichment. This is secondary to
// background/request-sniffer.js's network-level detection — see the
// Global Constraints note on why network sniffing is primary.

(function () {
  function collectFromElement(el) {
    const items = [];
    const tag = el.tagName.toLowerCase();
    const mediaType = tag === 'audio' ? 'audio' : 'video';

    const candidateUrls = new Set();
    if (el.currentSrc) candidateUrls.add(el.currentSrc);
    if (el.src) candidateUrls.add(el.src);
    el.querySelectorAll('source[src]').forEach((s) => candidateUrls.add(s.src));

    for (const url of candidateUrls) {
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
      items.push({
        mediaType,
        url,
        title: document.title,
        pageUrl: location.href,
        posterUrl: tag === 'video' ? el.poster || null : null,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      });
    }
    return items;
  }

  function scan() {
    const items = [];
    document.querySelectorAll('video, audio').forEach((el) => {
      items.push(...collectFromElement(el));
    });
    if (items.length > 0) {
      chrome.runtime.sendMessage({ type: 'DOM_SCAN_RESULT', payload: { items } });
    }
  }

  scan();

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('loadedmetadata', scan, true);
})();
