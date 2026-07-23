# Get It — Video Downloader Extension — Design

**Date:** 2026-07-23
**Status:** Approved (conversational) — pending written-spec review

## Purpose

A personal-use browser extension that detects playable video/audio media on any web page and downloads it, modeled on downloadhelper.net's feature set and UI/UX (icon badge → popup list → quality picker → download), but independently named and branded, and rescoped to what a single self-contained browser extension can realistically and legally do without a native companion app.

## Non-goals (explicitly out of scope)

- **Not published to any store.** Unpacked/side-loaded only. This is why site-targeting decisions below can be more aggressive than a store-published clone could be — but it does NOT change what's technically achievable or what each site's own Terms of Service permit.
- **No native companion app.** The real Video DownloadHelper pairs its browser extension with a locally-installed native binary (`vdhcoapp`, using ffmpeg via Native Messaging) to do segment merging and format conversion. This design deliberately rejects that model — everything happens inside the extension (background service worker + WASM/JS libraries), trading some format/robustness ceiling for a zero-install, single-artifact tool.
- **No per-site extractors.** No YouTube/Instagram/TikTok/Facebook/Twitter-specific reverse-engineered extraction logic. Those platforms use signed/rotating URLs, cipher schemes, and per-track adaptive manifests that require constant reverse-engineering maintenance as the platforms change — declined as an ongoing maintenance burden regardless of personal-use legal risk tolerance.
- **No premium/paywall tier, no licensing backend, no accounts.** Everything the extension can do is available directly, unlimited.
- **No in-extension download history page.** `chrome://downloads` already provides this; duplicating it adds no value.
- **No ffmpeg.wasm / arbitrary transcoding.** Only container-level remux/mux of already-encoded streams (see Merge Engine below) — never re-encoding video/audio.

## Target platforms

Manifest V3, unpacked. Runs unmodified on **Chrome, Brave, and Edge** — all Chromium, all consuming the same MV3 APIs and manifest. Brave support was an explicit ask; it requires zero extra engineering since Brave is Chromium-based. Firefox is out of scope (different manifest/APIs, would need a second build target).

## Architecture

Three components, no backend:

1. **Service worker (background)** — owns per-tab detected-media state, sniffs network requests, drives downloads and merging.
2. **Content script** (all frames) — DOM scan for `<video>`/`<audio>`/`<source>` elements; secondary/enrichment role only (thumbnail, title, dimensions).
3. **Popup UI + Options page** — plain HTML/CSS/vanilla JS (or Preact if popup state grows unwieldy; decide during implementation, not a spec-level commitment).

## Detection

**Network-request-sniffing is the primary detection mechanism, not DOM scanning.** This is the single most important technical decision in this design, and it deviates from what a naive clone would do.

Rationale: most modern video players (video.js, hls.js, Shaka Player, dash.js, and most large sites' custom players) feed video into a `<video>` element via the MediaSource Extensions API. In that case `video.src` is a `blob:https://...` URL that only exists in the page's JS heap — the extension cannot re-fetch it over the network. DOM-scanning-first designs miss the majority of real sites for this reason.

Instead:
- `chrome.webRequest.onBeforeRequest` / `onHeadersReceived` — **non-blocking/observational** (still fully available under MV3; only *blocking* webRequest that modifies/cancels requests is restricted) — watches every request per-tab for:
  - URL patterns: `.mp4`, `.webm`, `.m3u8`, `.mpd`, `.m4s`, `.ts`, `.mp3`, `.m4a`
  - `Content-Type` headers: `video/*`, `audio/*`, `application/vnd.apple.mpegurl`, `application/dash+xml`
- `.m3u8` (HLS) and `.mpd` (DASH) hits are fetched and parsed to enumerate available renditions (bitrate/resolution variants; for DASH, separate audio-only vs video-only adaptation sets).
- Content script DOM scan runs independently and merges into the same per-tab item list purely for metadata enrichment (poster thumbnail, inferred title, `videoWidth`/`videoHeight`) when it can find a plain `<video src="...">`.
- Toolbar badge = count of distinct detected media items for the active tab; icon dims when the tab has none.

**Known v1 limitation (deferred, not silently dropped):** content built purely from in-memory blobs with no corresponding network manifest/segment traffic (rare, but exists) is undetectable without injecting a `world: "MAIN"` content script to hook `MediaSource`/`URL.createObjectURL` in the page's own JS context. Explicitly out of scope for v1; documented here as the known fast-follow if it turns out to matter in practice.

## Download & merge engine

Layered by what the detected media actually is:

| Case | Handling |
|---|---|
| Direct progressive file (`.mp4`, `.webm`, `.mp3`, etc.) | `chrome.downloads.download()` directly. No processing. |
| HLS/DASH with fragmented-MP4 (CMAF) segments | Plain sequential `Blob` concatenation — valid by container design (init segment + ordered media segments = playable MP4). No library needed. |
| Legacy MPEG-TS HLS segments | Remuxed to fragmented MP4 via **mux.js** (video.js/Mux ecosystem, actively maintained). Raw `.ts` concatenation is often playable but inconsistent outside VLC, so this is remuxed rather than just concatenated. |
| DASH with separate audio-only + video-only adaptation sets | Combined into one file via **mp4box.js** (GPAC's ISO-BMFF library) — container-level track combination of already-encoded streams, no re-encoding. |

Quality/format dropdown in the popup is populated from parsed manifest renditions; a plain single-file detection just shows one option.

## UI

- **Toolbar icon**: badge = detected count; dims to gray/neutral when the active tab has nothing.
- **Popup** (on icon click): list of detected items for the current tab — thumbnail (from content-script metadata, generic fallback icon otherwise), inferred title, type tag (video/audio), quality/format dropdown, per-item Download button. Empty state when nothing is detected.
- **Options page**: download subfolder pattern + filename template (e.g. `{title}-{quality}.{ext}`), "always ask where to save" toggle, per-domain blacklist (skip network sniffing on specified domains), max simultaneous downloads, theme (light/dark/system).
- **Context menu**: right-click a video element → "Download this video" via `chrome.contextMenus`.

## Error handling

Per-item state surfaces failures inline in the popup rather than failing silently or producing a corrupted file:
- Manifest fetch failure or expired/rotated signed segment URLs → item shows an inline error with a "refresh page and retry" hint.
- Segment fetch failure mid-merge → abort that item's download entirely (never emit a partial/corrupt file) and offer a retry action.

## Naming/branding

Extension name: **"Get It"**. Independent branding (name, icon, color scheme) from Video DownloadHelper — the UI *layout and interaction model* is what's being cloned (icon badge → popup list → quality picker → download flow), not their trademark or visual assets.

## Verification plan

No automated test suite for v1 — this is a UI-driven personal browser tool, and the meaningful verification is behavioral: load unpacked in Chrome, exercise it against a handful of real sites covering each of the four cases in the merge-engine table above (plain `<video src>`, HLS/CMAF, HLS/TS, DASH with split audio/video tracks), and confirm the popup detects items and produced downloads are playable.

## Self-review notes

- Placeholder scan: none found — every section has concrete decisions, no TBD/TODO.
- Internal consistency: merge-engine table aligns with the "no ffmpeg.wasm" non-goal (mux.js/mp4box.js are container-level remux/mux libraries, not transcoders). Detection section's "network-sniffing-first, DOM-scanning-secondary" is consistent with the blob-URL limitation called out in both the Detection section and the Non-goals section.
- Scope check: single cohesive project (one extension, one team of components) — no decomposition into independent sub-specs needed.
- Ambiguity check: "generic detection only" is made concrete by the explicit URL-pattern/Content-Type list; "no premium" is made concrete by "everything unlimited, no backend."
