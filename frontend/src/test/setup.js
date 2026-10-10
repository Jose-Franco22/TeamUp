// Runs before every test file (see `test.setupFiles` in vite.config.js).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no matchMedia; ThemeProvider uses it to pick light or dark.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

// React Router v6 prints v7 upgrade notices on every render; they're not
// about anything a test checks, so keep them out of the output.
const warn = console.warn;
console.warn = (...args) => {
  if (String(args[0]).includes('React Router Future Flag Warning')) return;
  warn(...args);
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
