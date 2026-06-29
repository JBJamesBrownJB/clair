import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { listCheckouts } from '../queries/checkouts';
import { serializeCheckout, ok, fail } from '../../shared/serialize';

const checkoutSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().nullable().optional(),
});

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/checkouts', { preHandler: authenticate }, async () => {
    const records = await listCheckouts(app.prisma);
    return ok(records.map(serializeCheckout));
  });

  // Authenticated-only (the authz gap applies here too).
  app.post('/api/checkouts', { preHandler: authenticate }, async (req, reply) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return fail('invalid checkout payload');
    }
    const item = await app.prisma.item.findUnique({ where: { id: parsed.data.itemId } });
    if (!item) {
      reply.code(404);
      return fail('item not found');
    }
    if (item.quantity < parsed.data.quantity) {
      reply.code(409);
      return fail('insufficient quantity');
    }
    const now = new Date();
    const record = await app.prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id: item.id },
        data: { quantity: item.quantity - parsed.data.quantity, updatedAt: now },
      });
      return tx.checkoutRecord.create({
        data: {
          itemId: item.id,
          userId: req.user!.sub,
          quantity: parsed.data.quantity,
          note: parsed.data.note ?? null,
          checkedOutAt: now,
        },
      });
    });
    reply.code(201);
    return ok(serializeCheckout(record));
  });

  app.post('/api/checkouts/:id/return', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await app.prisma.checkoutRecord.findUnique({ where: { id } });
    if (!record) {
      reply.code(404);
      return fail('checkout not found');
    }
    if (record.returnedAt) {
      reply.code(409);
      return fail('already returned');
    }
    const now = new Date();
    const updated = await app.prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({ where: { id: record.itemId } });
      if (item) {
        await tx.item.update({
          where: { id: item.id },
          data: { quantity: item.quantity + record.quantity, updatedAt: now },
        });
      }
      return tx.checkoutRecord.update({ where: { id }, data: { returnedAt: now } });
    });
    return ok(serializeCheckout(updated));
  });
}
