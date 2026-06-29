import jwt from 'jsonwebtoken';
import type { Role } from '../../shared/types';

// jsonwebtoken is pinned at 8.5.1 — a version with known advisories. The
// security-remediation slice bumps it to 9.x, which forces an explicit
// algorithm on verify; this module is where that breaking change lands.
const SECRET = process.env.JWT_SECRET || 'larder-dev-secret-change-me';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '8h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET);
    if (typeof decoded === 'string') return null;
    const { sub, email, role } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
      return null;
    }
    return { sub, email, role: role as Role };
  } catch {
    return null;
  }
}
