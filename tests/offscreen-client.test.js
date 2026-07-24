// tests/offscreen-client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureOffscreenDocument } from '../src/background/offscreen-client.js';

function fakeApis({ existingContexts = [], createDelayMs = 0, rejectFirst = false } = {}) {
  const createCalls = [];
  let attempt = 0;
  const offscreenApi = {
    createDocument: async (params) => {
      createCalls.push(params);
      attempt += 1;
      if (createDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      if (rejectFirst && attempt === 1) throw new Error('offscreen creation blocked');
    },
  };
  const runtimeApi = {
    getURL: (path) => `chrome-extension://fake-id/${path}`,
    getContexts: async () => existingContexts,
  };
  return { offscreenApi, runtimeApi, createCalls };
}

test('ensureOffscreenDocument creates the document when none exists', async () => {
  const { offscreenApi, runtimeApi, createCalls } = fakeApis({ existingContexts: [] });
  await ensureOffscreenDocument(offscreenApi, runtimeApi);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].url, 'src/offscreen/offscreen.html');
  assert.deepEqual(createCalls[0].reasons, ['BLOBS']);
});

test('ensureOffscreenDocument does not create a document when one already exists', async () => {
  const { offscreenApi, runtimeApi, createCalls } = fakeApis({ existingContexts: [{}] });
  await ensureOffscreenDocument(offscreenApi, runtimeApi);
  assert.equal(createCalls.length, 0);
});

test('ensureOffscreenDocument serializes concurrent calls so createDocument is only invoked once', async () => {
  const { offscreenApi, runtimeApi, createCalls } = fakeApis({ existingContexts: [], createDelayMs: 20 });
  await Promise.all([
    ensureOffscreenDocument(offscreenApi, runtimeApi),
    ensureOffscreenDocument(offscreenApi, runtimeApi),
  ]);
  assert.equal(createCalls.length, 1);
});

test('ensureOffscreenDocument allows creating again after a prior creation finished', async () => {
  const { offscreenApi, runtimeApi, createCalls } = fakeApis({ existingContexts: [] });
  await ensureOffscreenDocument(offscreenApi, runtimeApi);
  await ensureOffscreenDocument(offscreenApi, runtimeApi);
  assert.equal(createCalls.length, 2);
});

test('ensureOffscreenDocument retries on the next call after a failed creation', async () => {
  const { offscreenApi, runtimeApi, createCalls } = fakeApis({ existingContexts: [], rejectFirst: true });
  await assert.rejects(() => ensureOffscreenDocument(offscreenApi, runtimeApi), /offscreen creation blocked/);
  await ensureOffscreenDocument(offscreenApi, runtimeApi);
  assert.equal(createCalls.length, 2);
});
