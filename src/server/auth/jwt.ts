import jwt from 'jsonwebtoken';
import type { Role } from '../../shared/types';

// jsonwebtoken 9.x (bumped from 8.5.1 by the security-remediation slice). The
// algorithm is pinned explicitly on both sign and verify — the hardening the
// 9.x upgrade encourages, so a forged token can't downgrade the algorithm.
const SECRET = process.env.JWT_SECRET || 'larder-dev-secret-change-me';
const ALGORITHM = 'HS256' as const;

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '8h', algorithm: ALGORITHM });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET, { algorithms: [ALGORITHM] });
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
