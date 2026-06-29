import { beforeAll, describe, expect, it } from 'vitest';
import { app, resetDb, authHeader, tokenFor } from '../helpers';

describe('auth', () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('logs in a seeded user and returns a token + user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@larder.test', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.email).toBe('alice@larder.test');
    expect(body.data.user.role).toBe('admin');
    // passwordHash must never leak through serialization.
    expect(body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a bad password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@larder.test', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().ok).toBe(false);
  });

  it('requires a token for /api/auth/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current user with a valid token', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe('dave@larder.test');
  });
});
