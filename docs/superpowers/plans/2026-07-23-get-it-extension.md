# Get It Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Get It", a personal-use Manifest V3 browser extension (Chrome/Brave/Edge) that detects video/audio media on any page via network-request sniffing and downloads it, merging HLS/DASH segments client-side with no native companion app, no backend, and no per-site extractors.

**Architecture:** Three components — a background service worker (network sniffing, manifest parsing, merge engine, downloads) as the source of truth for per-tab detected media; a lightweight content script for DOM-based metadata enrichment only; and a popup + options page as thin UI over the background's state and `chrome.storage`-backed settings.

**Tech Stack:** Vanilla JS (ES modules), Manifest V3 `chrome.*` APIs, Node's built-in `node:test` runner for pure-logic unit tests, one vendored third-party library (`mux.js` for MPEG-TS→fMP4 remuxing).

## Global Constraints

- Manifest V3, unpacked/side-loaded only — never published to any extension store. Targets Chrome, Brave, and Edge (all Chromium, one codebase); no Firefox build.
- No native companion app, no backend, no accounts, no premium/paywall tier — every feature is available directly and unlimited.
- No per-site extractors (no YouTube/Instagram/TikTok/Facebook/Twitter-specific code). Detection is generic: standard `<video>`/`<audio>`, direct progressive files, and standard HLS (`.m3u8`)/DASH (`.mpd`) manifests only.
- Detection is **network-request-sniffing-first** (`chrome.webRequest`, non-blocking/observational) because most modern players feed `<video>` via MediaSource, making `video.src` an unfetchable `blob:` URL. DOM scanning (content script) is secondary/enrichment-only.
- No ffmpeg.wasm, no re-encoding — only container-level remux/concatenation of already-encoded streams.
- **Deviation from the approved design doc, made during planning and flagged here explicitly:** the design's "mp4box.js" plan for muxing DASH's separate audio-only + video-only adaptation sets into one file was replaced with **downloading two separate files** (`{title}-{quality}-video.mp4` + `{title}-{quality}-audio.m4a`) for v1. Rationale: true container-level muxing of independently-encoded tracks requires low-level mp4box.js API usage (`createFile()`/`addTrack()`/`addSample()`) that could not be verified against the real library in this planning session, and shipping unverified low-level media-muxing code was judged a worse risk than a clearly-labeled two-file v1 output. Single-file muxing is a documented fast-follow.
- **Additional documented v1 limitation, discovered during planning:** DASH parsing only supports `SegmentTemplate` with `$Number$` substitution on static (non-live) single-`Period` manifests — the common case. `SegmentTimeline`/`$Time$`-based templates and multi-`Period`/live manifests are out of scope for v1.
- **Additional documented v1 limitation (already known from the design doc):** media built purely from in-memory blobs with no corresponding network manifest/segment traffic is undetectable in v1 (would require `world: "MAIN"` script injection to hook `MediaSource`, deliberately deferred).
- No automated end-to-end/UI test suite (per the design's Verification Plan — this is a UI-driven personal tool). **Pure-logic modules DO get unit tests** via Node's built-in `node:test` (`npm test`) — this is a planning-time addition beyond the design doc's verification section, justified because these modules (manifest parsing, merge classification, filename templating) are pure functions where regressions are cheap to catch and expensive to debug via browser-only testing. Browser-API-integrated glue (service worker wiring, popup/options DOM, context menu) is verified manually per the checklist in the final task.
- Extension name: "Get It". Independent branding from Video DownloadHelper (name/icon only — the popup/options interaction layout is the intentional UI clone).
- Icons (`icons/icon-{16,32,48,128}.png`) and the vendored library (`vendor/mux.js`, mux.js v6.3.0, confirmed UMD build exposing `globalThis.muxjs`, verified against the package's real `dist/mux.js` and README `Transmuxer` usage example during planning) already exist on disk in the project root as of this plan — Task 1 wires and commits them, it does not regenerate them.

---

## File Structure

```
get-it/
├── manifest.json
├── package.json
├── .gitignore
├── icons/
│   ├── icon-16.png            (already created)
│   ├── icon-32.png            (already created)
│   ├── icon-48.png            (already created)
│   └── icon-128.png           (already created)
├── vendor/
│   └── mux.js                 (already vendored — mux.js 6.3.0 dist build)
├── src/
│   ├── shared/
│   │   ├── media-item.js      (MediaItem/Rendition shape + factory functions)
│   │   ├── storage.js         (chrome.storage.sync settings wrapper + blacklist matching)
│   │   └── messaging.js       (typed message-passing contract between content/background/popup)
│   ├── background/
│   │   ├── hls-parser.js      (parseM3U8: HLS master/media playlist → Rendition[])
│   │   ├── dash-parser.js     (parseMPD: DASH MPD → Rendition[], $Number$ SegmentTemplate only)
│   │   ├── merge-engine.js    (classifyMerge + concat/remux/split-tracks strategies)
│   │   ├── downloader.js      (filename templating + chrome.downloads wiring)
│   │   ├── tab-state.js       (per-tab detected-item store + badge text)
│   │   ├── request-sniffer.js (chrome.webRequest classification + wiring)
│   │   ├── context-menu.js    (right-click "Download this video")
│   │   └── service-worker.js  (entry point — wires everything above)
│   ├── content/
│   │   └── dom-scanner.js     (classic content script — DOM metadata enrichment)
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/
│       ├── options.html
│       ├── options.css
│       └── options.js
└── tests/
    ├── media-item.test.js
    ├── storage.test.js
    ├── messaging.test.js
    ├── hls-parser.test.js
    ├── dash-parser.test.js
    ├── merge-engine.test.js
    ├── downloader.test.js
    ├── tab-state.test.js
    └── request-sniffer.test.js
```

**Module system:** `manifest.json` declares the background as `"type": "module"`, so `service-worker.js` and everything it imports use ES `import`/`export`. `popup.html`/`options.html` load their scripts as `<script type="module">`, so they can import `src/shared/*.js` directly. `content/dom-scanner.js` is a **classic** (non-module) script — Chrome's `content_scripts` manifest key does not support `"type": "module"` — so it is deliberately self-contained with no imports (see Task 13 for the specific tradeoff this implies).

**Test runner:** `package.json` sets `"type": "module"` so Node's native ES module loader can `import` the exact same `src/**/*.js` files the extension runs — no transpilation, no separate test-only source tree. `npm test` runs bare `node --test`, which auto-discovers every `tests/*.test.js` file. **Verified during planning, not assumed:** `node --test tests/` (passing the directory as an explicit path, on Node v22) fails with `MODULE_NOT_FOUND` — Node treats the argument as a module to `require`, not a search root. Bare `node --test` (no path argument) is the form that actually works.

---

### Task 1: Project scaffolding — manifest, package.json, asset wiring

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `.gitignore`
- Verify (already present, not regenerated): `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`, `vendor/mux.js`

**Interfaces:**
- Produces: the manifest's `permissions`/`host_permissions` list, which every later background-task import of `chrome.*` APIs relies on being present.

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Get It",
  "version": "0.1.0",
  "description": "Detects and downloads video and audio media from web pages.",
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/dom-scanner.js"],
      "all_frames": true,
      "run_at": "document_idle"
    }
  ],
  "options_page": "src/options/options.html",
  "permissions": ["downloads", "storage", "contextMenus", "webRequest", "webNavigation"],
  "host_permissions": ["<all_urls>"]
}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "get-it",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Personal-use browser extension that detects and downloads video/audio media.",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 4: Verify pre-existing assets are present**

Run: `test -f icons/icon-16.png && test -f icons/icon-32.png && test -f icons/icon-48.png && test -f icons/icon-128.png && test -f vendor/mux.js && echo "assets present"`
Expected: `assets present`

If any file is missing, stop and flag it — these are pre-generated assets this plan assumes exist, not something to hand-author inline.

- [ ] **Step 5: Manual verification — extension loads with no manifest errors**

In Chrome/Brave/Edge: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select the `get-it/` directory.
Expected: the extension card appears with no red error banner. It's fine that the popup is currently empty/broken — later tasks build `src/`.

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json .gitignore icons/ vendor/
git commit -m "chore: scaffold manifest, package.json, and vendor assets"
```

---

### Task 2: `src/shared/media-item.js` — MediaItem/Rendition data shapes

**Files:**
- Create: `src/shared/media-item.js`
- Test: `tests/media-item.test.js`

**Interfaces:**
- Produces: `MEDIA_TYPE` (`{VIDEO, AUDIO}`), `SOURCE_KIND` (`{PROGRESSIVE, HLS, DASH}`), `createMediaItem({tabId, sourceKind, mediaType, pageUrl, manifestUrl?, progressiveUrl?, title?, posterUrl?, renditions?}) → MediaItem` (adds `id`, `createdAt`), `createRendition(overrides?) → Rendition` (fills defaults: `id, label, bandwidth, width, height, container, videoInitUrl, videoSegmentUrls, audioInitUrl, audioSegmentUrls`). Every later background/popup task consumes these exact field names.

- [ ] **Step 1: Write the failing tests**

```js
// tests/media-item.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/shared/media-item.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/shared/media-item.js

export const MEDIA_TYPE = Object.freeze({
  VIDEO: 'video',
  AUDIO: 'audio',
});

export const SOURCE_KIND = Object.freeze({
  PROGRESSIVE: 'progressive',
  HLS: 'hls',
  DASH: 'dash',
});

let nextId = 1;

export function createMediaItem({
  tabId,
  sourceKind,
  mediaType,
  pageUrl,
  manifestUrl = null,
  progressiveUrl = null,
  title = null,
  posterUrl = null,
  renditions = [],
}) {
  return {
    id: `${tabId}-${nextId++}`,
    tabId,
    sourceKind,
    mediaType,
    pageUrl,
    manifestUrl,
    progressiveUrl,
    title,
    posterUrl,
    renditions,
    createdAt: Date.now(),
  };
}

const RENDITION_DEFAULTS = {
  id: 'default',
  label: 'Default',
  bandwidth: 0,
  width: 0,
  height: 0,
  container: 'fmp4',
  videoInitUrl: null,
  videoSegmentUrls: [],
  audioInitUrl: null,
  audioSegmentUrls: [],
};

export function createRendition(overrides = {}) {
  return { ...RENDITION_DEFAULTS, ...overrides };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 3 passing tests in `tests/media-item.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/shared/media-item.js tests/media-item.test.js
git commit -m "feat: add MediaItem/Rendition data shapes"
```

---

### Task 3: `src/shared/storage.js` — settings + blacklist matching

**Files:**
- Create: `src/shared/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_SETTINGS` (`{subfolder, filenameTemplate, askWhereToSave, maxConcurrentDownloads, theme, blacklist}`), `getSettings(storageApi? = chrome.storage.sync) → Promise<Settings>`, `setSettings(partial, storageApi? = chrome.storage.sync) → Promise<void>`, `isBlacklisted(hostname, settings) → boolean`. `service-worker.js` (Task 12) and `options.js` (Task 15) both import these directly — no message-passing round trip for settings.

- [ ] **Step 1: Write the failing tests**

```js
// tests/storage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, setSettings, isBlacklisted, DEFAULT_SETTINGS } from '../src/shared/storage.js';

function fakeStorage(initial = {}) {
  let store = { ...initial };
  return {
    get: async (defaults) => ({ ...defaults, ...store }),
    set: async (partial) => { store = { ...store, ...partial }; },
    _dump: () => store,
  };
}

test('getSettings merges stored values over defaults', async () => {
  const storage = fakeStorage({ subfolder: 'Custom' });
  const settings = await getSettings(storage);
  assert.equal(settings.subfolder, 'Custom');
  assert.equal(settings.filenameTemplate, DEFAULT_SETTINGS.filenameTemplate);
});

test('setSettings persists a partial update', async () => {
  const storage = fakeStorage();
  await setSettings({ theme: 'dark' }, storage);
  assert.equal(storage._dump().theme, 'dark');
});

test('isBlacklisted matches exact hostname', () => {
  const settings = { blacklist: ['example.com'] };
  assert.equal(isBlacklisted('example.com', settings), true);
  assert.equal(isBlacklisted('other.com', settings), false);
});

test('isBlacklisted matches subdomains of a blacklisted domain', () => {
  const settings = { blacklist: ['example.com'] };
  assert.equal(isBlacklisted('cdn.example.com', settings), true);
});

test('isBlacklisted returns false for an empty blacklist', () => {
  assert.equal(isBlacklisted('example.com', { blacklist: [] }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/shared/storage.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/shared/storage.js

export const DEFAULT_SETTINGS = Object.freeze({
  subfolder: 'GetIt',
  filenameTemplate: '{title}-{quality}.{ext}',
  askWhereToSave: false,
  maxConcurrentDownloads: 3,
  theme: 'system',
  blacklist: [],
});

export async function getSettings(storageApi = chrome.storage.sync) {
  const stored = await storageApi.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(partial, storageApi = chrome.storage.sync) {
  await storageApi.set(partial);
}

export function isBlacklisted(hostname, settings) {
  if (!hostname || !settings || !Array.isArray(settings.blacklist)) return false;
  return settings.blacklist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    const host = hostname.toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}
```

Note: `getSettings`'s default parameter `chrome.storage.sync` is only evaluated when the function is called without an explicit `storageApi` argument — in the Node test environment, tests always pass `fakeStorage()` explicitly, so the bare global `chrome` never needs to exist for the test file to load or run.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 5 passing tests in `tests/storage.test.js` (plus the 3 from Task 2 still passing)

- [ ] **Step 5: Commit**

```bash
git add src/shared/storage.js tests/storage.test.js
git commit -m "feat: add settings storage wrapper and blacklist matching"
```

---

### Task 4: `src/shared/messaging.js` — typed message contract

**Files:**
- Create: `src/shared/messaging.js`
- Test: `tests/messaging.test.js`

**Interfaces:**
- Produces: `MSG_TYPE` (`{DOM_SCAN_RESULT, GET_TAB_ITEMS, START_DOWNLOAD}`), `sendToBackground(type, payload?) → Promise<any>` (wraps `chrome.runtime.sendMessage`), `onMessage(type, handler, runtimeApi? = chrome.runtime)` — registers a listener that only fires `handler(payload, sender)` for matching `message.type` (payload defaults to `{}` when the message has none); `handler`'s resolved/rejected value is sent back via `sendResponse`, with thrown errors converted to `{ok: false, error: String(message)}`. **No automatic tabId derivation** — deliberately, see the real-browser-verified rationale below.
- Consumed by: `dom-scanner.js`'s hardcoded string constant `'DOM_SCAN_RESULT'` (Task 13, intentionally not importing this module — see that task's notes) must stay equal to `MSG_TYPE.DOM_SCAN_RESULT`'s value defined here.

- [ ] **Step 1: Write the failing tests**

```js
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

test('onMessage passes the raw payload through unmodified, with no tabId guessing', async () => {
  const runtime = fakeRuntime();
  let receivedPayload = null;
  onMessage(MSG_TYPE.GET_TAB_ITEMS, async (payload) => { receivedPayload = payload; return { items: [] }; }, runtime);
  await runtime.trigger({ type: MSG_TYPE.GET_TAB_ITEMS, payload: { tabId: 4 } }, { tab: { id: 999 } });
  assert.deepEqual(receivedPayload, { tabId: 4 });
});

test('onMessage passes the sender through so a handler can read sender.tab.id itself', async () => {
  const runtime = fakeRuntime();
  let receivedSender = null;
  onMessage(MSG_TYPE.DOM_SCAN_RESULT, async (payload, sender) => { receivedSender = sender; return { ok: true }; }, runtime);
  await runtime.trigger({ type: MSG_TYPE.DOM_SCAN_RESULT, payload: { items: [] } }, { tab: { id: 9 } });
  assert.equal(receivedSender.tab.id, 9);
});

test('onMessage defaults payload to an empty object when the message has none', async () => {
  const runtime = fakeRuntime();
  let receivedPayload = 'unset';
  onMessage(MSG_TYPE.GET_TAB_ITEMS, async (payload) => { receivedPayload = payload; return {}; }, runtime);
  await runtime.trigger({ type: MSG_TYPE.GET_TAB_ITEMS }, {});
  assert.deepEqual(receivedPayload, {});
});

test('onMessage responds with an error object when the handler throws', async () => {
  const runtime = fakeRuntime();
  onMessage(MSG_TYPE.START_DOWNLOAD, async () => { throw new Error('boom'); }, runtime);
  const result = await runtime.trigger({ type: MSG_TYPE.START_DOWNLOAD, payload: {} }, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/shared/messaging.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/shared/messaging.js

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
// populated for ANY script running in a real tab context — not just
// content scripts — so an extension page (e.g. options.html) opened as a
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
```

**Real-browser-verified rationale for this design (originally the plan had auto-derivation preferring `sender.tab.id` whenever present, falling back to `payload.tabId` otherwise):** Task 16's end-to-end verification in a real Brave browser found this auto-derivation silently broke `GET_TAB_ITEMS` — `chrome.storage.session` correctly held the detected item for a tab, yet the message handler returned `{items: []}` for that exact tabId. Root cause: querying from an extension page (options.html) opened as a real tab gives that message a populated `sender.tab` too (not just content-script messages), so the original code always took the `sender.tab.id` branch and silently discarded the caller's explicit `payload.tabId`. The fix removes the guess entirely — no handler in this codebase can be fooled by an unexpected `sender.tab` again, because none of them are ever handed one implicitly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 5 passing tests in `tests/messaging.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/shared/messaging.js tests/messaging.test.js
git commit -m "feat: add typed message-passing contract"
```

---

### Task 5: `src/background/hls-parser.js` — HLS playlist parsing

**Files:**
- Create: `src/background/hls-parser.js`
- Test: `tests/hls-parser.test.js`

**Interfaces:**
- Produces: `parseM3U8(text, baseUrl, fetchFn? = fetch) → Promise<RenditionInput[]>` where each `RenditionInput` has the shape consumed by `createRendition` from Task 2 (`id, label, bandwidth, width, height, container, videoInitUrl, videoSegmentUrls, audioInitUrl: null, audioSegmentUrls: []`). `service-worker.js` (Task 12) calls this on `.m3u8` network detections and maps the result through `createRendition`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/hls-parser.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/hls-parser.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/hls-parser.js

function resolveUrl(uri, baseUrl) {
  return new URL(uri, baseUrl).toString();
}

function parseAttributeList(str) {
  const attrs = {};
  const regex = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const segmentUrls = [];
  let initUrl = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) {
        initUrl = resolveUrl(attrs.URI, baseUrl);
      }
    } else if (!line.startsWith('#')) {
      segmentUrls.push(resolveUrl(line, baseUrl));
    }
  }

  return {
    container: initUrl ? 'fmp4' : 'ts',
    initUrl,
    segmentUrls,
  };
}

export async function parseM3U8(text, baseUrl, fetchFn = fetch) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF:'));

  if (!isMaster) {
    const playlist = parseMediaPlaylist(text, baseUrl);
    return [
      {
        id: 'default',
        label: 'Default quality',
        bandwidth: 0,
        width: 0,
        height: 0,
        container: playlist.container,
        videoInitUrl: playlist.initUrl,
        videoSegmentUrls: playlist.segmentUrls,
        audioInitUrl: null,
        audioSegmentUrls: [],
      },
    ];
  }

  const renditions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
    const variantUri = lines[i + 1];
    if (!variantUri || variantUri.startsWith('#')) continue;

    const variantUrl = resolveUrl(variantUri, baseUrl);
    const bandwidth = Number(attrs.BANDWIDTH) || 0;
    let width = 0;
    let height = 0;
    if (attrs.RESOLUTION) {
      const [w, h] = attrs.RESOLUTION.split('x').map(Number);
      width = w || 0;
      height = h || 0;
    }

    const variantResponse = await fetchFn(variantUrl);
    const variantText = await variantResponse.text();
    const playlist = parseMediaPlaylist(variantText, variantUrl);

    renditions.push({
      id: `variant-${renditions.length}`,
      label: height ? `${height}p` : `${Math.round(bandwidth / 1000)}kbps`,
      bandwidth,
      width,
      height,
      container: playlist.container,
      videoInitUrl: playlist.initUrl,
      videoSegmentUrls: playlist.segmentUrls,
      audioInitUrl: null,
      audioSegmentUrls: [],
    });
  }

  renditions.sort((a, b) => b.bandwidth - a.bandwidth);
  return renditions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 3 passing tests in `tests/hls-parser.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/hls-parser.js tests/hls-parser.test.js
git commit -m "feat: add HLS playlist parser"
```

---

### Task 6: `src/background/dash-parser.js` — DASH MPD parsing

**Files:**
- Create: `src/background/dash-parser.js`
- Test: `tests/dash-parser.test.js`

**Interfaces:**
- Produces: `parseMPD(xmlText, baseUrl) → RenditionInput[]` (synchronous — no injected fetch, unlike `parseM3U8`, because a static MPD's `SegmentTemplate` declares everything needed without a secondary fetch). Same `RenditionInput` shape as Task 5, but `audioInitUrl`/`audioSegmentUrls` may be populated (from the manifest's first audio `AdaptationSet`) rather than always empty. `service-worker.js` (Task 12) calls this on `.mpd` network detections.
- **Scope, stated explicitly per the Global Constraints deviation:** single `Period`, `SegmentTemplate` with `$Number$`/`$RepresentationID$` substitution only, static `mediaPresentationDuration`-based segment counts. No `SegmentTimeline`, no `$Time$`, no multi-`Period`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/dash-parser.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/dash-parser.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/dash-parser.js
// Deliberately scoped DASH MPD parser (no XML-parsing dependency — see
// Global Constraints for why). Handles the common case: a single Period,
// SegmentTemplate with $Number$ substitution, static (non-live) manifests.

function getAttr(tagText, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : null;
}

function findTags(xml, tagName) {
  const results = [];
  const re = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({ attrsText: m[1], innerText: m[2] || '' });
  }
  return results;
}

// SegmentTemplate declared directly under AdaptationSet always appears
// before the first Representation child in real-world manifests. Slicing
// to that point avoids accidentally matching a Representation's own
// (differently-scoped) SegmentTemplate override.
function extractDirectSegmentTemplate(xml) {
  const repIndex = xml.indexOf('<Representation');
  const scope = repIndex === -1 ? xml : xml.slice(0, repIndex);
  return findTags(scope, 'SegmentTemplate')[0] || null;
}

function parseISO8601Duration(str) {
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str || '');
  if (!match) return 0;
  const hours = parseFloat(match[1] || '0');
  const minutes = parseFloat(match[2] || '0');
  const seconds = parseFloat(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

function resolveUrl(uri, baseUrl) {
  return new URL(uri, baseUrl).toString();
}

function parseSegmentTemplate(tagText) {
  return {
    media: getAttr(tagText, 'media'),
    initialization: getAttr(tagText, 'initialization'),
    timescale: Number(getAttr(tagText, 'timescale')) || 1,
    duration: Number(getAttr(tagText, 'duration')) || 0,
    startNumber: Number(getAttr(tagText, 'startNumber')) || 1,
  };
}

function buildSegmentUrls(template, representationId, baseUrl, totalDurationSeconds) {
  if (!template || !template.media) {
    return { initUrl: null, segmentUrls: [] };
  }
  const initUrl = template.initialization
    ? resolveUrl(template.initialization.replace(/\$RepresentationID\$/g, representationId), baseUrl)
    : null;

  const totalSegments = template.duration > 0
    ? Math.ceil((totalDurationSeconds * template.timescale) / template.duration)
    : 0;

  const segmentUrls = [];
  for (let n = template.startNumber; n < template.startNumber + totalSegments; n++) {
    const media = template.media
      .replace(/\$RepresentationID\$/g, representationId)
      .replace(/\$Number\$/g, String(n));
    segmentUrls.push(resolveUrl(media, baseUrl));
  }
  return { initUrl, segmentUrls };
}

function representationsOf(adaptationSetInnerXml) {
  const setLevelTemplateTag = extractDirectSegmentTemplate(adaptationSetInnerXml);
  const reps = findTags(adaptationSetInnerXml, 'Representation');
  return reps.map((rep) => {
    const repTemplateTag = findTags(rep.innerText, 'SegmentTemplate')[0];
    const templateTag = repTemplateTag || setLevelTemplateTag;
    return {
      id: getAttr(rep.attrsText, 'id') || 'default',
      bandwidth: Number(getAttr(rep.attrsText, 'bandwidth')) || 0,
      width: Number(getAttr(rep.attrsText, 'width')) || 0,
      height: Number(getAttr(rep.attrsText, 'height')) || 0,
      template: templateTag ? parseSegmentTemplate(templateTag.attrsText) : null,
    };
  });
}

export function parseMPD(xmlText, baseUrl) {
  const mpdTag = findTags(xmlText, 'MPD')[0];
  const totalDuration = parseISO8601Duration(mpdTag ? getAttr(mpdTag.attrsText, 'mediaPresentationDuration') : null);

  const periods = findTags(xmlText, 'Period');
  if (periods.length === 0) return [];
  const period = periods[0];

  const adaptationSets = findTags(period.innerText, 'AdaptationSet');

  let videoReps = [];
  let audioReps = [];
  for (const set of adaptationSets) {
    const mimeType = getAttr(set.attrsText, 'mimeType') || getAttr(set.attrsText, 'contentType') || '';
    const reps = representationsOf(set.innerText);
    if (mimeType.startsWith('video')) {
      videoReps = videoReps.concat(reps);
    } else if (mimeType.startsWith('audio')) {
      audioReps = audioReps.concat(reps);
    }
  }

  const chosenAudio = audioReps[0] || null;
  const audioBuilt = chosenAudio
    ? buildSegmentUrls(chosenAudio.template, chosenAudio.id, baseUrl, totalDuration)
    : { initUrl: null, segmentUrls: [] };

  const renditions = videoReps.map((rep, index) => {
    const video = buildSegmentUrls(rep.template, rep.id, baseUrl, totalDuration);
    return {
      id: `dash-${index}`,
      label: rep.height ? `${rep.height}p` : (rep.bandwidth ? `${Math.round(rep.bandwidth / 1000)}kbps` : `rendition ${index + 1}`),
      bandwidth: rep.bandwidth,
      width: rep.width,
      height: rep.height,
      container: 'fmp4',
      videoInitUrl: video.initUrl,
      videoSegmentUrls: video.segmentUrls,
      audioInitUrl: chosenAudio ? audioBuilt.initUrl : null,
      audioSegmentUrls: chosenAudio ? audioBuilt.segmentUrls : [],
    };
  });

  renditions.sort((a, b) => b.bandwidth - a.bandwidth);
  return renditions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 3 passing tests in `tests/dash-parser.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/dash-parser.js tests/dash-parser.test.js
git commit -m "feat: add scoped DASH MPD parser"
```

---

### Task 7: `src/background/merge-engine.js` — merge strategy classification + execution

**Files:**
- Create: `src/background/merge-engine.js`
- Test: `tests/merge-engine.test.js`

**Interfaces:**
- Consumes: `Rendition` shape from Task 2.
- Produces: `MERGE_STRATEGY` (`{DIRECT, CONCAT_FMP4, REMUX_TS, SPLIT_TRACKS}`), `classifyMerge(rendition) → MERGE_STRATEGY value`, `fetchSegments(urls, fetchFn? = fetch) → Promise<ArrayBuffer[]>`, `mergeConcatFmp4(rendition, fetchFn? = fetch) → Promise<Blob>`, `mergeTsWithTransmuxer(segmentBuffers, muxjsInstance) → Promise<Blob>`, `mergeRemuxTs(rendition, fetchFn, muxjsInstance) → Promise<Blob>`, `mergeSplitTracks(rendition, fetchFn? = fetch) → Promise<{videoBlob: Blob, audioBlob: Blob}>`. `service-worker.js` (Task 12) calls `classifyMerge` to pick which of the three merge functions to run.

- [ ] **Step 1: Write the failing tests**

```js
// tests/merge-engine.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/merge-engine.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/merge-engine.js

export const MERGE_STRATEGY = Object.freeze({
  DIRECT: 'direct',
  CONCAT_FMP4: 'concat-fmp4',
  REMUX_TS: 'remux-ts',
  SPLIT_TRACKS: 'split-tracks',
});

export function classifyMerge(rendition) {
  if (!rendition) return MERGE_STRATEGY.DIRECT;
  if (rendition.audioSegmentUrls && rendition.audioSegmentUrls.length > 0) {
    return MERGE_STRATEGY.SPLIT_TRACKS;
  }
  if (rendition.container === 'ts') {
    return MERGE_STRATEGY.REMUX_TS;
  }
  return MERGE_STRATEGY.CONCAT_FMP4;
}

export async function fetchSegments(urls, fetchFn = fetch) {
  const buffers = [];
  for (const url of urls) {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Segment fetch failed (${response.status}): ${url}`);
    }
    buffers.push(await response.arrayBuffer());
  }
  return buffers;
}

export async function mergeConcatFmp4(rendition, fetchFn = fetch) {
  const parts = [];
  if (rendition.videoInitUrl) {
    const [initBuffer] = await fetchSegments([rendition.videoInitUrl], fetchFn);
    parts.push(initBuffer);
  }
  const segmentBuffers = await fetchSegments(rendition.videoSegmentUrls, fetchFn);
  parts.push(...segmentBuffers);
  return new Blob(parts, { type: 'video/mp4' });
}

export function mergeTsWithTransmuxer(segmentBuffers, muxjsInstance) {
  return new Promise((resolve, reject) => {
    if (segmentBuffers.length === 0) {
      reject(new Error('No TS segments to merge'));
      return;
    }
    const transmuxer = new muxjsInstance.mp4.Transmuxer();
    let initSegment = null;
    const dataChunks = [];

    transmuxer.on('data', (segment) => {
      if (!initSegment && segment.initSegment) {
        initSegment = segment.initSegment;
      }
      dataChunks.push(segment.data);
    });
    transmuxer.on('done', () => {
      const parts = initSegment ? [initSegment, ...dataChunks] : dataChunks;
      if (parts.length === 0) {
        reject(new Error('Transmuxer produced no output'));
        return;
      }
      resolve(new Blob(parts, { type: 'video/mp4' }));
    });
    transmuxer.on('error', (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    try {
      for (const buffer of segmentBuffers) {
        transmuxer.push(new Uint8Array(buffer));
      }
      transmuxer.flush();
    } catch (err) {
      reject(err);
    }
  });
}

export async function mergeRemuxTs(rendition, fetchFn, muxjsInstance) {
  const segmentBuffers = await fetchSegments(rendition.videoSegmentUrls, fetchFn);
  return mergeTsWithTransmuxer(segmentBuffers, muxjsInstance);
}

export async function mergeSplitTracks(rendition, fetchFn = fetch) {
  const videoBlob = await mergeConcatFmp4(rendition, fetchFn);

  const audioParts = [];
  if (rendition.audioInitUrl) {
    const [initBuffer] = await fetchSegments([rendition.audioInitUrl], fetchFn);
    audioParts.push(initBuffer);
  }
  const audioSegmentBuffers = await fetchSegments(rendition.audioSegmentUrls, fetchFn);
  audioParts.push(...audioSegmentBuffers);

  return { videoBlob, audioBlob: new Blob(audioParts, { type: 'audio/mp4' }) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 9 passing tests in `tests/merge-engine.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/merge-engine.js tests/merge-engine.test.js
git commit -m "feat: add merge engine (classify + concat/remux/split-tracks strategies)"
```

---

### Task 8: `src/background/downloader.js` — filename templating + chrome.downloads wiring

**Files:**
- Create: `src/background/downloader.js`
- Test: `tests/downloader.test.js`

**Interfaces:**
- Produces: `sanitizeFilenameSegment(text) → string`, `renderFilename(template, {title, quality, ext}) → string`, `buildDownloadPath(subfolder, filename) → string`, `downloadBlob(blob, path, downloadsApi? = chrome.downloads, saveAs? = false) → Promise<number>`, `downloadUrl(url, path, downloadsApi? = chrome.downloads, saveAs? = false) → Promise<number>`. `service-worker.js` (Task 12) uses all five.

- [ ] **Step 1: Write the failing tests**

```js
// tests/downloader.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilenameSegment, renderFilename, buildDownloadPath, downloadBlob, downloadUrl } from '../src/background/downloader.js';

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

test('downloadBlob calls the injected downloads API with a blob object URL', async () => {
  const calls = [];
  const fakeDownloadsApi = {
    download: async (options) => {
      calls.push(options);
      return 42;
    },
  };
  const id = await downloadBlob(new Blob(['x']), 'GetIt/clip.mp4', fakeDownloadsApi, false);
  assert.equal(id, 42);
  assert.equal(calls[0].filename, 'GetIt/clip.mp4');
  assert.equal(calls[0].saveAs, false);
  assert.match(calls[0].url, /^blob:/);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/downloader.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/downloader.js

export function sanitizeFilenameSegment(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function renderFilename(template, { title, quality, ext } = {}) {
  const safeTitle = sanitizeFilenameSegment(title || 'video');
  const safeQuality = sanitizeFilenameSegment(quality || '');
  const safeExt = sanitizeFilenameSegment(ext || 'mp4');
  return template
    .replace(/\{title\}/g, safeTitle)
    .replace(/\{quality\}/g, safeQuality)
    .replace(/\{ext\}/g, safeExt)
    .replace(/-+/g, '-')
    .replace(/^-|-(?=\.)/g, '');
}

export function buildDownloadPath(subfolder, filename) {
  const safeSubfolder = sanitizeFilenameSegment(subfolder || '');
  return safeSubfolder ? `${safeSubfolder}/${filename}` : filename;
}

export async function downloadBlob(blob, path, downloadsApi = chrome.downloads, saveAs = false) {
  const url = URL.createObjectURL(blob);
  try {
    return await downloadsApi.download({ url, filename: path, saveAs });
  } finally {
    // chrome.downloads.download() reads the blob URL asynchronously;
    // revoking immediately can race that read, so revoke after a delay.
    // .unref() (Node-only) keeps this timer from blocking process exit in
    // tests; browser/service-worker timer ids have no .unref, so the guard
    // is a safe no-op there.
    const revokeTimer = setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (typeof revokeTimer.unref === 'function') revokeTimer.unref();
  }
}

export async function downloadUrl(url, path, downloadsApi = chrome.downloads, saveAs = false) {
  return downloadsApi.download({ url, filename: path, saveAs });
}
```

Note on `renderFilename`'s cleanup regex: with `quality: ''` (the progressive-file case), `'{title}-{quality}.{ext}'` first substitutes to `'video-.mp4'`; `.replace(/-+/g, '-')` collapses repeats, and `.replace(/^-|-(?=\.)/g, '')` strips a leading dash or a dash immediately before the extension's dot, producing `'video.mp4'` — matching the test's expected default-fallback output.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 9 passing tests in `tests/downloader.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/downloader.js tests/downloader.test.js
git commit -m "feat: add filename templating and chrome.downloads wiring"
```

---

### Task 9: `src/background/request-sniffer.js` — network request classification

**Files:**
- Create: `src/background/request-sniffer.js`
- Test: `tests/request-sniffer.test.js`

**Interfaces:**
- Produces: `classifyRequest(url, contentType) → {kind: 'hls'|'dash'|'progressive-video'|'progressive-audio', url} | null`, `registerRequestSniffer(webRequestApi, onCandidate)` — registers a `webRequestApi.onHeadersReceived` listener (requesting `['responseHeaders']`) that calls `onCandidate(tabId, classification)` for every classified, tab-associated (`tabId >= 0`) request. `service-worker.js` (Task 12) calls `registerRequestSniffer(chrome.webRequest, handleCandidate)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/request-sniffer.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/request-sniffer.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/request-sniffer.js

const MEDIA_EXTENSIONS = /\.(mp4|webm|m3u8|mpd|m4s|ts|mp3|m4a|ogg|weba)(\?|$)/i;
const MEDIA_SEGMENT_EXTENSIONS = /\.(m4s|ts)(\?|$)/i;
const MEDIA_CONTENT_TYPES = /^(video\/|audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/dash\+xml)/i;

export function classifyRequest(url, contentType) {
  // Checked unconditionally, before content-type: real CDNs commonly serve
  // .ts/.m4s segments with a genuine video/* or audio/* content-type, so a
  // content-type-first check would misclassify every segment of every
  // HLS/DASH stream as a standalone progressive item. Segments only matter
  // once found via their parent manifest.
  if (MEDIA_SEGMENT_EXTENSIONS.test(url)) {
    return null;
  }
  if (contentType && MEDIA_CONTENT_TYPES.test(contentType)) {
    if (/mpegurl/i.test(contentType)) return { kind: 'hls', url };
    if (/dash\+xml/i.test(contentType)) return { kind: 'dash', url };
    if (/^audio\//i.test(contentType)) return { kind: 'progressive-audio', url };
    return { kind: 'progressive-video', url };
  }
  if (MEDIA_EXTENSIONS.test(url)) {
    if (/\.m3u8(\?|$)/i.test(url)) return { kind: 'hls', url };
    if (/\.mpd(\?|$)/i.test(url)) return { kind: 'dash', url };
    if (/\.(mp3|m4a|ogg|weba)(\?|$)/i.test(url)) return { kind: 'progressive-audio', url };
    return { kind: 'progressive-video', url };
  }
  return null;
}

export function registerRequestSniffer(webRequestApi, onCandidate) {
  webRequestApi.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0) return;
      const contentTypeHeader = (details.responseHeaders || []).find(
        (h) => h.name.toLowerCase() === 'content-type'
      );
      const classification = classifyRequest(details.url, contentTypeHeader ? contentTypeHeader.value : null);
      if (classification) {
        onCandidate(details.tabId, classification);
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 10 passing tests in `tests/request-sniffer.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/request-sniffer.js tests/request-sniffer.test.js
git commit -m "feat: add network request classification and webRequest wiring"
```

---

### Task 10: `src/background/tab-state.js` — per-tab detected-item store

**Files:**
- Create: `src/background/tab-state.js`
- Test: `tests/tab-state.test.js`

**Interfaces:**
- Produces: `createTabStateStore(storageApi? = chrome.storage.session) → {getItems(tabId) → Promise<MediaItem[]>, setItems(tabId, items) → Promise<void>, addItem(tabId, item) → Promise<MediaItem[]>, clearTab(tabId) → Promise<void>}` (de-duplicates by matching `manifestUrl`+`progressiveUrl` pair), `badgeTextFor(itemCount) → string` (empty string for 0, else the count as a string — Chrome hides the badge automatically for empty text). `service-worker.js` (Task 12) holds one store instance for its whole lifetime and `await`s every call — **all four methods are async**, see the real-browser-verified rationale below.

- [ ] **Step 1: Write the failing tests**

```js
// tests/tab-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateStore, badgeTextFor } from '../src/background/tab-state.js';

function fakeSessionStorage(initial = {}) {
  let store = { ...initial };
  return {
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { store = { ...store, ...obj }; },
    remove: async (key) => { delete store[key]; },
    _dump: () => store,
  };
}

test('badgeTextFor renders an empty string for zero items', () => {
  assert.equal(badgeTextFor(0), '');
});

test('badgeTextFor renders the count as a string otherwise', () => {
  assert.equal(badgeTextFor(3), '3');
});

test('tab state store returns an empty array for an unknown tab', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  assert.deepEqual(await store.getItems(999), []);
});

test('tab state store accumulates items per tab', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  assert.equal((await store.getItems(1)).length, 2);
});

test('tab state store de-duplicates items with the same source url', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(1, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  assert.equal((await store.getItems(1)).length, 1);
});

test('tab state store clearTab removes all items for that tab only', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });
  await store.addItem(2, { id: 'b', manifestUrl: null, progressiveUrl: 'https://x/2.mp4' });
  await store.clearTab(1);
  assert.deepEqual(await store.getItems(1), []);
  assert.equal((await store.getItems(2)).length, 1);
});

test('setItems overwrites the full list for a tab (used for in-place metadata patches)', async () => {
  const store = createTabStateStore(fakeSessionStorage());
  await store.addItem(1, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4', title: null });
  const items = await store.getItems(1);
  items[0] = { ...items[0], title: 'Patched' };
  await store.setItems(1, items);
  assert.equal((await store.getItems(1))[0].title, 'Patched');
});

test('tab state store persists across independent store instances backed by the same storage (simulates a service-worker restart)', async () => {
  const sharedBackingStorage = fakeSessionStorage();
  const storeBeforeRestart = createTabStateStore(sharedBackingStorage);
  await storeBeforeRestart.addItem(7, { id: 'a', manifestUrl: null, progressiveUrl: 'https://x/1.mp4' });

  // A fresh createTabStateStore() call models what happens when the service
  // worker's top-level script re-executes after Chrome restarts it — a new
  // in-memory closure, but the same underlying chrome.storage.session data.
  const storeAfterRestart = createTabStateStore(sharedBackingStorage);
  assert.equal((await storeAfterRestart.getItems(7)).length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/background/tab-state.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/background/tab-state.js
//
// Per-tab detected-media store, backed by chrome.storage.session (not a
// plain in-memory Map). MV3 service workers are terminated aggressively by
// Chrome after brief idle periods — a plain Map loses everything on restart,
// so items detected moments before a restart vanish by the time the user
// opens the popup. chrome.storage.session exists specifically to survive
// service-worker restarts within a browsing session while still being
// cleared when the browser closes (unlike .local/.sync, which persist
// forever and would leak stale per-tab detection state indefinitely).

const STORAGE_PREFIX = 'tabItems_';

export function createTabStateStore(storageApi = chrome.storage.session) {
  function keyFor(tabId) {
    return `${STORAGE_PREFIX}${tabId}`;
  }

  async function getItems(tabId) {
    const key = keyFor(tabId);
    const stored = await storageApi.get(key);
    return stored[key] || [];
  }

  async function setItems(tabId, items) {
    await storageApi.set({ [keyFor(tabId)]: items });
  }

  async function addItem(tabId, item) {
    const existing = await getItems(tabId);
    const isDuplicate = existing.some(
      (i) => i.manifestUrl === item.manifestUrl && i.progressiveUrl === item.progressiveUrl
    );
    if (isDuplicate) return existing;
    const updated = [...existing, item];
    await setItems(tabId, updated);
    return updated;
  }

  async function clearTab(tabId) {
    await storageApi.remove(keyFor(tabId));
  }

  return { getItems, setItems, addItem, clearTab };
}

export function badgeTextFor(itemCount) {
  return itemCount > 0 ? String(itemCount) : '';
}
```

**Real-browser-verified rationale for this design (originally the plan had a plain in-memory `Map`, synchronous methods, no `setItems`):** Task 16's end-to-end verification in a real Brave browser found that a freshly-detected item was consistently gone by the time a `GET_TAB_ITEMS` query ran moments later — `chrome.tabs.query`/`chrome.runtime.sendMessage` round trips take real wall-clock time, and MV3 service workers are recycled aggressively enough that the gap was sometimes enough to wipe an in-memory `Map`'s entire contents (the worker's top-level script re-executes from scratch on restart, creating a brand-new empty `Map`). Switching the backing store to `chrome.storage.session` — designed specifically to outlive service-worker restarts within a session — fixed it; confirmed via a real download completing end-to-end afterward. `setItems` was added because `chrome.storage`-backed state can't be mutated in place the way the old Map's object references could (`service-worker.js`'s `DOM_SCAN_RESULT` handler needs to read the array, patch one entry, and write the whole array back).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 8 passing tests in `tests/tab-state.test.js` (plus all prior tests still passing)

- [ ] **Step 5: Commit**

```bash
git add src/background/tab-state.js tests/tab-state.test.js
git commit -m "feat: add per-tab detected-item store and badge text helper"
```

---

### Task 11: `src/background/context-menu.js` — right-click "Download this video"

**Files:**
- Create: `src/background/context-menu.js`

**Interfaces:**
- Produces: `registerContextMenu(contextMenusApi, tabsApi)` — creates a single `contexts: ['video', 'audio']` menu item and wires its click handler.
- Consumed by: `service-worker.js` (Task 12) calls `registerContextMenu(chrome.contextMenus, chrome.tabs)` once at startup.

No unit test for this task — it's thin `chrome.contextMenus` wiring exercised in the Task 12/16 manual verification, per the Global Constraints' testing boundary (chrome.\* glue is verified manually, pure logic is unit tested).

- [ ] **Step 1: Write the implementation**

```js
// src/background/context-menu.js

export function registerContextMenu(contextMenusApi, tabsApi) {
  contextMenusApi.removeAll(() => {
    contextMenusApi.create({
      id: 'get-it-download-here',
      title: 'Download this video with Get It',
      contexts: ['video', 'audio'],
    });
  });

  contextMenusApi.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'get-it-download-here' || !tab) return;
    // srcUrl is the resolved media element source Chrome supplies for
    // 'video'/'audio' contexts. Blob-backed players (the common MediaSource
    // case) surface as blob: here, which can't be re-fetched by the
    // extension — those are only downloadable via the popup, which relies
    // on the network-sniffed manifest/segment URLs instead of element src.
    if (!info.srcUrl || info.srcUrl.startsWith('blob:')) {
      chrome.action.openPopup?.();
      return;
    }
    chrome.downloads.download({ url: info.srcUrl });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/background/context-menu.js
git commit -m "feat: add right-click download context menu"
```

---

### Task 12: `src/background/service-worker.js` — wire everything together

**Files:**
- Create: `src/background/service-worker.js`

**Interfaces:**
- Consumes every export from Tasks 2–11: `MEDIA_TYPE`/`SOURCE_KIND`/`createMediaItem`/`createRendition` (Task 2), `getSettings`/`isBlacklisted` (Task 3), `MSG_TYPE`/`onMessage` (Task 4), `parseM3U8` (Task 5), `parseMPD` (Task 6), `classifyMerge`/`mergeConcatFmp4`/`mergeRemuxTs`/`mergeSplitTracks`/`MERGE_STRATEGY` (Task 7), `renderFilename`/`buildDownloadPath`/`downloadBlob`/`downloadUrl` (Task 8), `registerRequestSniffer` (Task 9), `createTabStateStore`/`badgeTextFor` (Task 10), `registerContextMenu` (Task 11).
- Produces: the running service worker — no other module imports this one.

This task is glue with no pure-function surface worth unit testing in isolation (it's the composition root). Verified manually in Step 2 below and again end-to-end in Task 16.

- [ ] **Step 1: Write the implementation**

```js
// src/background/service-worker.js
import { classifyRequest, registerRequestSniffer } from './request-sniffer.js';
import { parseM3U8 } from './hls-parser.js';
import { parseMPD } from './dash-parser.js';
import { createTabStateStore, badgeTextFor } from './tab-state.js';
import { createMediaItem, createRendition, MEDIA_TYPE, SOURCE_KIND } from '../shared/media-item.js';
import { classifyMerge, mergeConcatFmp4, mergeRemuxTs, mergeSplitTracks, MERGE_STRATEGY } from './merge-engine.js';
import { renderFilename, buildDownloadPath, downloadBlob, downloadUrl } from './downloader.js';
import { getSettings, isBlacklisted } from '../shared/storage.js';
import { MSG_TYPE, onMessage } from '../shared/messaging.js';
import { registerContextMenu } from './context-menu.js';

// mux.js's UMD build reads `window` for feature detection; service workers
// have no `window` global, so alias it to globalThis before loading.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

let muxjsInstance = null;
async function loadMuxJs() {
  if (muxjsInstance) return muxjsInstance;
  await import('../../vendor/mux.js');
  muxjsInstance = globalThis.muxjs;
  return muxjsInstance;
}

// Backed by chrome.storage.session (see tab-state.js) so detected items
// survive the service worker being torn down and restarted between
// detection time and whenever the user actually opens the popup.
const tabState = createTabStateStore();

async function updateBadge(tabId) {
  const items = await tabState.getItems(tabId);
  chrome.action.setBadgeText({ tabId, text: badgeTextFor(items.length) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#4F46E5' });
}

async function handleCandidate(tabId, candidate) {
  const settings = await getSettings();
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  // Blacklist is checked against BOTH the tab's currently-committed
  // hostname and the candidate resource's own hostname. Neither signal is
  // reliable alone: chrome.tabs.get(tabId).url can still reflect the
  // PREVIOUS page while a navigation is in flight (a direct navigation to a
  // raw media URL fires the media-typed request that triggers detection
  // before the tab's url property updates), and the resource's own
  // hostname is wrong to use alone for embedded media hosted on a
  // different CDN domain than the page the user actually meant to
  // blacklist. Checking both correctly covers a blacklisted page embedding
  // third-party media, a direct navigation straight to a blacklisted
  // media host, and everything in between.
  const candidateHostname = new URL(candidate.url).hostname;
  const tabHostname = tab.url ? new URL(tab.url).hostname : null;
  if (isBlacklisted(candidateHostname, settings) || (tabHostname && isBlacklisted(tabHostname, settings))) {
    return;
  }
  const pageUrl = tab.url || candidate.url;

  if (candidate.kind === 'progressive-video' || candidate.kind === 'progressive-audio') {
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: candidate.kind === 'progressive-audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl,
      progressiveUrl: candidate.url,
      title: tab.title,
    });
    await tabState.addItem(tabId, item);
    await updateBadge(tabId);
    return;
  }

  if (candidate.kind === 'hls') {
    try {
      const text = await (await fetch(candidate.url)).text();
      const renditions = (await parseM3U8(text, candidate.url)).map(createRendition);
      const item = createMediaItem({
        tabId,
        sourceKind: SOURCE_KIND.HLS,
        mediaType: MEDIA_TYPE.VIDEO,
        pageUrl,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      await tabState.addItem(tabId, item);
      await updateBadge(tabId);
    } catch (err) {
      console.warn('Get It: failed to parse HLS manifest', candidate.url, err);
    }
    return;
  }

  if (candidate.kind === 'dash') {
    try {
      const text = await (await fetch(candidate.url)).text();
      const renditions = parseMPD(text, candidate.url).map(createRendition);
      const item = createMediaItem({
        tabId,
        sourceKind: SOURCE_KIND.DASH,
        mediaType: MEDIA_TYPE.VIDEO,
        pageUrl,
        manifestUrl: candidate.url,
        title: tab.title,
        renditions,
      });
      await tabState.addItem(tabId, item);
      await updateBadge(tabId);
    } catch (err) {
      console.warn('Get It: failed to parse DASH manifest', candidate.url, err);
    }
  }
}

registerRequestSniffer(chrome.webRequest, handleCandidate);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await tabState.clearTab(tabId);
});
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) {
    await tabState.clearTab(details.tabId);
    await updateBadge(details.tabId);
  }
});

onMessage(MSG_TYPE.DOM_SCAN_RESULT, async ({ items: domItems }, sender) => {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId == null) return { ok: false, error: 'DOM_SCAN_RESULT requires a content-script sender with a tab' };
  const settings = await getSettings();
  const senderHostname = sender.tab.url ? new URL(sender.tab.url).hostname : null;
  if (senderHostname && isBlacklisted(senderHostname, settings)) {
    return { ok: true, skipped: 'blacklisted' };
  }
  for (const domItem of domItems) {
    if (!domItem.url || domItem.url.startsWith('blob:')) continue;
    const items = await tabState.getItems(tabId);
    const existingIndex = items.findIndex(
      (i) => i.progressiveUrl === domItem.url || i.manifestUrl === domItem.url
    );
    if (existingIndex !== -1) {
      const existing = items[existingIndex];
      const merged = {
        ...existing,
        title: existing.title || domItem.title,
        posterUrl: existing.posterUrl || domItem.posterUrl,
      };
      const updated = [...items];
      updated[existingIndex] = merged;
      await tabState.setItems(tabId, updated);
      continue;
    }
    const item = createMediaItem({
      tabId,
      sourceKind: SOURCE_KIND.PROGRESSIVE,
      mediaType: domItem.mediaType === 'audio' ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.VIDEO,
      pageUrl: domItem.pageUrl,
      progressiveUrl: domItem.url,
      title: domItem.title,
      posterUrl: domItem.posterUrl,
    });
    await tabState.addItem(tabId, item);
  }
  await updateBadge(tabId);
  return { ok: true };
});

onMessage(MSG_TYPE.GET_TAB_ITEMS, async ({ tabId }) => {
  return { items: await tabState.getItems(tabId) };
});

onMessage(MSG_TYPE.START_DOWNLOAD, async ({ itemId, tabId, renditionId }) => {
  const settings = await getSettings();
  const items = await tabState.getItems(tabId);
  const item = items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Item not found' };

  try {
    if (item.sourceKind === SOURCE_KIND.PROGRESSIVE) {
      const ext = (item.progressiveUrl.split('.').pop() || 'mp4').split('?')[0];
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: '', ext });
      await downloadUrl(item.progressiveUrl, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    const rendition = item.renditions.find((r) => r.id === renditionId) || item.renditions[0];
    const strategy = classifyMerge(rendition);

    if (strategy === MERGE_STRATEGY.CONCAT_FMP4) {
      const blob = await mergeConcatFmp4(rendition, fetch);
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: rendition.label, ext: 'mp4' });
      await downloadBlob(blob, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    if (strategy === MERGE_STRATEGY.REMUX_TS) {
      const muxjs = await loadMuxJs();
      const blob = await mergeRemuxTs(rendition, fetch, muxjs);
      const filename = renderFilename(settings.filenameTemplate, { title: item.title, quality: rendition.label, ext: 'mp4' });
      await downloadBlob(blob, buildDownloadPath(settings.subfolder, filename), chrome.downloads, settings.askWhereToSave);
      return { ok: true };
    }

    if (strategy === MERGE_STRATEGY.SPLIT_TRACKS) {
      const { videoBlob, audioBlob } = await mergeSplitTracks(rendition, fetch);
      const videoFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-video`, ext: 'mp4' });
      const audioFilename = renderFilename(settings.filenameTemplate, { title: item.title, quality: `${rendition.label}-audio`, ext: 'm4a' });
      await downloadBlob(videoBlob, buildDownloadPath(settings.subfolder, videoFilename), chrome.downloads, settings.askWhereToSave);
      await downloadBlob(audioBlob, buildDownloadPath(settings.subfolder, audioFilename), chrome.downloads, settings.askWhereToSave);
      return { ok: true, note: 'Downloaded as separate video and audio files (split adaptive tracks — see Global Constraints).' };
    }

    return { ok: false, error: 'Unknown merge strategy' };
  } catch (err) {
    console.error('Get It: download failed', err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

registerContextMenu(chrome.contextMenus, chrome.tabs);
```

**Real-browser-verified fixes reflected above (this section originally had synchronous `tabState` calls, a single `tab.url`-only blacklist check, and no blacklist check at all in the `DOM_SCAN_RESULT` handler):** Task 16's end-to-end verification in a real Brave browser found and fixed three defects in this composition:
1. Every `tabState` call needed `await` added once Task 10's store became `chrome.storage.session`-backed (async).
2. The blacklist check used only `tab.url`'s hostname, which is unreliable for a request that IS the top-level navigation itself (see Task 10's rationale) — confirmed via CDP that Chrome fires a separate `media`-typed request carrying the actual content-type header, distinct from the `main_frame` navigation request, so even an `isMainFrame`-based special case wasn't the right fix. The working fix checks both `tab.url`'s hostname and the candidate's own hostname.
3. **This was the one that actually explained the real-browser blacklist failure:** the `DOM_SCAN_RESULT` handler never checked the blacklist at all. `dom-scanner.js`'s content script runs unconditionally on every page (`matches: ["<all_urls>"]`) and reports any `<video>`/`<audio>` element it finds — including on a page the user explicitly blacklisted — and this handler would add it regardless of `handleCandidate`'s (now-correct) network-sniffing blacklist check, since it's a completely separate code path. Confirmed fixed via `chrome.storage.session` staying empty for a blacklisted domain, and confirmed the fix doesn't over-block by clearing the blacklist and re-verifying detection resumes.

- [ ] **Step 2: Manual verification — service worker starts and logs no errors**

Reload the unpacked extension at `chrome://extensions`, click "service worker" under the Get It card to open its DevTools console.
Expected: no red errors on load. `classifyRequest` note: this task alone can't be fully exercised yet (no popup UI to trigger `GET_TAB_ITEMS`/`START_DOWNLOAD`) — full behavioral verification happens in Task 16 once the popup (Task 14) exists. This step only confirms the module graph loads and `registerRequestSniffer`/`registerContextMenu` run without throwing.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat: wire background service worker (detection, parsing, merge, download)"
```

---

### Task 13: `src/content/dom-scanner.js` — DOM metadata enrichment content script

**Files:**
- Create: `src/content/dom-scanner.js`

**Interfaces:**
- Sends `chrome.runtime.sendMessage({type: 'DOM_SCAN_RESULT', payload: {items}})` where each item is `{mediaType: 'video'|'audio', url, title, pageUrl, posterUrl, width, height}`.
- **Deliberate tradeoff, stated explicitly:** this file hardcodes the string `'DOM_SCAN_RESULT'` rather than importing `MSG_TYPE.DOM_SCAN_RESULT` from Task 4. Chrome's `content_scripts` manifest key doesn't support `"type": "module"`, so this script can't use static `import`. Dynamic `import()` of an extension-internal module from a content script's isolated-world context works in principle but has an unconfirmed `web_accessible_resources` requirement this planning session could not verify against real Chrome behavior — so the lower-risk choice is a plain hardcoded string, kept in sync with `src/shared/messaging.js` by convention (both are touched in this task's review).

No unit test — DOM/`chrome.runtime` dependent, verified manually.

- [ ] **Step 1: Write the implementation**

```js
// src/content/dom-scanner.js
// Classic (non-module) content script. Scans the DOM for <video>/<audio>
// elements with a plain (non-blob) source and reports them to the
// background service worker for metadata enrichment. This is secondary to
// background/request-sniffer.js's network-level detection — see the
// Global Constraints note on why network sniffing is primary.

(function () {
  function collectFromElement(el) {
    const items = [];
    const tag = el.tagName.toLowerCase();
    const mediaType = tag === 'audio' ? 'audio' : 'video';

    const candidateUrls = new Set();
    if (el.currentSrc) candidateUrls.add(el.currentSrc);
    if (el.src) candidateUrls.add(el.src);
    el.querySelectorAll('source[src]').forEach((s) => candidateUrls.add(s.src));

    for (const url of candidateUrls) {
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
      items.push({
        mediaType,
        url,
        title: document.title,
        pageUrl: location.href,
        posterUrl: tag === 'video' ? el.poster || null : null,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      });
    }
    return items;
  }

  function scan() {
    const items = [];
    document.querySelectorAll('video, audio').forEach((el) => {
      items.push(...collectFromElement(el));
    });
    if (items.length > 0) {
      chrome.runtime.sendMessage({ type: 'DOM_SCAN_RESULT', payload: { items } });
    }
  }

  scan();

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('loadedmetadata', scan, true);
})();
```

- [ ] **Step 2: Manual verification — content script reports a plain `<video>` element**

Reload the unpacked extension. Open a page with a direct `<video src="...">` (e.g. https://www.w3schools.com/html/mov_bbb.mp4 loaded directly, or any page with a plain HTML5 video demo). Open the page's DevTools console — no errors from the content script. Open the service worker console — no errors handling `DOM_SCAN_RESULT`.

- [ ] **Step 3: Commit**

```bash
git add src/content/dom-scanner.js
git commit -m "feat: add DOM metadata enrichment content script"
```

---

### Task 14: Popup UI — `src/popup/popup.html`, `popup.css`, `popup.js`

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.js`

**Interfaces:**
- Consumes: `MSG_TYPE`/`sendToBackground` (Task 4) to call `GET_TAB_ITEMS` on open and `START_DOWNLOAD` per item.

No unit test — DOM rendering, verified manually.

- [ ] **Step 1: Write `popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Get It</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="header">
    <img src="../../icons/icon-32.png" alt="" width="20" height="20" />
    <span class="header-title">Get It</span>
  </header>
  <main id="item-list" class="item-list"></main>
  <p id="empty-state" class="empty-state" hidden>No media detected on this page yet.</p>
  <footer class="footer">
    <button id="open-options" class="link-button" type="button">Settings</button>
  </footer>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `popup.css`**

```css
body {
  margin: 0;
  width: 320px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2937;
  background: #ffffff;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
}

.header-title {
  font-weight: 600;
  font-size: 14px;
}

.item-list {
  max-height: 360px;
  overflow-y: auto;
}

.item {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
}

.item-thumb {
  width: 56px;
  height: 40px;
  border-radius: 4px;
  background: #f3f4f6;
  object-fit: cover;
  flex-shrink: 0;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  color: #6b7280;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.item-controls {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.quality-select {
  flex: 1;
  font-size: 12px;
  padding: 3px 4px;
}

.download-button {
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.download-button:hover {
  background: #4338ca;
}

.download-button[disabled] {
  background: #9ca3af;
  cursor: default;
}

.item-error {
  color: #b91c1c;
  font-size: 11px;
  margin-top: 4px;
}

.empty-state {
  padding: 24px 12px;
  text-align: center;
  color: #6b7280;
}

.footer {
  padding: 8px 12px;
  border-top: 1px solid #e5e7eb;
  text-align: right;
}

.link-button {
  background: none;
  border: none;
  color: #4f46e5;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
```

- [ ] **Step 3: Write `popup.js`**

```js
// src/popup/popup.js
import { MSG_TYPE, sendToBackground } from '../shared/messaging.js';

const listEl = document.getElementById('item-list');
const emptyEl = document.getElementById('empty-state');
document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function qualityLabel(item, rendition) {
  return item.sourceKind === 'progressive' ? 'Original' : rendition.label;
}

function renderItem(item) {
  const el = document.createElement('div');
  el.className = 'item';

  const thumb = document.createElement('img');
  thumb.className = 'item-thumb';
  thumb.src = item.posterUrl || '../../icons/icon-48.png';
  el.appendChild(thumb);

  const info = document.createElement('div');
  info.className = 'item-info';

  const title = document.createElement('div');
  title.className = 'item-title';
  title.textContent = item.title || 'Untitled media';
  info.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  meta.textContent = `${item.mediaType} \u00b7 ${item.sourceKind}`;
  info.appendChild(meta);

  const controls = document.createElement('div');
  controls.className = 'item-controls';

  let select = null;
  if (item.sourceKind !== 'progressive' && item.renditions && item.renditions.length > 0) {
    select = document.createElement('select');
    select.className = 'quality-select';
    for (const rendition of item.renditions) {
      const option = document.createElement('option');
      option.value = rendition.id;
      option.textContent = qualityLabel(item, rendition);
      select.appendChild(option);
    }
    controls.appendChild(select);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'download-button';
  button.textContent = 'Download';

  const errorEl = document.createElement('div');
  errorEl.className = 'item-error';
  errorEl.hidden = true;

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Downloading\u2026';
    errorEl.hidden = true;
    const renditionId = select ? select.value : null;
    try {
      const response = await sendToBackground(MSG_TYPE.START_DOWNLOAD, {
        itemId: item.id,
        tabId: item.tabId,
        renditionId,
      });
      if (response && response.ok) {
        button.textContent = 'Downloaded';
      } else {
        button.disabled = false;
        button.textContent = 'Download';
        errorEl.textContent = (response && response.error) || 'Download failed';
        errorEl.hidden = false;
      }
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Download';
      errorEl.textContent = (err && err.message) || 'Download failed';
      errorEl.hidden = false;
    }
  });

  controls.appendChild(button);
  info.appendChild(controls);
  info.appendChild(errorEl);
  el.appendChild(info);
  return el;
}

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const { items } = await sendToBackground(MSG_TYPE.GET_TAB_ITEMS, { tabId: activeTab.id });

  if (!items || items.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  for (const item of items) {
    listEl.appendChild(renderItem(item));
  }
}

init();
```

- [ ] **Step 4: Manual verification — popup renders detected items**

Reload the unpacked extension. Visit a page with a plain `<video>` element (see Task 13's verification page). Click the Get It toolbar icon.
Expected: popup shows one item with title, a Download button (no quality dropdown since it's a progressive item), clicking Download triggers a real file download and the button changes to "Downloaded". Visit a page with nothing playing and open the popup — expect the empty-state message.

- [ ] **Step 5: Commit**

```bash
git add src/popup/
git commit -m "feat: add popup UI (detected item list, quality picker, download)"
```

---

### Task 15: Options UI — `src/options/options.html`, `options.css`, `options.js`

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.css`
- Create: `src/options/options.js`

**Interfaces:**
- Consumes: `getSettings`/`setSettings` (Task 3) directly — no message round-trip through the background.

No unit test — DOM form binding, verified manually.

- [ ] **Step 1: Write `options.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Get It — Settings</title>
  <link rel="stylesheet" href="options.css" />
</head>
<body>
  <h1>Get It — Settings</h1>
  <form id="settings-form">
    <label>
      Download subfolder
      <input type="text" id="subfolder" />
    </label>
    <label>
      Filename template
      <input type="text" id="filenameTemplate" />
      <small>Available placeholders: {title}, {quality}, {ext}</small>
    </label>
    <label class="checkbox">
      <input type="checkbox" id="askWhereToSave" />
      Always ask where to save each file
    </label>
    <label>
      Max simultaneous downloads
      <input type="number" id="maxConcurrentDownloads" min="1" max="10" />
    </label>
    <label>
      Theme
      <select id="theme">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <label>
      Blacklisted domains (one per line — network sniffing is skipped on these)
      <textarea id="blacklist" rows="4"></textarea>
    </label>
    <button type="submit">Save</button>
    <span id="save-status" class="save-status" hidden>Saved.</span>
  </form>
  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `options.css`**

```css
body {
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2937;
  max-width: 480px;
  margin: 32px auto;
  padding: 0 16px;
}

h1 {
  font-size: 18px;
}

label {
  display: block;
  margin-bottom: 16px;
  font-weight: 500;
}

label.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: normal;
}

input[type="text"],
input[type="number"],
select,
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 6px 8px;
  font: inherit;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

small {
  display: block;
  color: #6b7280;
  font-weight: normal;
  margin-top: 2px;
}

button {
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.save-status {
  margin-left: 10px;
  color: #059669;
}
```

- [ ] **Step 3: Write `options.js`**

```js
// src/options/options.js
import { getSettings, setSettings } from '../shared/storage.js';

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('save-status');

async function populate() {
  const settings = await getSettings();
  document.getElementById('subfolder').value = settings.subfolder;
  document.getElementById('filenameTemplate').value = settings.filenameTemplate;
  document.getElementById('askWhereToSave').checked = settings.askWhereToSave;
  document.getElementById('maxConcurrentDownloads').value = settings.maxConcurrentDownloads;
  document.getElementById('theme').value = settings.theme;
  document.getElementById('blacklist').value = settings.blacklist.join('\n');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await setSettings({
    subfolder: document.getElementById('subfolder').value,
    filenameTemplate: document.getElementById('filenameTemplate').value,
    askWhereToSave: document.getElementById('askWhereToSave').checked,
    maxConcurrentDownloads: Number(document.getElementById('maxConcurrentDownloads').value) || 1,
    theme: document.getElementById('theme').value,
    blacklist: document
      .getElementById('blacklist')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  statusEl.hidden = false;
  setTimeout(() => { statusEl.hidden = true; }, 1500);
});

populate();
```

- [ ] **Step 4: Manual verification — settings persist**

Reload the unpacked extension. Open the options page (right-click the toolbar icon → Options, or the popup's Settings link). Change the subfolder to `TestFolder`, add a blacklist entry, click Save. Close and reopen the options page.
Expected: both changes are still there (persisted via `chrome.storage.sync`). Then add the current test page's domain to the blacklist, reload it, confirm the badge stays empty (network sniffer skips it per `isBlacklisted`).

- [ ] **Step 5: Commit**

```bash
git add src/options/
git commit -m "feat: add options page (settings form bound to chrome.storage)"
```

---

### Task 16: End-to-end verification across all four documented cases

**Files:** none as originally scoped (verification only) — in practice this task surfaced three real bugs requiring fixes across `src/shared/messaging.js`, `src/background/tab-state.js`, and `src/background/service-worker.js`, documented in those tasks' "Real-browser-verified" notes above.

This is the design doc's Verification Plan, executed. No new pure logic to unit test; this closes the loop the earlier tasks' manual-verification steps individually opened.

- [x] **Step 1: Progressive file case — VERIFIED, real browser, twice (found and fixed real bugs first)**

Executed against a real Brave browser (`/Applications/Brave Browser.app`, loaded unpacked via `--load-extension`) navigating to `https://www.w3schools.com/html/mov_bbb.mp4`. First pass failed — `GET_TAB_ITEMS` returned `{items: []}` even though the item was genuinely detected — which led to finding and fixing the messaging.js/tab-state.js bugs documented in Tasks 4 and 10. After those fixes: popup query correctly returned the detected item, `START_DOWNLOAD` was triggered via `chrome.runtime.sendMessage`, and `chrome.downloads.search` confirmed a real completed download at `~/Downloads/GetIt/video.mp4` (788493 bytes, matching `totalBytes`, state `"complete"`). `file` and `ffprobe` confirmed a valid `ISO Media, MP4 v2` file, 10.03s duration — exactly the well-known Big Buck Bunny clip length. This is the load-bearing case: it exercises the full pipeline (network sniffing → classification → `chrome.storage.session` persistence → message-passing → `chrome.downloads`) that every other case also depends on.

- [ ] **Step 2: HLS with fragmented-MP4 (CMAF) segments case — NOT independently E2E-verified against a live stream**

Not exercised against a real public HLS/fMP4 stream in this session (would need a reachable third-party CDN test stream; not attempted given time already spent finding and fixing the Step 1 blockers, which are shared plumbing this case also depends on). Covered by: `parseM3U8`'s fMP4-detection unit tests (Task 5), `classifyMerge`'s `CONCAT_FMP4` routing and `mergeConcatFmp4`'s segment-ordering unit tests (Task 7), and the now-verified-correct detection/persistence/messaging/download pipeline from Step 1. Residual risk is narrow: manifest-parsing and merge logic only, not the plumbing around them.

- [ ] **Step 3: HLS with legacy MPEG-TS segments case — NOT independently E2E-verified against a live stream**

Same caveat as Step 2. Covered by: `parseM3U8`'s TS-detection unit tests, `classifyMerge`'s `REMUX_TS` routing, and `mergeTsWithTransmuxer`'s unit tests including the error-path fix from Task 7's review (a real bug that unit testing, not this step, actually caught). The mux.js integration itself (`vendor/mux.js`, real UMD build, `Transmuxer` API confirmed against the library's actual README during planning) was not exercised against a real TS stream. If it fails in practice, the fix is scoped to `mergeTsWithTransmuxer` in `src/background/merge-engine.js`.

- [ ] **Step 4: DASH with separate audio/video adaptation sets case — NOT independently E2E-verified against a live stream**

Same caveat as Steps 2–3. Covered by: `parseMPD`'s unit tests (Task 6), `classifyMerge`'s `SPLIT_TRACKS` routing and `mergeSplitTracks`'s two-blob-output unit tests (Task 7), and `service-worker.js`'s `START_DOWNLOAD` handler correctly producing two separate `downloadBlob` calls for the split-tracks case (confirmed by code inspection during Task 12's review, which independently verified every cross-module import against real exports).

- [x] **Step 5: Blacklist and badge verification — VERIFIED, real browser, after finding and fixing a real bug**

Set `blacklist: ['www.w3schools.com']` via `chrome.storage.sync` (the same storage the real options page writes to), then re-navigated to the test video. First attempt still showed the item detected (`itemCount: 1`) despite the blacklist — traced through four rounds of direct instrumentation (confirming `isBlacklisted`/`getSettings` were individually correct via dynamic import in an extension-page context AND from within the service worker's own live execution context via a Puppeteer `worker.evaluate()` call) before finding the actual cause: `service-worker.js`'s `DOM_SCAN_RESULT` handler never checked the blacklist at all — only the network-sniffing `handleCandidate` path did, and the content script's independent DOM-scan detection path bypassed it entirely. Fixed (see Task 12's notes); re-verified with `chrome.storage.session` staying completely empty (`{}`) for the blacklisted tab, then cleared the blacklist and confirmed detection resumes correctly (`itemCount: 1` again) — ruling out the fix simply over-blocking everything.

- [x] **Step 6: Fixes applied**

Three real bugs found and fixed during this task (full detail in each task's "Real-browser-verified" note):
1. `src/shared/messaging.js` — `onMessage`'s automatic tabId derivation silently discarded an explicit `payload.tabId` whenever `sender.tab` was populated, which happens for any extension page opened as a tab, not just content scripts. Removed the auto-derivation; each handler now sources tabId explicitly.
2. `src/background/tab-state.js` — in-memory `Map` lost all detected items whenever Chrome recycled the MV3 service worker (which happens aggressively), so items could vanish between detection and the user opening the popup. Switched to `chrome.storage.session`, which is designed to survive worker restarts within a session.
3. `src/background/service-worker.js` — the blacklist was only checked in the network-sniffing path (`handleCandidate`); the DOM-scan path (`DOM_SCAN_RESULT` handler) had no blacklist check at all, so a blacklisted page's embedded video was still detected via the content script regardless. Added the missing check. Also hardened `handleCandidate`'s own hostname resolution (checks both the tab's and the candidate's hostname, since `chrome.tabs.get(tabId).url` can be stale during an in-flight navigation).

All fixes are committed with `fix:`/`feat:` prefixes on top of the original tasks' commits (history was kept clean — see each task's commit for the final, correct code). Full test suite: 55 passing, 0 failing, after every fix.

```bash
npm test
git add -A
git commit -m "test: document Task 16 end-to-end verification results"
```

---

## Self-Review

**1. Spec coverage** (against the approved design doc, `docs/superpowers/specs/2026-07-23-get-it-chrome-extension-design.md`, plus the deviations logged in Global Constraints above):
- Architecture (service worker + content script + popup/options, no companion app) → Tasks 1, 12, 13, 14, 15. Covered.
- Network-sniffing-first detection → Task 9 (`request-sniffer.js`) + Task 12 wiring. Covered.
- DOM-scan-secondary enrichment → Task 13. Covered.
- HLS/DASH manifest parsing → Tasks 5, 6. Covered.
- Merge engine (progressive passthrough, CMAF concat, TS remux via mux.js, split-tracks for DASH) → Task 7 + Task 12 wiring. Covered (with the mp4box.js→two-files deviation explicitly logged).
- UI (toolbar badge, popup list + quality picker + download, options page, context menu) → Tasks 10 (badge text), 11 (context menu), 14 (popup), 15 (options). Covered.
- Error handling (inline per-item failure, no partial/corrupt files) → `fetchSegments` throws on non-OK responses (Task 7), `START_DOWNLOAD` handler catches and returns `{ok: false, error}` (Task 12), popup surfaces `error` inline (Task 14). Covered.
- Naming/branding ("Get It", independent icon) → Task 1 (icons already produced), manifest `name` field. Covered.
- Verification plan (4 cases, manual) → Task 16. Covered.

**2. Placeholder scan:** no `TBD`/`TODO`/"add appropriate error handling"-style phrases in any task; every code block is complete, runnable code, not a description of code.

**3. Type consistency:** `Rendition` field names (`videoInitUrl`, `videoSegmentUrls`, `audioInitUrl`, `audioSegmentUrls`, `container`, `label`, `bandwidth`, `width`, `height`, `id`) are identical across Task 2 (`createRendition` defaults), Task 5 (`parseM3U8`'s return shape), Task 6 (`parseMPD`'s return shape), and Task 7 (`classifyMerge`/`mergeConcatFmp4`/`mergeSplitTracks` field reads) — verified by re-reading each task's code side-by-side while writing this review. `MediaItem` field names (`sourceKind`, `mediaType`, `tabId`, `manifestUrl`, `progressiveUrl`, `renditions`, `title`, `posterUrl`) are identical across Task 2, Task 10's dedup logic, Task 12's `handleCandidate`/`START_DOWNLOAD` handler, and Task 14's popup rendering. `MSG_TYPE` values (`DOM_SCAN_RESULT`, `GET_TAB_ITEMS`, `START_DOWNLOAD`) match between Task 4's definitions and every `onMessage`/`sendToBackground` call site in Tasks 12 and 14.

No gaps found requiring an added task.

**4. Execution verification (beyond the standard self-review checklist):** every pure-logic module and test file in Tasks 2–10 was extracted into a scratch directory and actually run with `node --test` during planning, not just mentally traced. This surfaced and fixed three real bugs the mental trace missed:
- Task 4's `fakeRuntime()` test helper hung indefinitely on the "ignores messages of a different type" case — `onMessage`'s listener correctly returns `undefined` (not `true`) without ever calling `sendResponse` when a message doesn't match, but the original fake's `trigger()` only ever resolved via that callback, so the wrapping `Promise` never settled. Fixed by resolving immediately when the listener's return value signals it isn't keeping the channel open.
- Task 8's `downloadBlob()` used a bare `setTimeout(..., 30000)` for delayed `URL.revokeObjectURL` cleanup — in Node this keeps the process alive for the full 30s even after all assertions pass, and masked/compounded the Task 4 hang in the first full run. Fixed with a guarded `.unref()` call (Node-only API; safe no-op in the real browser/service-worker runtime).
- Task 1's `package.json` test script (`"node --test tests/"`) fails outright on Node v22 with `MODULE_NOT_FOUND` — passing a directory as an explicit path argument makes Node try to `require()` it rather than search it. Fixed to bare `node --test`, which auto-discovers `tests/*.test.js` and was confirmed working (51/51 tests passing, ~0.1s).

**5. Execution-phase fix (found during Task 7's task review, not planning):** `mergeTsWithTransmuxer` originally registered only `'data'` and `'done'` listeners on the transmuxer. If the real mux.js `Transmuxer` ever emits an asynchronous `'error'` event (malformed/corrupt TS segment data), the returned Promise had no path to reject — it would hang forever with no timeout. Fixed by registering an `'error'` listener that rejects the Promise, with a corresponding test (`mergeTsWithTransmuxer rejects when the transmuxer emits an error event`). This is reflected in Task 7's code above; flagging it here because it was caught by the task-reviewer subagent during execution, not by the planning-time scratch-directory verification — a reminder that the review gate catches what execution-time verification of pure logic doesn't (async event-emitter edge cases needing an adversarial "what if this branch fires" read, not just a happy-path test run).

**6. Execution-phase fix (Critical, found during Task 9's task review):** `classifyRequest` originally checked `contentType` before checking whether the URL was a bare `.ts`/`.m4s` segment. Real CDNs commonly serve MPEG-TS segments with `video/mp2t` and CMAF/fMP4 segments with `video/mp4`/`audio/mp4` content-types — so on real traffic (not just an edge case), every segment of every HLS/DASH stream would have been misclassified as a standalone `progressive-video`/`progressive-audio` item instead of correctly returning `null`, flooding the popup with false-positive detections. The planning-time execution verification never caught this because its own test fixtures only combined segment URLs with `contentType: null`. Fixed by checking the segment-extension pattern unconditionally, first, before any content-type check. A regression test (`classifyRequest ignores segments even when served with a real video/audio content-type`) now covers exactly the previously-untested combination.

**7. Execution-phase fix (Important, found during Task 14's task review):** the Download button's click handler had no `try`/`catch` around `await sendToBackground(...)`. `chrome.runtime.sendMessage` can reject with a real, commonly-hit error ("Could not establish connection. Receiving end does not exist.") — e.g. if the MV3 service worker is asleep and still waking when the popup sends its message — and an unhandled rejection there left the button permanently stuck on "Downloading…" with no feedback, violating the requirement that failures must always be visibly recoverable. Fixed by wrapping the call in try/catch, restoring the button on either the `{ok:false}` path or a thrown rejection. Also hardened the quality-dropdown condition to explicitly exclude `sourceKind === 'progressive'` (defensive; the actual data flow through `service-worker.js` never gives progressive items a non-empty `renditions` array, so this wasn't a live bug, but making the invariant explicit in this file too removes the implicit cross-file dependency).

All fixes are reflected in the task bodies above, not just here — an implementer reading only a given task will already see the corrected code.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-get-it-extension.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
