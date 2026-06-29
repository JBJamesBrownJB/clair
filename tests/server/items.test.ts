import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDb, authHeader, tokenFor } from '../helpers';

describe('items', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists all seeded items (requires auth)', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/items' });
    expect(noAuth.statusCode).toBe(401);

    const token = await tokenFor('member');
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(40);
  });

  it('fetches a single item and 404s on a missing one', async () => {
    const token = await tokenFor('member');
    const ok = await app.inject({ method: 'GET', url: '/api/items/item-01', headers: authHeader(token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.name).toBe('Compound Microscope');

    const missing = await app.inject({ method: 'GET', url: '/api/items/nope', headers: authHeader(token) });
    expect(missing.statusCode).toBe(404);
  });

  it('creates, updates and deletes an item', async () => {
    // Deletion is admin-only after the authz-hardening slice landed.
    const token = await tokenFor('admin');

    const created = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: authHeader(token),
      payload: { name: 'Test Widget', category: 'Consumables', location: 'Cold Room', quantity: 7 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    expect(created.json().data.unit).toBe('units');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      headers: authHeader(token),
      payload: { quantity: 3 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.quantity).toBe(3);

    const removed = await app.inject({ method: 'DELETE', url: `/api/items/${id}`, headers: authHeader(token) });
    expect(removed.statusCode).toBe(200);

    const gone = await app.inject({ method: 'GET', url: `/api/items/${id}`, headers: authHeader(token) });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects an invalid create payload', async () => {
    const token = await tokenFor('member');
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: authHeader(token),
      payload: { name: '', category: 'X', location: 'Y', quantity: -1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
