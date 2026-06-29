import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDb, authHeader, tokenFor } from '../helpers';

describe('checkouts', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists the seeded checkout history', async () => {
    const token = await tokenFor('member');
    const res = await app.inject({ method: 'GET', url: '/api/checkouts', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(5);
  });

  it('checks out an item and decrements its quantity', async () => {
    const token = await tokenFor('member');
    const before = await app.inject({ method: 'GET', url: '/api/items/item-05', headers: authHeader(token) });
    const startQty = before.json().data.quantity;

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkouts',
      headers: authHeader(token),
      payload: { itemId: 'item-05', quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.returnedAt).toBeNull();

    const after = await app.inject({ method: 'GET', url: '/api/items/item-05', headers: authHeader(token) });
    expect(after.json().data.quantity).toBe(startQty - 2);
  });

  it('refuses to check out more than is in stock', async () => {
    const token = await tokenFor('member');
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkouts',
      headers: authHeader(token),
      payload: { itemId: 'item-05', quantity: 99999 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns a checkout and restores quantity', async () => {
    const token = await tokenFor('member');
    // co-1 is an active checkout of item-01 (quantity 1).
    const itemBefore = await app.inject({ method: 'GET', url: '/api/items/item-01', headers: authHeader(token) });
    const startQty = itemBefore.json().data.quantity;

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkouts/co-1/return',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.returnedAt).not.toBeNull();

    const itemAfter = await app.inject({ method: 'GET', url: '/api/items/item-01', headers: authHeader(token) });
    expect(itemAfter.json().data.quantity).toBe(startQty + 1);
  });
});
