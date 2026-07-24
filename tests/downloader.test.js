// tests/downloader.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilenameSegment, renderFilename, buildDownloadPath, createObjectUrl, downloadUrl } from '../src/background/downloader.js';

test('sanitizeFilenameSegment strips characters illegal in filenames', () => {
  assert.equal(sanitizeFilenameSegment('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i');
});

test('sanitizeFilenameSegment trims and caps length', () => {
  const long = 'x'.repeat(200);
  assert.equal(sanitizeFilenameSegment(long).length, 120);
});

test('renderFilename substitutes all placeholders', () => {
  const name = renderFilename('{title}-{quality}.{ext}', { title: 'My Video', quality: '720p', ext: 'mp4' });
  assert.equal(name, 'My Video-720p.mp4');
});

test('renderFilename falls back to defaults for missing fields', () => {
  const name = renderFilename('{title}.{ext}', {});
  assert.equal(name, 'video.mp4');
});

test('renderFilename collapses a blank quality segment without leaving a stray dash (the progressive-download case)', () => {
  const name = renderFilename('{title}-{quality}.{ext}', { title: 'My Video', quality: '', ext: 'mp4' });
  assert.equal(name, 'My Video.mp4');
});

test('buildDownloadPath joins subfolder and filename', () => {
  assert.equal(buildDownloadPath('GetIt', 'clip.mp4'), 'GetIt/clip.mp4');
});

test('buildDownloadPath omits the subfolder segment when blank', () => {
  assert.equal(buildDownloadPath('', 'clip.mp4'), 'clip.mp4');
});

test('createObjectUrl returns a blob object URL and schedules it to be revoked', async () => {
  const url = createObjectUrl(new Blob(['x']), 50);
  assert.match(url, /^blob:/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(() => fetch(url));
});

test('downloadUrl calls the injected downloads API with the given url', async () => {
  const calls = [];
  const fakeDownloadsApi = {
    download: async (options) => { calls.push(options); return 7; },
  };
  const id = await downloadUrl('https://a/video.mp4', 'GetIt/video.mp4', fakeDownloadsApi, true);
  assert.equal(id, 7);
  assert.deepEqual(calls[0], { url: 'https://a/video.mp4', filename: 'GetIt/video.mp4', saveAs: true });
});
