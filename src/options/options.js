// src/options/options.js
import { getSettings, setSettings } from '../shared/storage.js';
import { applyTheme } from '../shared/theme.js';

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('save-status');
const themeSelect = document.getElementById('theme');

async function populate() {
  const settings = await getSettings();
  document.getElementById('subfolder').value = settings.subfolder;
  document.getElementById('filenameTemplate').value = settings.filenameTemplate;
  document.getElementById('maxConcurrentDownloads').value = settings.maxConcurrentDownloads;
  document.getElementById('askWhereToSave').checked = settings.askWhereToSave;
  themeSelect.value = settings.theme;
  document.getElementById('blacklist').value = settings.blacklist.join('\n');
  applyTheme(settings.theme);
}

themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await setSettings({
    subfolder: document.getElementById('subfolder').value,
    filenameTemplate: document.getElementById('filenameTemplate').value,
    maxConcurrentDownloads: Math.min(
      10,
      Math.max(1, Math.trunc(Number(document.getElementById('maxConcurrentDownloads').value) || 1))
    ),
    askWhereToSave: document.getElementById('askWhereToSave').checked,
    theme: themeSelect.value,
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
