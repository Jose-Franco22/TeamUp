// Shared-secret checks for the Edge Functions that are called by a webhook
// or a Cron job rather than a signed-in user (notify-email, sync-faculty).
//
// Compared as SHA-256 digests, in constant time, so the response time says
// nothing about how much of a guess was right. Hashing first also makes the
// two inputs the same length, so the loop below never ends early.
//
// Plain JavaScript on Web Crypto, so it runs the same under Deno and under
// `node --test` in CI.
export async function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected === '') return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
