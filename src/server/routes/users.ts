import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { serializeUser, ok } from '../../shared/serialize';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Listing users exposes the directory. In the base this is gated by
  // `authenticate` only — any logged-in user can read it. Role management
  // (admin-only listing, role changes) is part of the authz-hardening slice.
  app.get('/api/users', { preHandler: authenticate }, async () => {
    const users = await app.prisma.user.findMany({ orderBy: { name: 'asc' } });
    return ok(users.map((u) => serializeUser(u)));
  });
}
