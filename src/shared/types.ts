// Shared domain types — the core model both client and server build against.
// Any feature that adds a field or behaviour mutates this file, so it is part
// of the contended substrate.

export type Role = 'admin' | 'member' | 'viewer';

export const ROLES: Role[] = ['admin', 'member', 'viewer'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string; // ISO-8601
}

export interface Item {
  id: string;
  name: string;
  category: string;
  location: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  barcode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutRecord {
  id: string;
  itemId: string;
  userId: string;
  quantity: number;
  note: string | null;
  checkedOutAt: string;
  returnedAt: string | null;
}

/**
 * The shared result envelope. NOTE: this is deliberately *not* a discriminated
 * union — `data` and `error` are both optional and `ok` is the only signal,
 * and even that is not always set the same way. Callers have grown to check
 * different fields (`if (res.ok)`, `if (res.data)`, `if (!res.error)`), which
 * is exactly the fragile shared assumption that bites when two features touch
 * the same response path. Treat changes here as load-bearing.
 */
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AuthPayload {
  token: string;
  user: User;
}
