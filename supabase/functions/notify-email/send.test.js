// Issue #21 — sending through Resend: failures are logged and retried, and
// retries can't double-send. Resend is never called: send() is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, resendRequest, sendWithRetry } from './send.js';

const response = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body });

// A fake send() that answers from a script, one entry per call; an Error
// entry is thrown, as fetch() does when the network is down.
function scripted(...answers) {
  const calls = [];
  const send = async () => {
    calls.push(Date.now());
    const next = answers[calls.length - 1];
    if (next instanceof Error) throw next;
    return response(next, `body ${next}`);
  };
  return { send, calls };
}

const quiet = () => {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
};
const noSleep = { sleep: async () => {} };

test('sends once when Resend accepts', async () => {
  const { send, calls } = scripted(200);
  const { log, lines } = quiet();
  const result = await sendWithRetry(send, { ...noSleep, log });
  assert.deepEqual(result, { ok: true, status: 200, body: 'body 200', attempts: 1 });
  assert.equal(calls.length, 1);
  assert.equal(lines.length, 0);
});

test('a 500, a 429 and a network error are each logged and retried', async () => {
  const { send, calls } = scripted(500, 429, new Error('connection reset'), 200);
  const { log, lines } = quiet();
  const result = await sendWithRetry(send, { ...noSleep, log, attempts: 4, label: 'notification n1' });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 4);
  assert.equal(calls.length, 4);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /notification n1: Resend answered 500 \(attempt 1\/4\)/);
  assert.match(lines[1], /answered 429/);
  assert.match(lines[2], /could not reach Resend .*connection reset/);
});

test('gives up after the last attempt, without throwing', async () => {
  const { send, calls } = scripted(503, 503, 503);
  const { log, lines } = quiet();
  const result = await sendWithRetry(send, { ...noSleep, log });
  assert.deepEqual(result, { ok: false, status: 503, body: 'body 503', attempts: 3 });
  assert.equal(calls.length, 3);
  assert.equal(lines.length, 3);
});

test('a 4xx that retrying cannot fix is not retried', async () => {
  const { send, calls } = scripted(422, 200);
  const { log, lines } = quiet();
  const result = await sendWithRetry(send, { ...noSleep, log });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(calls.length, 1);
  assert.equal(lines.length, 1);
});

test('waits longer before each retry', async () => {
  const waits = [];
  const { send } = scripted(500, 500, 200);
  await sendWithRetry(send, { sleep: async (ms) => waits.push(ms), log: () => {}, baseDelayMs: 100 });
  assert.deepEqual(waits, [100, 200]);
});

test('one email: POST /emails with an idempotency key', () => {
  const { url, init } = resendRequest({
    apiKey: 're_test',
    idempotencyKey: 'notification-abc',
    email: { from: 'TeamUp <a@b.c>', to: 'x@utrgv.edu', subject: 's', text: 't', html: 'h' },
  });
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer re_test');
  assert.equal(init.headers['Idempotency-Key'], 'notification-abc');
  assert.equal(JSON.parse(init.body).to, 'x@utrgv.edu');
});

test('a batch: POST /emails/batch with one address per email', () => {
  const emails = [{ to: 'a@utrgv.edu' }, { to: 'b@utrgv.edu' }];
  const { url, init } = resendRequest({ apiKey: 'k', idempotencyKey: 'announcement-1-0', emails });
  assert.equal(url, 'https://api.resend.com/emails/batch');
  assert.deepEqual(JSON.parse(init.body), emails);
});

test('chunk splits into Resend-sized batches', () => {
  const list = Array.from({ length: 250 }, (_, i) => i);
  assert.deepEqual(chunk(list).map((c) => c.length), [100, 100, 50]);
  assert.deepEqual(chunk([]), []);
});
