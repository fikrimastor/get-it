# Get It

A personal-use Manifest V3 browser extension that detects playable video/audio media on any web page and downloads it — modeled on downloadhelper.net's UI/UX (icon badge → popup list → quality picker → download), independently named and branded.

Runs unmodified on **Chrome, Brave, and Edge** (all Chromium/MV3). Not published to any store — install by loading the unpacked source.

## Features

- **Network-first detection**: non-blocking `chrome.webRequest` sniffing for direct media, HLS (`.m3u8`), and DASH (`.mpd`) manifests, enriched by a DOM content-script scan for `<video>`/`<audio>` metadata (thumbnail, title, dimensions).
- **Download & merge engine**:
  - Direct progressive files (`.mp4`, `.webm`, `.mp3`, …) — downloaded as-is.
  - HLS/DASH with fragmented-MP4 (CMAF) segments — concatenated directly.
  - Legacy MPEG-TS HLS — remuxed to fragmented MP4 with the vendored `mux.js`.
  - DASH with separate audio/video adaptation sets — combined with `mp4box.js`.
- **Popup UI**: per-tab detected media list with quality/format picker and per-item download.
- **Options page**: download subfolder + filename template, "always ask where to save," per-domain blacklist, max simultaneous downloads (1–10), theme (light/dark/system).
- **Context menu**: right-click a video element → "Download this video."

## Non-goals

No native companion app, no per-site extractors (YouTube/Instagram/TikTok/etc.), no premium tier or accounts, no DRM bypass, no arbitrary transcoding — only container-level remux/mux of already-encoded streams. See `docs/superpowers/specs/2026-07-23-get-it-chrome-extension-design.md` for full rationale.

## Installation

1. Clone this repository:
   ```bash
   git clone git@github.com:fikrimastor/get-it.git
   ```
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** (toggle, usually top-right).
4. Click **Load unpacked**.
5. Select the cloned `get-it` folder (the one containing `manifest.json`).
6. The **Get It** icon appears in the toolbar. Pin it for quick access via the puzzle-piece menu.

To update after pulling new changes, go back to the extensions page and click the reload icon on the Get It card (or toggle it off/on).

## Usage

1. Open a page with playable video/audio.
2. Click the **Get It** toolbar icon — detected media appear in a list with type, thumbnail, and quality/format options.
3. Pick a quality/format if more than one is available, then click **Download**.
4. Configure subfolder, filename template, save prompt, blacklist, concurrency limit, and theme from the extension's **Options** page (gear icon in the popup footer, or right-click the toolbar icon → *Options*).

## Development

Requires [Node.js](https://nodejs.org/) (native `node:test`, no external test runner).

```bash
npm test
```

Runs the full unit test suite (`tests/*.test.js`) covering parsers, merge engine, storage, detection classification, tab state, messaging, and theming.

## Limitations

- Detection misses media built purely from in-memory blobs with no corresponding network manifest/segment traffic (rare) — this would require a `world: "MAIN"` content script hooking `MediaSource`/`URL.createObjectURL`, deliberately out of scope for v1.
- Live HLS-fMP4/HLS-TS/DASH downloads have been verified against a mix of unit tests and a real progressive-MP4 browser smoke test; broader real-CDN adaptive-stream verification is ongoing.
- DRM-protected content cannot be downloaded.

## License

Personal-use project. No license granted for redistribution.
