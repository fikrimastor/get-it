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
