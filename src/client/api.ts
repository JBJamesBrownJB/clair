import type {
  ApiResult,
  AuthPayload,
  CheckoutRecord,
  Item,
  User,
} from '../shared/types';

// The shared HTTP chokepoint. All network traffic for the client flows through
// `apiFetch`, which attaches the Bearer token and normalizes the ApiResult
// envelope. Helpers below are the only thing containers/hooks should import.

const AUTH_STORAGE_KEY = 'larder.auth';

interface StoredAuth {
  token: string;
  user: User;
}

function readToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  // Skip attaching the Bearer token (used by login).
  auth?: boolean;
}

/**
 * Performs a request against /api and unwraps the ApiResult<T> envelope.
 * Throws ApiError on a non-ok response or a server-reported failure so that
 * TanStack Query can surface it via its error state.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = readToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: ApiResult<T> | null = null;
  try {
    payload = (await res.json()) as ApiResult<T>;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || payload.ok === false) {
    const message =
      payload?.error ?? `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status);
  }

  // `data` is optional in the envelope; for our endpoints a successful result
  // always carries it. Cast through unknown to keep callers strongly typed.
  return payload.data as T;
}

// ---- Auth -----------------------------------------------------------------

export function login(email: string, password: string): Promise<AuthPayload> {
  return apiFetch<AuthPayload>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function getMe(): Promise<User> {
  return apiFetch<User>('/auth/me');
}

// ---- Items ----------------------------------------------------------------

export function getItems(): Promise<Item[]> {
  return apiFetch<Item[]>('/items');
}

export function getItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/items/${id}`);
}

export interface CreateItemInput {
  name: string;
  category: string;
  location: string;
  quantity: number;
  unit?: string;
  lowStockThreshold?: number;
  barcode?: string | null;
  notes?: string | null;
}

export function createItem(input: CreateItemInput): Promise<Item> {
  return apiFetch<Item>('/items', { method: 'POST', body: input });
}

export type UpdateItemInput = Partial<CreateItemInput>;

export function updateItem(id: string, input: UpdateItemInput): Promise<Item> {
  return apiFetch<Item>(`/items/${id}`, { method: 'PATCH', body: input });
}

export function deleteItem(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/items/${id}`, { method: 'DELETE' });
}

// ---- Checkouts ------------------------------------------------------------

export function getCheckouts(): Promise<CheckoutRecord[]> {
  return apiFetch<CheckoutRecord[]>('/checkouts');
}

export interface CreateCheckoutInput {
  itemId: string;
  quantity: number;
  note?: string | null;
}

export function createCheckout(
  input: CreateCheckoutInput,
): Promise<CheckoutRecord> {
  return apiFetch<CheckoutRecord>('/checkouts', { method: 'POST', body: input });
}

export function returnCheckout(id: string): Promise<CheckoutRecord> {
  return apiFetch<CheckoutRecord>(`/checkouts/${id}/return`, { method: 'POST' });
}

// ---- Users ----------------------------------------------------------------

export function getUsers(): Promise<User[]> {
  return apiFetch<User[]>('/users');
}
