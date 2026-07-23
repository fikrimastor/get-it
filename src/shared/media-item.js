export const MEDIA_TYPE = Object.freeze({
  VIDEO: 'video',
  AUDIO: 'audio',
});

export const SOURCE_KIND = Object.freeze({
  PROGRESSIVE: 'progressive',
  HLS: 'hls',
  DASH: 'dash',
});

let nextId = 1;

export function createMediaItem({
  tabId,
  sourceKind,
  mediaType,
  pageUrl,
  manifestUrl = null,
  progressiveUrl = null,
  title = null,
  posterUrl = null,
  renditions = [],
}) {
  return {
    id: `${tabId}-${nextId++}`,
    tabId,
    sourceKind,
    mediaType,
    pageUrl,
    manifestUrl,
    progressiveUrl,
    title,
    posterUrl,
    renditions,
    createdAt: Date.now(),
  };
}

const RENDITION_DEFAULTS = {
  id: 'default',
  label: 'Default',
  bandwidth: 0,
  width: 0,
  height: 0,
  container: 'fmp4',
  videoInitUrl: null,
  videoSegmentUrls: [],
  audioInitUrl: null,
  audioSegmentUrls: [],
};

export function createRendition(overrides = {}) {
  return { ...RENDITION_DEFAULTS, ...overrides };
}
