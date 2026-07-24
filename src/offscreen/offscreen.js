// src/offscreen/offscreen.js
//
// Runs inside the hidden offscreen document (see offscreen-client.js). This
// is a real page/module context, so unlike the service worker it has a
// window/DOM (URL.createObjectURL works here) and no restriction on dynamic
// import() (mux.js's UMD build can load normally -- see the module-load
// comment below).
import '../../vendor/mux.js';
import { classifyMerge, mergeConcatFmp4, mergeRemuxTs, mergeSplitTracks, MERGE_STRATEGY } from '../background/merge-engine.js';
import { createObjectUrl } from '../background/downloader.js';
import { MSG_TYPE, onMessage } from '../shared/messaging.js';

onMessage(MSG_TYPE.MERGE_TO_OBJECT_URL, async ({ rendition }) => {
  const strategy = classifyMerge(rendition);

  if (strategy === MERGE_STRATEGY.CONCAT_FMP4) {
    const blob = await mergeConcatFmp4(rendition, fetch);
    return { ok: true, urls: { video: createObjectUrl(blob) } };
  }

  if (strategy === MERGE_STRATEGY.REMUX_TS) {
    const blob = await mergeRemuxTs(rendition, fetch, globalThis.muxjs);
    return { ok: true, urls: { video: createObjectUrl(blob) } };
  }

  if (strategy === MERGE_STRATEGY.SPLIT_TRACKS) {
    const { videoBlob, audioBlob } = await mergeSplitTracks(rendition, fetch);
    return { ok: true, urls: { video: createObjectUrl(videoBlob), audio: createObjectUrl(audioBlob) } };
  }

  return { ok: false, error: 'Unknown merge strategy' };
});
