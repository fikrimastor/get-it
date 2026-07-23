import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest, registerRequestSniffer } from '../src/background/request-sniffer.js';

test('classifyRequest detects HLS manifests by content-type', () => {
  assert.deepEqual(
    classifyRequest('https://a/stream', 'application/vnd.apple.mpegurl'),
    { kind: 'hls', url: 'https://a/stream' }
  );
});

test('classifyRequest detects HLS manifests by .m3u8 extension when content-type is missing', () => {
  assert.deepEqual(
    classifyRequest('https://a/stream.m3u8?token=abc', null),
    { kind: 'hls', url: 'https://a/stream.m3u8?token=abc' }
  );
});

test('classifyRequest detects DASH manifests by content-type', () => {
  assert.deepEqual(
    classifyRequest('https://a/stream.mpd', 'application/dash+xml'),
    { kind: 'dash', url: 'https://a/stream.mpd' }
  );
});

test('classifyRequest detects progressive video by content-type', () => {
  assert.deepEqual(
    classifyRequest('https://a/clip', 'video/mp4'),
    { kind: 'progressive-video', url: 'https://a/clip' }
  );
});

test('classifyRequest detects progressive audio by extension', () => {
  assert.deepEqual(
    classifyRequest('https://a/track.mp3', null),
    { kind: 'progressive-audio', url: 'https://a/track.mp3' }
  );
});

test('classifyRequest ignores standalone segment files (.ts/.m4s) with no manifest context', () => {
  assert.equal(classifyRequest('https://a/seg-1.ts', null), null);
  assert.equal(classifyRequest('https://a/seg-1.m4s', null), null);
});

test('classifyRequest ignores segments even when served with a real video/audio content-type', () => {
  assert.equal(classifyRequest('https://a/seg-1.ts', 'video/mp2t'), null);
  assert.equal(classifyRequest('https://a/seg-1.m4s', 'video/mp4'), null);
  assert.equal(classifyRequest('https://a/seg-1.m4s', 'audio/mp4'), null);
});

test('classifyRequest ignores unrelated requests', () => {
  assert.equal(classifyRequest('https://a/page.html', 'text/html'), null);
});

test('registerRequestSniffer wires onHeadersReceived and forwards classified candidates', () => {
  let registeredListener = null;
  const fakeWebRequestApi = {
    onHeadersReceived: {
      addListener: (listener) => { registeredListener = listener; },
    },
  };
  const candidates = [];

  registerRequestSniffer(fakeWebRequestApi, (tabId, candidate) => candidates.push({ tabId, candidate }));

  registeredListener({
    tabId: 3,
    url: 'https://a/clip.mp4',
    responseHeaders: [{ name: 'Content-Type', value: 'video/mp4' }],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tabId, 3);
  assert.equal(candidates[0].candidate.kind, 'progressive-video');
});

test('registerRequestSniffer ignores requests with no associated tab (tabId < 0)', () => {
  let registeredListener = null;
  const fakeWebRequestApi = { onHeadersReceived: { addListener: (l) => { registeredListener = l; } } };
  const candidates = [];
  registerRequestSniffer(fakeWebRequestApi, (tabId, c) => candidates.push(c));
  registeredListener({ tabId: -1, url: 'https://a/clip.mp4', responseHeaders: [] });
  assert.equal(candidates.length, 0);
});
