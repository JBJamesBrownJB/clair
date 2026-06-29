import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDb, tokenFor, bearer } from './helpers';
import { ITEM_CSV_COLUMNS } from '../src/shared/serialize';

beforeEach(async () => {
  await resetDb();
});

// Every state-changing endpoint in the app. The cross-feature instrument: a
// feature added blind to the authz slice would land one of these UNGATED.
const MUTATIONS = [
  { name: 'create item', method: 'POST' as const, url: '/api/items', body: { name: 'Z', category: 'C', location: 'L', quantity: 1 } },
  { name: 'update item', method: 'PATCH' as const, url: '/api/items/item-01', body: { quantity: 2 } },
  { name: 'delete item', method: 'DELETE' as const, url: '/api/items/item-01', body: undefined },
  { name: 'create checkout', method: 'POST' as const, url: '/api/checkouts', body: { itemId: 'item-05', quantity: 1 } },
  { name: 'return checkout', method: 'POST' as const, url: '/api/checkouts/co-1/return', body: undefined },
  { name: 'list users', method: 'GET' as const, url: '/api/users', body: undefined },
  { name: 'change role', method: 'PATCH' as const, url: '/api/users/user-viewer/role', body: { role: 'member' } },
];

describe('slice 1 — authz hardening (the silent-security-gap instrument)', () => {
  it.each(MUTATIONS)('$name rejects an unauthenticated request (401)', async (m) => {
    const res = await app.inject({ method: m.method, url: m.url, payload: m.body });
    expect(res.statusCode).toBe(401);
  });

  it.each(MUTATIONS)('$name rejects a viewer (403)', async (m) => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: m.method, url: m.url, headers: bearer(token), payload: m.body });
    expect(res.statusCode).toBe(403);
  });

  it('enforces the role matrix: member may write items but not delete or administer users', async () => {
    const token = await tokenFor('member');
    const create = await app.inject({ method: 'POST', url: '/api/items', headers: bearer(token), payload: { name: 'Z', category: 'C', location: 'L', quantity: 1 } });
    expect(create.statusCode).toBe(201);
    const del = await app.inject({ method: 'DELETE', url: '/api/items/item-01', headers: bearer(token) });
    expect(del.statusCode).toBe(403);
    const users = await app.inject({ method: 'GET', url: '/api/users', headers: bearer(token) });
    expect(users.statusCode).toBe(403);
  });

  it('lets an admin delete, list users and change a role', async () => {
    const token = await tokenFor('admin');
    expect((await app.inject({ method: 'DELETE', url: '/api/items/item-01', headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: bearer(token) })).statusCode).toBe(200);
    const role = await app.inject({ method: 'PATCH', url: '/api/users/user-viewer/role', headers: bearer(token), payload: { role: 'member' } });
    expect(role.statusCode).toBe(200);
    expect(role.json().data.role).toBe('member');
  });

  it('never leaks passwordHash through any user-bearing response', async () => {
    const admin = await tokenFor('admin');
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: bearer(admin) });
    for (const u of list.json().data) expect(u).not.toHaveProperty('passwordHash');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(admin) });
    expect(me.json().data).not.toHaveProperty('passwordHash');
  });
});

describe('slice 2 — saved views: search + filter', () => {
  it('search "microscope" returns exactly the 3 seeded microscopes', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items?q=microscope', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().data.map((i: { name: string }) => i.name);
    expect(names).toHaveLength(3);
    expect(names.every((n) => /microscope/i.test(n))).toBe(true);
  });

  it('is case-insensitive and searches multiple fields', async () => {
    const token = await tokenFor('viewer');
    const upper = await app.inject({ method: 'GET', url: '/api/items?q=MICROSCOPE', headers: bearer(token) });
    expect(upper.json().data).toHaveLength(3);
  });

  it('filters by low-stock (exactly the 6 seeded low-stock items)', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items?lowStock=true', headers: bearer(token) });
    expect(res.json().data).toHaveLength(6);
    for (const i of res.json().data) expect(i.quantity).toBeLessThanOrEqual(i.lowStockThreshold);
  });

  it('filters by category', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items?category=Glassware', headers: bearer(token) });
    const cats = new Set(res.json().data.map((i: { category: string }) => i.category));
    expect([...cats]).toEqual(['Glassware']);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('returns nothing for a no-match query', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items?q=zzzznotathing', headers: bearer(token) });
    expect(res.json().data).toHaveLength(0);
  });
});

describe('slice 3 — export (CSV + JSON)', () => {
  it('CSV export has the canonical header and one row per seeded item', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items/export?format=csv', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe(ITEM_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(41); // header + 40 items
  });

  it('JSON export returns all 40 seeded items', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items/export?format=json', headers: bearer(token) });
    expect(res.json()).toHaveLength(40);
  });

  it('export respects the active filter', async () => {
    const token = await tokenFor('viewer');
    const res = await app.inject({ method: 'GET', url: '/api/items/export?format=json&q=microscope', headers: bearer(token) });
    expect(res.json()).toHaveLength(3);
  });

  it('export requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items/export?format=csv' });
    expect(res.statusCode).toBe(401);
  });
});
