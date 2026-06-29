import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { listItems, getItem } from '../queries/items';
import { serializeItem, serializeItemList, ok, fail } from '../../shared/serialize';

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  location: z.string().min(1),
  quantity: z.number().int().min(0),
  unit: z.string().min(1).default('units'),
  lowStockThreshold: z.number().int().min(0).default(0),
  barcode: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial();

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/items', { preHandler: authenticate }, async () => {
    const items = await listItems(app.prisma);
    return ok(serializeItemList(items));
  });

  app.get('/api/items/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await getItem(app.prisma, id);
    if (!item) {
      reply.code(404);
      return fail('item not found');
    }
    return ok(serializeItem(item));
  });

  // NOTE: mutations below are gated by `authenticate` only — no role check.
  // A viewer can create/update/delete. That is the intentional authz gap.
  app.post('/api/items', { preHandler: authenticate }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return fail('invalid item payload');
    }
    const now = new Date();
    const item = await app.prisma.item.create({
      data: {
        ...parsed.data,
        barcode: parsed.data.barcode ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    reply.code(201);
    return ok(serializeItem(item));
  });

  app.patch('/api/items/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return fail('invalid item payload');
    }
    const existing = await getItem(app.prisma, id);
    if (!existing) {
      reply.code(404);
      return fail('item not found');
    }
    const item = await app.prisma.item.update({
      where: { id },
      data: { ...parsed.data, updatedAt: new Date() },
    });
    return ok(serializeItem(item));
  });

  app.delete('/api/items/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getItem(app.prisma, id);
    if (!existing) {
      reply.code(404);
      return fail('item not found');
    }
    await app.prisma.item.delete({ where: { id } });
    return ok({ id });
  });
}
