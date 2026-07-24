// src/content/dom-scanner.js
// Classic (non-module) content script. Scans the DOM for <video>/<audio>
// elements with a plain (non-blob) source and reports them to the
// background service worker for metadata enrichment. This is secondary to
// background/request-sniffer.js's network-level detection — see the
// Global Constraints note on why network sniffing is primary.

(function () {
  // Generic (not per-site) title signals, most specific first: the video
  // element's own title/aria-label, then the page's OpenGraph/Twitter
  // title meta tags (widely used across video-hosting sites to name their
  // content independent of the browser tab's <title>, which often also
  // carries site branding, e.g. "My Cat Video | SiteName"). Falls back to
  // document.title only when nothing more specific is found.
  function pageMetaTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();
    const twitter = document.querySelector('meta[name="twitter:title"]');
    if (twitter && twitter.content && twitter.content.trim()) return twitter.content.trim();
    return null;
  }

  function collectFromElement(el) {
    const items = [];
    const tag = el.tagName.toLowerCase();
    const mediaType = tag === 'audio' ? 'audio' : 'video';
    const elementTitle = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();

    const candidateUrls = new Set();
    if (el.currentSrc) candidateUrls.add(el.currentSrc);
    if (el.src) candidateUrls.add(el.src);
    el.querySelectorAll('source[src]').forEach((s) => candidateUrls.add(s.src));

    for (const url of candidateUrls) {
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
      items.push({
        mediaType,
        url,
        title: elementTitle || pageMetaTitle() || document.title,
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
    // Sent even with zero DOM-matched items whenever a page-level meta
    // title exists: it also enriches media detected purely via network
    // sniffing (e.g. blob-backed players with no plain <video src> for
    // this scanner to find at all -- see the Detection limitation note in
    // the design doc), which otherwise never gets a title better than the
    // raw tab title.
    const meta = pageMetaTitle();
    if (items.length > 0 || meta) {
      chrome.runtime.sendMessage({ type: 'DOM_SCAN_RESULT', payload: { items, pageTitle: meta } });
    }
  }

  scan();

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('loadedmetadata', scan, true);
})();
