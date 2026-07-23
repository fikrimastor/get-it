import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMPD } from '../src/background/dash-parser.js';

const BASE_URL = 'https://cdn.test/dash/manifest.mpd';

test('parseMPD builds a rendition per video Representation with the matching audio track', () => {
  const xml = `<?xml version="1.0"?>
<MPD mediaPresentationDuration="PT12.0S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="v0" bandwidth="2000000" width="1280" height="720">
        <SegmentTemplate media="v0-$Number$.m4s" initialization="v0-init.mp4" timescale="1" duration="6" startNumber="1" />
      </Representation>
      <Representation id="v1" bandwidth="800000" width="640" height="360">
        <SegmentTemplate media="v1-$Number$.m4s" initialization="v1-init.mp4" timescale="1" duration="6" startNumber="1" />
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="a0" bandwidth="128000">
        <SegmentTemplate media="a0-$Number$.m4s" initialization="a0-init.mp4" timescale="1" duration="6" startNumber="1" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  const renditions = parseMPD(xml, BASE_URL);

  assert.equal(renditions.length, 2);
  assert.equal(renditions[0].label, '720p');
  assert.equal(renditions[0].videoInitUrl, 'https://cdn.test/dash/v0-init.mp4');
  assert.deepEqual(renditions[0].videoSegmentUrls, [
    'https://cdn.test/dash/v0-1.m4s',
    'https://cdn.test/dash/v0-2.m4s',
  ]);
  assert.equal(renditions[0].audioInitUrl, 'https://cdn.test/dash/a0-init.mp4');
  assert.deepEqual(renditions[0].audioSegmentUrls, [
    'https://cdn.test/dash/a0-1.m4s',
    'https://cdn.test/dash/a0-2.m4s',
  ]);

  assert.equal(renditions[1].label, '360p');
});

test('parseMPD returns an empty list when there is no Period', () => {
  const xml = '<MPD mediaPresentationDuration="PT10.0S"></MPD>';
  assert.deepEqual(parseMPD(xml, BASE_URL), []);
});

test('parseMPD handles a video-only manifest with no audio AdaptationSet', () => {
  const xml = `<MPD mediaPresentationDuration="PT6.0S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="v0" bandwidth="500000" width="640" height="360">
        <SegmentTemplate media="v0-$Number$.m4s" initialization="v0-init.mp4" timescale="1" duration="6" startNumber="1" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  const renditions = parseMPD(xml, BASE_URL);
  assert.equal(renditions.length, 1);
  assert.equal(renditions[0].audioSegmentUrls.length, 0);
  assert.equal(renditions[0].audioInitUrl, null);
});
