// src/shared/theme.js
//
// Applies the user's theme preference by toggling a data-theme attribute on
// the document root. 'system' leaves the attribute unset entirely, so the
// CSS's prefers-color-scheme media query controls appearance; 'light'/'dark'
// set the attribute explicitly, which the CSS gives precedence over the
// media query (see popup.css/options.css's `:root:not([data-theme="light"])`
// media-query guard).
export function applyTheme(theme, root = document.documentElement) {
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}
