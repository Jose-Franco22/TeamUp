// Sending through Resend, with retries. No Deno here either, so
// send.test.js can run it under `node --test` with a fake fetch.

const RESEND = 'https://api.resend.com';
// Resend's batch endpoint takes at most 100 emails per call.
export const BATCH_SIZE = 100;

// The request for one email (to is a single address) or, when emails is an
// array, a batch where each entry has its own `to`. The idempotency key makes
// Resend drop a repeat of the same request for 24 hours, so a retry here, or
// the database webhook firing twice, can't email anyone twice.
export function resendRequest({ apiKey, idempotencyKey, email, emails }) {
  const batch = Array.isArray(emails);
  return {
    url: `${RESEND}/emails${batch ? '/batch' : ''}`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(batch ? emails : email),
    },
  };
}

// Worth trying again: rate limited, or Resend having a bad moment. A 4xx
// otherwise (bad address, bad key) will fail the same way every time.
const retryable = (status) => status === 429 || status >= 500;

// Calls send() until it succeeds, it fails in a way retrying won't fix, or
// attempts run out. Waits baseDelayMs, then twice that, and so on between
// tries. Every failure is logged. Never throws: returns
// { ok, status, body, attempts }, where status is 0 for a network error.
export async function sendWithRetry(
  send,
  { attempts = 3, baseDelayMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.error, label = 'email' } = {}
) {
  let last = { ok: false, status: 0, body: '' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await send();
      const body = await res.text();
      if (res.ok) return { ok: true, status: res.status, body, attempts: attempt };
      last = { ok: false, status: res.status, body };
      log(`[notify-email] ${label}: Resend answered ${res.status} (attempt ${attempt}/${attempts}): ${body}`);
      if (!retryable(res.status)) return { ...last, attempts: attempt };
    } catch (err) {
      last = { ok: false, status: 0, body: String(err?.message ?? err) };
      log(`[notify-email] ${label}: could not reach Resend (attempt ${attempt}/${attempts}): ${last.body}`);
    }
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return { ...last, attempts };
}

export function chunk(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
