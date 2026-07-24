import { classifyRequest, registerRequestSniffer } from './request-sniffer.js';
import { parseM3U8 } from './hls-parser.js';
import { parseMPD } from './dash-parser.js';
import { createTabStateStore, badgeTextFor } from './tab-state.js';
import { createMediaItem, createRendition, MEDIA_TYPE, SOURCE_KIND } from '../shared/media-item.js';
import { classifyMerge, MERGE_STRATEGY } from './merge-engine.js';
import { renderFilename, buildDownloadPath, downloadUrl } from './downloader.js';
import { getSettings, isBlacklisted } from '../shared/storage.js';
import { MSG_TYPE, onMessage } from '../shared/messaging.js';
import { createConcurrencyLimiter } from './concurrency-limiter.js';
import { registerContextMenu } from './context-menu.js';
import { ensureOffscreenDocument } from './offscreen-client.js';

// Merging HLS/DASH segments into a Blob and creating a blob: object URL
// happens in the offscreen document (src/offscreen/offscreen.js), not here:
// URL.createObjectURL() is unavailable in the service worker, and mux.js
// (used for legacy MPEG-TS remuxing) can only be loaded there too, since
// dynamic import() is disallowed in ServiceWorkerGlobalScope -- see the
// comments in downloader.js and offscreen.js for the full rationale.

// Backed by chrome.storage.session (see tab-state.js) so detected items
// survive the service worker being torn down and restarted between
// detection time and whenever the user actually opens the popup.

// Shared concurrency limiter for all download operations.
const downloadLimiter = createConcurrencyLimiter();
const tabState = createTabStateStore();

async function updateBadge(tabId) {
  const items = await tabState.getItems(tabId);
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
  // Blacklist is checked against BOTH the tab's currently-committed
  // hostname and the candidate resource's own hostname. Neither signal is
  // reliable alone: chrome.tabs.get(tabId).url can still reflect the
  // PREVIOUS page while a navigation is in flight (a direct navigation to a
  // raw media URL fires the media-typed request that triggers detection
  // before the tab's url property updates), and the resource's own
  // hostname is wrong to use alone for embedded media hosted on a
  // different CDN domain than the page the user actually meant to
  // blacklist. Checking both correctly covers a blacklisted page embedding
  // third-party media, a direct navigation straight to a blacklisted
  // media host, and everything in between.
  const candidateHostname = new URL(candidate.url).hostname;
  const tabHostname = tab.url ? new URL(tab.url).hostname : null;
  if (isBlacklisted(candidateHostname, settings) || (tabHostname && isBlacklisted(tabHostname, settings))) {
    return;
  }
  const pageUrl = tab.url || candidate.url;

  if (candidate.kind === 'progressive-video' || candidate.kind === 'progressive-audio') {
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: candidate.kind === 'progressive-audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl,
      progressiveUrl: candidate.url,
      title: tab.title,
    });
    await tabState.addItem(tabId, item);
    await updateBadge(tabId);
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
        pageUrl,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      await tabState.addItem(tabId, item);
      await updateBadge(tabId);
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
        pageUrl,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      await tabState.addItem(tabId, item);
      await updateBadge(tabId);
    } catch (err) {
      console.warn('Get It: failed to parse DASH manifest', candidate.url, err);
    }
  }
}

registerRequestSniffer(chrome.webRequest, handleCandidate);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await tabState.clearTab(tabId);
});
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) {
    await tabState.clearTab(details.tabId);
    await updateBadge(details.tabId);
  }
});

onMessage(MSG_TYPE.DOM_SCAN_RESULT, async ({ items: domItems }, sender) => {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId == null) return { ok: false, error: 'DOM_SCAN_RESULT requires a content-script sender with a tab' };
  const settings = await getSettings();
  const senderHostname = sender.tab.url ? new URL(sender.tab.url).hostname : null;
  if (senderHostname && isBlacklisted(senderHostname, settings)) {
    return { ok: true, skipped: 'blacklisted' };
  }
  for (const domItem of domItems) {
    if (!domItem.url || domItem.url.startsWith('blob:')) continue;
    // Checked against the item's OWN hostname too, symmetric with
    // handleCandidate's dual check: a page might not itself be blacklisted
    // while embedding third-party media from a domain the user did
    // blacklist, and the DOM scanner's independent detection path must
    // honor that the same way the network-sniffing path does.
    const domItemHostname = new URL(domItem.url).hostname;
    if (isBlacklisted(domItemHostname, settings)) continue;
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: domItem.mediaType === 'audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl: domItem.pageUrl,
      progressiveUrl: domItem.url,
      title: domItem.title,
      posterUrl: domItem.posterUrl,
    });
    await tabState.addItem(tabId, item, (existing) => ({
      ...existing,
      title: existing.title || domItem.title,
      posterUrl: existing.posterUrl || domItem.posterUrl,
    }));
  }
  await updateBadge(tabId);
  return { ok: true };
});

onMessage(MSG_TYPE.GET_TAB_ITEMS, async ({ tabId }) => {
  return { items: await tabState.getItems(tabId) };
});

onMessage(MSG_TYPE.START_DOWNLOAD, async ({ itemId, tabId, renditionId }) => {
  const settings = await getSettings();
  const items = await tabState.getItems(tabId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Item not found' };

  return downloadLimiter.run(async () => {
    try {
      if (item.sourceKind === SOURCE_KIND.PROGRESSIVE) {
        const ext = (item.progressiveUrl.split('.').pop() || 'mp4').split('?')[0];
        const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: '', ext });
        await downloadUrl(item.progressiveUrl, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
        return { ok: true };
      }

      const rendition = item.renditions.find((r) => r.id === renditionId) || item.renditions[0];
      const strategy = classifyMerge(rendition);

      if (strategy === MERGE_STRATEGY.CONCAT_FMP4 || strategy === MERGE_STRATEGY.REMUX_TS) {
        await ensureOffscreenDocument();
        const merged = await chrome.runtime.sendMessage({ type: MSG_TYPE.MERGE_TO_OBJECT_URL, payload: { rendition } });
        if (!merged || !merged.ok) return { ok: false, error: (merged && merged.error) || 'Merge failed' };
        const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: rendition.label, ext: 'mp4' });
        await downloadUrl(merged.urls.video, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
        return { ok: true };
      }

      if (strategy === MERGE_STRATEGY.SPLIT_TRACKS) {
        await ensureOffscreenDocument();
        const merged = await chrome.runtime.sendMessage({ type: MSG_TYPE.MERGE_TO_OBJECT_URL, payload: { rendition } });
        if (!merged || !merged.ok) return { ok: false, error: (merged && merged.error) || 'Merge failed' };
        const videoFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-video`, ext: 'mp4' });
        const audioFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-audio`, ext: 'm4a' });
        await downloadUrl(merged.urls.video, buildDownloadPath(settings.subfolder, videoFilename), chrome.downloads, settings.askWhereToSave);
        await downloadUrl(merged.urls.audio, buildDownloadPath(settings.subfolder, audioFilename), chrome.downloads, settings.askWhereToSave);
        return { ok: true, note: 'Downloaded as separate video and audio files (split adaptive tracks — see Global Constraints).' };
      }

      return { ok: false, error: 'Unknown merge strategy' };
    } catch (err) {
      console.error('Get It: download failed', err);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }, settings.maxConcurrentDownloads ?? 3);
});

registerContextMenu(chrome.contextMenus, chrome.tabs);
