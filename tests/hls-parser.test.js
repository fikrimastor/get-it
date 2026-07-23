import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U8 } from '../src/background/hls-parser.js';

const BASE_URL = 'https://cdn.test/videos/';

test('parseM3U8 parses a plain media playlist (fMP4/CMAF segments)', async () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:6.0,',
    'seg-0.m4s',
    '#EXTINF:6.0,',
    'seg-1.m4s',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const renditions = await parseM3U8(text, BASE_URL);

  assert.equal(renditions.length, 1);
  assert.equal(renditions[0].container, 'fmp4');
  assert.equal(renditions[0].videoInitUrl, 'https://cdn.test/videos/init.mp4');
  assert.deepEqual(renditions[0].videoSegmentUrls, [
    'https://cdn.test/videos/seg-0.m4s',
    'https://cdn.test/videos/seg-1.m4s',
  ]);
});

test('parseM3U8 parses a plain media playlist with legacy TS segments (no EXT-X-MAP)', async () => {
  const text = ['#EXTM3U', '#EXTINF:10.0,', 'seg-0.ts', '#EXTINF:10.0,', 'seg-1.ts', '#EXT-X-ENDLIST'].join('\n');

  const renditions = await parseM3U8(text, BASE_URL);

  assert.equal(renditions[0].container, 'ts');
  assert.equal(renditions[0].videoInitUrl, null);
  assert.equal(renditions[0].videoSegmentUrls.length, 2);
});

test('parseM3U8 resolves a master playlist by fetching each variant', async () => {
  const masterText = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
    '720p.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    '360p.m3u8',
  ].join('\n');

  const variantPlaylists = {
    'https://cdn.test/videos/720p.m3u8': ['#EXTM3U', '#EXTINF:6.0,', 'a.ts', '#EXT-X-ENDLIST'].join('\n'),
    'https://cdn.test/videos/360p.m3u8': ['#EXTM3U', '#EXTINF:6.0,', 'b.ts', '#EXT-X-ENDLIST'].join('\n'),
  };

  const fakeFetch = async (url) => ({
    text: async () => variantPlaylists[url],
  });

  const renditions = await parseM3U8(masterText, BASE_URL, fakeFetch);

  assert.equal(renditions.length, 2);
  assert.equal(renditions[0].label, '720p');
  assert.equal(renditions[0].width, 1280);
  assert.equal(renditions[0].height, 720);
  assert.equal(renditions[1].label, '360p');
});
