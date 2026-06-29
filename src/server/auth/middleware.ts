import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, type TokenPayload } from './jwt';
import type { Role } from '../../shared/types';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

// Authentication: verify the bearer token and attach the identity. The author
// of every mutation is taken from req.user (authenticated), never from the
// request body.
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return reply;
  }
  const payload = verifyToken(header.slice('Bearer '.length));
  if (!payload) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return reply;
  }
  req.user = payload;
}

/**
 * Role gate. NOTE: this exists but is deliberately under-used in the base app.
 * Most mutation routes are protected by `authenticate` only, so any logged-in
 * user — including a `viewer` — can create, update, and delete. Closing that
 * gap across every mutation (and adding role management) is a feature slice,
 * not something the base ships. This is the intentional authz hole.
 */
export function requireRole(...roles: Role[]) {
  return async function roleGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.user) {
      reply.code(401).send({ ok: false, error: 'unauthorized' });
      return reply;
    }
    if (!roles.includes(req.user.role)) {
      reply.code(403).send({ ok: false, error: 'forbidden' });
      return reply;
    }
  };
}
