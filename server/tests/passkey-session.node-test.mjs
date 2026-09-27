import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { authMiddleware } from '../middleware/auth.ts';

const secret = 'test-session-secret-that-is-at-least-32-characters';
const previousSecret = process.env.SESSION_SECRET;

function token(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

function responseStub() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

test('accepts a valid passkey session bearer token', async () => {
  process.env.SESSION_SECRET = secret;
  const req = { header: (name) => name === 'Authorization' ? `Bearer ${token({ sub: 'account-1', username: 'alice', exp: Math.floor(Date.now() / 1000) + 60 })}` : null };
  const res = responseStub();
  let called = false;
  await authMiddleware(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.authenticatedUser.id, 'account-1');
});

test('rejects a modified passkey session bearer token', async () => {
  process.env.SESSION_SECRET = secret;
  const signed = token({ sub: 'account-1', exp: Math.floor(Date.now() / 1000) + 60 });
  const tampered = `${signed.slice(0, -1)}${signed.endsWith('a') ? 'b' : 'a'}`;
  const req = { header: (name) => name === 'Authorization' ? `Bearer ${tampered}` : null };
  const res = responseStub();
  let called = false;
  await authMiddleware(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});
