// Issue #26 — the email a project creator gets when someone asks to join.
// Run with `node --test supabase/functions/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEmail } from './email.js';

const base = {
  kind: 'join_request',
  actorName: 'Ana Villarreal',
  projectTitle: 'Campus parking tracker',
  appUrl: 'https://teamup.example.app',
};

test('names the requester and the project', () => {
  const email = composeEmail(base);
  assert.equal(email.subject, 'Ana Villarreal asked to join Campus parking tracker');
  assert.match(email.text, /Ana Villarreal asked to join “Campus parking tracker”/);
  assert.match(email.html, /Ana Villarreal asked to join “Campus parking tracker”/);
});

test('links to the Requests page', () => {
  const email = composeEmail(base);
  assert.match(email.text, /https:\/\/teamup\.example\.app\/requests\n/);
  assert.match(email.html, /<a href="https:\/\/teamup\.example\.app\/requests">/);
});

test('a trailing slash on the app URL does not double up', () => {
  const email = composeEmail({ ...base, appUrl: 'https://teamup.example.app/' });
  assert.match(email.text, /https:\/\/teamup\.example\.app\/requests\n/);
});

test('names and titles are escaped in the HTML', () => {
  const email = composeEmail({ ...base, actorName: '<b>Eve</b>', projectTitle: 'Tom & Jerry' });
  assert.match(email.html, /&lt;b&gt;Eve&lt;\/b&gt; asked to join “Tom &amp; Jerry”/);
  assert.doesNotMatch(email.html, /<b>/);
});

test('other kinds are not emailed', () => {
  for (const kind of ['member_left', 'member_removed', 'request_accepted', 'request_declined']) {
    assert.equal(composeEmail({ ...base, kind }), null);
  }
});
