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
