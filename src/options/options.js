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
