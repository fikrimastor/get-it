// src/shared/messaging.js

export const MSG_TYPE = Object.freeze({
  DOM_SCAN_RESULT: 'DOM_SCAN_RESULT',
  GET_TAB_ITEMS: 'GET_TAB_ITEMS',
  START_DOWNLOAD: 'START_DOWNLOAD',
});

export function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

export function onMessage(type, handler, runtimeApi = chrome.runtime) {
  runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== type) return undefined;
    const tabId = sender && sender.tab ? sender.tab.id : message.payload?.tabId;
    Promise.resolve(handler({ ...message.payload, tabId }, sender))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true; // keep the message channel open for the async sendResponse above
  });
}
