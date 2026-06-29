import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth/middleware';
import { serializeUser, ok, fail } from '../../shared/serialize';
import { ROLES, type Role } from '../../shared/types';

const roleSchema = z.object({
  role: z.enum(ROLES as [Role, ...Role[]]),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Admin-only: the user directory and role management. Closing the base's
  // any-logged-in-user gap is part of the authz-hardening slice.
  app.get('/api/users', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const users = await app.prisma.user.findMany({ orderBy: { name: 'asc' } });
    return ok(users.map((u) => serializeUser(u)));
  });

  app.patch('/api/users/:id/role', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return fail('invalid role');
    }
    const existing = await app.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      reply.code(404);
      return fail('user not found');
    }
    const user = await app.prisma.user.update({ where: { id }, data: { role: parsed.data.role } });
    return ok(serializeUser(user));
  });
}
