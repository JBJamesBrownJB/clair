import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signToken } from '../auth/jwt';
import { verifyPassword } from '../auth/password';
import { authenticate } from '../auth/middleware';
import { serializeUser, ok, fail } from '../../shared/serialize';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return fail('invalid credentials payload');
    }
    const user = await app.prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      reply.code(401);
      return fail('invalid email or password');
    }
    const token = signToken({ sub: user.id, email: user.email, role: user.role as never });
    return ok({ token, user: serializeUser(user) });
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (req) => {
    const user = await app.prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return fail('not found');
    return ok(serializeUser(user));
  });
}
