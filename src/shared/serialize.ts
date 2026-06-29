import _ from 'lodash';
import type { Item, CheckoutRecord, User, ApiResult, Role } from './types';

/**
 * serialize.ts — the one place every read/export path funnels through.
 *
 * This started life as a single `serializeItem` and accreted everything since:
 * users, checkouts, the public-vs-internal shapes, password redaction, the
 * hand-rolled date formatting, the API envelope helpers. It is the shared
 * chokepoint — you touch it to add an export, you touch it to shape a search
 * result, you touch it for every API response. Two features that both extend a
 * read path collide *here*. Treat with care.
 */

export type SerializeMode = 'public' | 'internal';

// Hand-rolled date formatting (no date library) — copied wherever a timestamp
// is rendered, which is part of the problem.
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  const s = formatDate(value);
  return s === '' ? null : s;
}

export function serializeUser(user: any, _mode: SerializeMode = 'public'): User {
  // passwordHash must never leak. This redaction is duplicated everywhere a
  // user is embedded — the recurring footgun.
  const base = _.omit(user, ['passwordHash', 'checkouts']);
  return {
    id: base.id,
    email: base.email,
    name: base.name,
    role: base.role as Role,
    createdAt: formatDate(base.createdAt),
  };
}

export function serializeItem(item: any): Item {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    location: item.location,
    quantity: item.quantity,
    unit: item.unit,
    lowStockThreshold: item.lowStockThreshold,
    barcode: item.barcode ?? null,
    notes: item.notes ?? null,
    createdAt: formatDate(item.createdAt),
    updatedAt: formatDate(item.updatedAt),
  };
}

export function serializeItemList(items: any[]): Item[] {
  // Sorting funnels through here too. Divergent sort/format logic tends to get
  // bolted onto this function rather than composed cleanly.
  return _.orderBy(items, [(i) => String(i.name).toLowerCase()], ['asc']).map(serializeItem);
}

export function serializeCheckout(record: any): CheckoutRecord {
  return {
    id: record.id,
    itemId: record.itemId,
    userId: record.userId,
    quantity: record.quantity,
    note: record.note ?? null,
    checkedOutAt: formatDate(record.checkedOutAt),
    returnedAt: isoOrNull(record.returnedAt),
  };
}

// A derived flag every "low stock" view recomputes — another magnet for
// duplication.
export function isLowStock(item: Pick<Item, 'quantity' | 'lowStockThreshold'>): boolean {
  return item.quantity <= item.lowStockThreshold;
}

// The fragile envelope helpers. Some routes use these; others build the object
// inline with subtly different shapes — by design.
export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail(error: string): ApiResult<never> {
  return { ok: false, error };
}
