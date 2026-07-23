import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMerge,
  MERGE_STRATEGY,
  fetchSegments,
  mergeConcatFmp4,
  mergeTsWithTransmuxer,
} from '../src/background/merge-engine.js';
import { createRendition } from '../src/shared/media-item.js';

test('classifyMerge picks split-tracks when a separate audio track exists', () => {
  const rendition = createRendition({ audioSegmentUrls: ['https://a/1.m4s'] });
  assert.equal(classifyMerge(rendition), MERGE_STRATEGY.SPLIT_TRACKS);
});

test('classifyMerge picks remux-ts for legacy TS containers with no separate audio', () => {
  const rendition = createRendition({ container: 'ts' });
  assert.equal(classifyMerge(rendition), MERGE_STRATEGY.REMUX_TS);
});

test('classifyMerge picks concat-fmp4 for muxed CMAF segments', () => {
  const rendition = createRendition({ container: 'fmp4' });
  assert.equal(classifyMerge(rendition), MERGE_STRATEGY.CONCAT_FMP4);
});

test('fetchSegments fetches every url in order and returns array buffers', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
  };

  const buffers = await fetchSegments(['https://a/1', 'https://a/2'], fakeFetch);

  assert.deepEqual(calls, ['https://a/1', 'https://a/2']);
  assert.equal(buffers.length, 2);
});

test('fetchSegments throws when a segment response is not ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchSegments(['https://a/missing'], fakeFetch), /404/);
});

test('mergeConcatFmp4 concatenates the init segment then media segments in order', async () => {
  const rendition = createRendition({
    videoInitUrl: 'https://a/init.mp4',
    videoSegmentUrls: ['https://a/1.m4s', 'https://a/2.m4s'],
  });
  const bytesByUrl = {
    'https://a/init.mp4': [1],
    'https://a/1.m4s': [2],
    'https://a/2.m4s': [3],
  };
  const fakeFetch = async (url) => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array(bytesByUrl[url]).buffer,
  });

  const blob = await mergeConcatFmp4(rendition, fakeFetch);
  const buffer = await blob.arrayBuffer();

  assert.deepEqual(Array.from(new Uint8Array(buffer)), [1, 2, 3]);
});

test('mergeTsWithTransmuxer assembles the init segment and every data chunk from the transmuxer output', async () => {
  const pushedSegments = [];
  const fakeMuxjs = {
    mp4: {
      Transmuxer: class {
        constructor() {
          this.listeners = {};
        }
        on(event, handler) {
          this.listeners[event] = handler;
        }
        push(segment) {
          pushedSegments.push(segment);
        }
        flush() {
          this.listeners.data({ initSegment: new Uint8Array([9]), data: new Uint8Array([1]) });
          this.listeners.data({ data: new Uint8Array([2]) });
          this.listeners.done();
        }
      },
    },
  };

  const blob = await mergeTsWithTransmuxer([new ArrayBuffer(4), new ArrayBuffer(4)], fakeMuxjs);
  const buffer = await blob.arrayBuffer();

  assert.equal(pushedSegments.length, 2);
  assert.deepEqual(Array.from(new Uint8Array(buffer)), [9, 1, 2]);
});

test('mergeTsWithTransmuxer rejects when there are no segments to merge', async () => {
  await assert.rejects(() => mergeTsWithTransmuxer([], {}));
});
test('mergeTsWithTransmuxer rejects when the transmuxer emits an error event', async () => {
  const fakeMuxjs = {
    mp4: {
      Transmuxer: class {
        constructor() {
          this.listeners = {};
        }
        on(event, handler) {
          this.listeners[event] = handler;
        }
        push() {}
        flush() {
          this.listeners.error(new Error('corrupt segment'));
        }
      },
    },
  };
  await assert.rejects(() => mergeTsWithTransmuxer([new ArrayBuffer(4)], fakeMuxjs), /corrupt segment/);
});
