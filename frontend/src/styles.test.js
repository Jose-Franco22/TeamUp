// The app-wide link colour. Without a rule, links fell back to the browser's
// #0000EE / #551A8B, unreadable on dark mode's --paper. jsdom cascades the
// stylesheet, but by source order only: it ignores specificity and @media,
// never resolves var() and never matches :visited. So these check which
// declaration a plain link gets, and read the rule itself for the rest.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const CSS = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');

let style;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
});
afterEach(() => {
  style.remove();
  document.body.innerHTML = '';
});

test('a plain link takes --link', () => {
  document.body.innerHTML = '<a href="/admin/teams/t-1">Campus parking tracker</a>';
  expect(getComputedStyle(document.querySelector('a')).color).toBe('var(--link)');
});

test('visited links are given the same colour as unvisited ones', () => {
  const rule = [...style.sheet.cssRules].find((r) => r.selectorText?.includes('a:visited'));
  expect(rule.selectorText).toContain('a:link');
  expect(rule.style.color).toBe('var(--link)');
});

// a:visited alone outranks .btn, so a visited button-styled link would turn
// orange. The whole selector sits in :where(), which counts for nothing.
// (jsdom can't show this by cascade: it ignores specificity.)
test('the link rule has zero specificity, so any class rule (.btn, .nav a, .mark) beats it', () => {
  const rule = [...style.sheet.cssRules].find((r) => r.selectorText?.includes('a:visited'));
  expect(rule.selectorText).toMatch(/^:where\([^)]*\)$/);
});

// --- contrast ------------------------------------------------------------------
// jsdom never resolves var(), so the tokens are read straight out of the
// stylesheet and the WCAG 2.x ratio is computed here. Change a token in either
// theme and this is what fails. Links sit on --paper (cards, tables) and on
// --canvas (the page, table headers); the admin row-hover tint is a mix of the
// two, so it falls between them and passing both covers it.

function tokens(selector) {
  const start = CSS.indexOf(`${selector} {`);
  const block = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = tokens(':root');
const DARK = { ...LIGHT, ...tokens(":root[data-theme='dark']") };

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('in the %s theme', (_, t) => {
  test('--link is defined for this theme', () => {
    expect(t.link).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test.each(['paper', 'canvas'])('links reach 4.5:1 (WCAG AA) on --%s', (bg) => {
    expect(contrast(t.link, t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

// Not a rule, a record of why --link exists at all: if --open ever clears AA
// on both backgrounds in both themes, --link can go and links can use --open.
test('--open alone falls short somewhere, which is why links use --link', () => {
  const ratios = [LIGHT, DARK].flatMap((t) => [contrast(t.open, t.paper), contrast(t.open, t.canvas)]);
  expect(Math.min(...ratios)).toBeLessThan(4.5);
});
