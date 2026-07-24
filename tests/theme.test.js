import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme } from '../src/shared/theme.js';

test('applyTheme sets data-theme="dark" for dark theme', () => {
  const root = { dataset: {} };
  applyTheme('dark', root);
  assert.equal(root.dataset.theme, 'dark');
});

test('applyTheme sets data-theme="light" for light theme', () => {
  const root = { dataset: {} };
  applyTheme('light', root);
  assert.equal(root.dataset.theme, 'light');
});

test('applyTheme removes data-theme for "system" theme', () => {
  const root = { dataset: { theme: 'dark' } };
  applyTheme('system', root);
  assert.equal('theme' in root.dataset, false);
});

test('applyTheme removes data-theme for unrecognised theme values', () => {
  const root = { dataset: { theme: 'dark' } };
  applyTheme('some-unknown-value', root);
  assert.equal('theme' in root.dataset, false);
});
