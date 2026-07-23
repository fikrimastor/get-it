import { classifyRequest, registerRequestSniffer } from './request-sniffer.js';
import { parseM3U8 } from './hls-parser.js';
import { parseMPD } from './dash-parser.js';
import { createTabStateStore, badgeTextFor } from './tab-state.js';
import { createMediaItem, createRendition, MEDIA_TYPE, SOURCE_KIND } from '../shared/media-item.js';
import { classifyMerge, mergeConcatFmp4, mergeRemuxTs, mergeSplitTracks, MERGE_STRATEGY } from './merge-engine.js';
import { renderFilename, buildDownloadPath, downloadBlob, downloadUrl } from './downloader.js';
import { getSettings, isBlacklisted } from '../shared/storage.js';
import { MSG_TYPE, onMessage } from '../shared/messaging.js';
import { registerContextMenu } from './context-menu.js';

// mux.js's UMD build reads `window` for feature detection; service workers
// have no `window` global, so alias it to globalThis before loading.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

let muxjsInstance = null;
async function loadMuxJs() {
  if (muxjsInstance) return muxjsInstance;
  await import('../../vendor/mux.js');
  muxjsInstance = globalThis.muxjs;
  return muxjsInstance;
}

const tabState = createTabStateStore();

function updateBadge(tabId) {
  const items = tabState.getItems(tabId);
  chrome.action.setBadgeText({ tabId, text: badgeTextFor(items.length) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#4F46E5' });
}

async function handleCandidate(tabId, candidate) {
  const settings = await getSettings();
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!tab.url) return;
  const hostname = new URL(tab.url).hostname;
  if (isBlacklisted(hostname, settings)) return;

  if (candidate.kind === 'progressive-video' || candidate.kind === 'progressive-audio') {
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: candidate.kind === 'progressive-audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl: tab.url,
      progressiveUrl: candidate.url,
      title: tab.title,
    });
    tabState.addItem(tabId, item);
    updateBadge(tabId);
    return;
  }

  if (candidate.kind === 'hls') {
    try {
      const text = await (await fetch(candidate.url)).text();
      const renditions = (await parseM3U8(text, candidate.url)).map(createRendition);
      const item = createMediaItem({
        tabId,
        sourceKind: SOURCE_KIND.HLS,
        mediaType: MEDIA_TYPE.VIDEO,
        pageUrl: tab.url,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      tabState.addItem(tabId, item);
      updateBadge(tabId);
    } catch (err) {
      console.warn('Get It: failed to parse HLS manifest', candidate.url, err);
    }
    return;
  }

  if (candidate.kind === 'dash') {
    try {
      const text = await (await fetch(candidate.url)).text();
      const renditions = parseMPD(text, candidate.url).map(createRendition);
      const item = createMediaItem({
        tabId,
        sourceKind: SOURCE_KIND.DASH,
        mediaType: MEDIA_TYPE.VIDEO,
        pageUrl: tab.url,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      tabState.addItem(tabId, item);
      updateBadge(tabId);
    } catch (err) {
      console.warn('Get It: failed to parse DASH manifest', candidate.url, err);
    }
  }
}

registerRequestSniffer(chrome.webRequest, handleCandidate);

chrome.tabs.onRemoved.addListener((tabId) => tabState.clearTab(tabId));
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    tabState.clearTab(details.tabId);
    updateBadge(details.tabId);
  }
});

onMessage(MSG_TYPE.DOM_SCAN_RESULT, async ({ tabId, items: domItems }) => {
  for (const domItem of domItems) {
    if (!domItem.url || domItem.url.startsWith('blob:')) continue;
    const existing = tabState.getItems(tabId).find(
      (i) => i.progressiveUrl === domItem.url || i.manifestUrl === domItem.url
    );
    if (existing) {
      existing.title = existing.title || domItem.title;
      existing.posterUrl = existing.posterUrl || domItem.posterUrl;
      continue;
    }
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: domItem.mediaType === 'audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl: domItem.pageUrl,
      progressiveUrl: domItem.url,
      title: domItem.title,
      posterUrl: domItem.posterUrl,
    });
    tabState.addItem(tabId, item);
  }
  updateBadge(tabId);
  return { ok: true };
});

onMessage(MSG_TYPE.GET_TAB_ITEMS, async ({ tabId }) => {
  return { items: tabState.getItems(tabId) };
});

onMessage(MSG_TYPE.START_DOWNLOAD, async ({ itemId, tabId, renditionId }) => {
  const settings = await getSettings();
  const items = tabState.getItems(tabId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Item not found' };

  try {
    if (item.sourceKind === SOURCE_KIND.PROGRESSIVE) {
      const ext = (item.progressiveUrl.split('.').pop() || 'mp4').split('?')[0];
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: '', ext });
      await downloadUrl(item.progressiveUrl, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    const rendition = item.renditions.find((r) => r.id === renditionId) || item.renditions[0];
    const strategy = classifyMerge(rendition);

    if (strategy === MERGE_STRATEGY.CONCAT_FMP4) {
      const blob = await mergeConcatFmp4(rendition, fetch);
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: rendition.label, ext: 'mp4' });
      await downloadBlob(blob, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    if (strategy === MERGE_STRATEGY.REMUX_TS) {
      const muxjs = await loadMuxJs();
      const blob = await mergeRemuxTs(rendition, fetch, muxjs);
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: rendition.label, ext: 'mp4' });
      await downloadBlob(blob, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    if (strategy === MERGE_STRATEGY.SPLIT_TRACKS) {
      const { videoBlob, audioBlob } = await mergeSplitTracks(rendition, fetch);
      const videoFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-video`, ext: 'mp4' });
      const audioFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-audio`, ext: 'm4a' });
      await downloadBlob(videoBlob, buildDownloadPath(settings.subfolder, videoFilename), chrome.downloads, settings.askWhereToSave);
      await downloadBlob(audioBlob, buildDownloadPath(settings.subfolder, audioFilename), chrome.downloads, settings.askWhereToSave);
      return { ok: true, note: 'Downloaded as separate video and audio files (split adaptive tracks — see Global Constraints).' };
    }

    return { ok: false, error: 'Unknown merge strategy' };
  } catch (err) {
    console.error('Get It: download failed', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

registerContextMenu(chrome.contextMenus, chrome.tabs);
