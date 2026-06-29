import { describe, expect, it } from 'vitest';
import { serializeUser, serializeItem, isLowStock, formatDate } from '../../src/shared/serialize';

describe('serialize (shared chokepoint)', () => {
  it('redacts passwordHash from users', () => {
    const out = serializeUser({
      id: 'u1',
      email: 'x@y.test',
      name: 'X',
      role: 'admin',
      passwordHash: 'secret-hash',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(out).not.toHaveProperty('passwordHash');
    expect(out.role).toBe('admin');
  });

  it('normalises item dates to ISO strings', () => {
    const out = serializeItem({
      id: 'i1',
      name: 'Beaker',
      category: 'Glassware',
      location: 'Lab A - Shelf 1',
      quantity: 10,
      unit: 'units',
      lowStockThreshold: 5,
      barcode: null,
      notes: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    expect(out.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('flags low stock at or below threshold', () => {
    expect(isLowStock({ quantity: 5, lowStockThreshold: 5 })).toBe(true);
    expect(isLowStock({ quantity: 6, lowStockThreshold: 5 })).toBe(false);
  });

  it('formatDate handles empty/invalid input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });
});
