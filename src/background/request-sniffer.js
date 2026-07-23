const MEDIA_EXTENSIONS = /\.(mp4|webm|m3u8|mpd|m4s|ts|mp3|m4a|ogg|weba)(\?|$)/i;
const MEDIA_SEGMENT_EXTENSIONS = /\.(m4s|ts)(\?|$)/i;
const MEDIA_CONTENT_TYPES = /^(video\/|audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/dash\+xml)/i;

export function classifyRequest(url, contentType) {
  // Checked unconditionally, before content-type: real CDNs commonly serve
  // .ts/.m4s segments with a genuine video/* or audio/* content-type, so a
  // content-type-first check would misclassify every segment of every
  // HLS/DASH stream as a standalone progressive item. Segments only matter
  // once found via their parent manifest.
  if (MEDIA_SEGMENT_EXTENSIONS.test(url)) {
    return null;
  }
  if (contentType && MEDIA_CONTENT_TYPES.test(contentType)) {
    if (/mpegurl/i.test(contentType)) return { kind: 'hls', url };
    if (/dash\+xml/i.test(contentType)) return { kind: 'dash', url };
    if (/^audio\//i.test(contentType)) return { kind: 'progressive-audio', url };
    return { kind: 'progressive-video', url };
  }
  if (MEDIA_EXTENSIONS.test(url)) {
    if (/\.m3u8(\?|$)/i.test(url)) return { kind: 'hls', url };
    if (/\.mpd(\?|$)/i.test(url)) return { kind: 'dash', url };
    if (/\.(mp3|m4a|ogg|weba)(\?|$)/i.test(url)) return { kind: 'progressive-audio', url };
    return { kind: 'progressive-video', url };
  }
  return null;
}

export function registerRequestSniffer(webRequestApi, onCandidate) {
  webRequestApi.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0) return;
      const contentTypeHeader = (details.responseHeaders || []).find(
        (h) => h.name.toLowerCase() === 'content-type'
      );
      const classification = classifyRequest(details.url, contentTypeHeader ? contentTypeHeader.value : null);
      if (classification) {
        onCandidate(details.tabId, classification);
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}
