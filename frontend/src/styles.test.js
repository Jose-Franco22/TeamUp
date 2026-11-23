// The app-wide link colour. Without a rule, links fell back to the browser's
// #0000EE / #551A8B, unreadable on dark mode's --paper. jsdom cascades the
// stylesheet, but by source order only: it ignores specificity and @media,
// never resolves var() and never matches :visited. So these check which
// declaration a plain link gets, and read the rule itself for the rest.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

let style;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
  document.head.append(style);
});
afterEach(() => {
  style.remove();
  document.body.innerHTML = '';
});

test('a plain link takes --open', () => {
  document.body.innerHTML = '<a href="/admin/teams/t-1">Campus parking tracker</a>';
  expect(getComputedStyle(document.querySelector('a')).color).toBe('var(--open)');
});

test('visited links are given the same colour as unvisited ones', () => {
  const rule = [...style.sheet.cssRules].find((r) => r.selectorText?.includes('a:visited'));
  expect(rule.selectorText).toContain('a:link');
  expect(rule.style.color).toBe('var(--open)');
});

// a:visited alone outranks .btn, so a visited button-styled link would turn
// orange. The whole selector sits in :where(), which counts for nothing.
// (jsdom can't show this by cascade: it ignores specificity.)
test('the link rule has zero specificity, so any class rule (.btn, .nav a, .mark) beats it', () => {
  const rule = [...style.sheet.cssRules].find((r) => r.selectorText?.includes('a:visited'));
  expect(rule.selectorText).toMatch(/^:where\([^)]*\)$/);
});
