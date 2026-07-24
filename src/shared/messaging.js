export const MSG_TYPE = Object.freeze({
  DOM_SCAN_RESULT: 'DOM_SCAN_RESULT',
  GET_TAB_ITEMS: 'GET_TAB_ITEMS',
  START_DOWNLOAD: 'START_DOWNLOAD',
});

export function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

// No automatic tabId derivation: which tabId a handler should trust depends
// on the message's origin, and that's a per-message-type decision, not a
// generic "does sender.tab happen to be populated" heuristic. sender.tab is
// populated for ANY script running in a real tab context -- not just
// content scripts -- so an extension page (e.g. options.html) opened as a
// regular tab also gets a populated sender.tab, which would silently
// override an explicit payload.tabId if this function guessed. Each
// handler in service-worker.js reads tabId from whichever source is
// actually trustworthy for that message type: sender.tab.id for
// DOM_SCAN_RESULT (content-script-only), payload.tabId for
// popup/options-originated messages (GET_TAB_ITEMS, START_DOWNLOAD).
export function onMessage(type, handler, runtimeApi = chrome.runtime) {
  runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== type) return undefined;
    Promise.resolve(handler(message.payload || {}, sender))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true; // keep the message channel open for the async sendResponse above
  });
}
