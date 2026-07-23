// tests/messaging.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MSG_TYPE, onMessage } from '../src/shared/messaging.js';

function fakeRuntime() {
  let registered = null;
  return {
    onMessage: { addListener: (fn) => { registered = fn; } },
    trigger: (message, sender) => new Promise((resolve) => {
      const keepChannelOpen = registered(message, sender, resolve);
      if (!keepChannelOpen) {
        resolve(undefined);
      }
    }),
  };
}

test('onMessage ignores messages of a different type', async () => {
  const runtime = fakeRuntime();
  let called = false;
  onMessage(MSG_TYPE.GET_TAB_ITEMS, async () => { called = true; return {}; }, runtime);
  const result = await runtime.trigger({ type: 'SOMETHING_ELSE', payload: {} }, {});
  assert.equal(called, false);
  assert.equal(result, undefined);
});

test('onMessage derives tabId from sender.tab when present (content script messages)', async () => {
  const runtime = fakeRuntime();
  let receivedPayload = null;
  onMessage(MSG_TYPE.DOM_SCAN_RESULT, async (payload) => { receivedPayload = payload; return { ok: true }; }, runtime);
  await runtime.trigger({ type: MSG_TYPE.DOM_SCAN_RESULT, payload: { items: [] } }, { tab: { id: 9 } });
  assert.equal(receivedPayload.tabId, 9);
});

test('onMessage falls back to payload.tabId when sender has no tab (popup messages)', async () => {
  const runtime = fakeRuntime();
  let receivedPayload = null;
  onMessage(MSG_TYPE.GET_TAB_ITEMS, async (payload) => { receivedPayload = payload; return { items: [] }; }, runtime);
  await runtime.trigger({ type: MSG_TYPE.GET_TAB_ITEMS, payload: { tabId: 4 } }, {});
  assert.equal(receivedPayload.tabId, 4);
});

test('onMessage responds with an error object when the handler throws', async () => {
  const runtime = fakeRuntime();
  onMessage(MSG_TYPE.START_DOWNLOAD, async () => { throw new Error('boom'); }, runtime);
  const result = await runtime.trigger({ type: MSG_TYPE.START_DOWNLOAD, payload: {} }, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});
