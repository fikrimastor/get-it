import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaItem, createRendition, MEDIA_TYPE, SOURCE_KIND } from '../src/shared/media-item.js';

test('createMediaItem assigns a unique id per call', () => {
  const a = createMediaItem({ tabId: 1, sourceKind: SOURCE_KIND.PROGRESSIVE, mediaType: MEDIA_TYPE.VIDEO, pageUrl: 'https://a.test' });
  const b = createMediaItem({ tabId: 1, sourceKind: SOURCE_KIND.PROGRESSIVE, mediaType: MEDIA_TYPE.VIDEO, pageUrl: 'https://a.test' });
  assert.notEqual(a.id, b.id);
});

test('createMediaItem defaults optional fields', () => {
  const item = createMediaItem({ tabId: 5, sourceKind: SOURCE_KIND.HLS, mediaType: MEDIA_TYPE.VIDEO, pageUrl: 'https://a.test' });
  assert.equal(item.manifestUrl, null);
  assert.equal(item.progressiveUrl, null);
  assert.deepEqual(item.renditions, []);
  assert.equal(item.tabId, 5);
});

test('createRendition fills defaults for omitted fields', () => {
  const rendition = createRendition({ id: 'r1', label: '720p' });
  assert.equal(rendition.id, 'r1');
  assert.equal(rendition.label, '720p');
  assert.equal(rendition.container, 'fmp4');
  assert.deepEqual(rendition.videoSegmentUrls, []);
});
