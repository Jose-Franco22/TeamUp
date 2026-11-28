import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSecret } from './secret.js';

test('the same secret matches', async () => {
  assert.equal(await sameSecret('s3cret-value', 's3cret-value'), true);
});

test('a different secret, a prefix, or a longer one does not', async () => {
  assert.equal(await sameSecret('s3cret-valuf', 's3cret-value'), false);
  assert.equal(await sameSecret('s3cret', 's3cret-value'), false);
  assert.equal(await sameSecret('s3cret-value-and-more', 's3cret-value'), false);
});

test('a missing header or an unset secret never matches', async () => {
  assert.equal(await sameSecret('', 's3cret-value'), false);
  assert.equal(await sameSecret(null, 's3cret-value'), false);
  assert.equal(await sameSecret('', ''), false);
  assert.equal(await sameSecret('anything', undefined), false);
});
