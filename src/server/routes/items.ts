import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth/middleware';
import { listItems, getItem, listCategories, type ItemFilters } from '../queries/items';
import { serializeItem, serializeItemList, itemsToCsv, ok, fail } from '../../shared/serialize';

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

function parseFilters(query: Record<string, unknown>): ItemFilters {
  return {
    q: typeof query.q === 'string' && query.q.length > 0 ? query.q : undefined,
    category: typeof query.category === 'string' && query.category.length > 0 ? query.category : undefined,
    location: typeof query.location === 'string' && query.location.length > 0 ? query.location : undefined,
    lowStock: query.lowStock === 'true' || query.lowStock === '1',
  };
}

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  // Search / filter (saved-views slice): multi-field q, category, location,
  // lowStock. All read roles allowed.
  app.get('/api/items', { preHandler: authenticate }, async (req) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const items = await listItems(app.prisma, filters);
    return ok(serializeItemList(items));
  });

  app.get('/api/items/categories', { preHandler: authenticate }, async () => {
    return ok(await listCategories(app.prisma));
  });

  // Export (CSV + JSON) — funnels through serialize.ts. Honors the same
  // filters as the list, so an export reflects what you searched.
  app.get('/api/items/export', { preHandler: authenticate }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const filters = parseFilters(query);
    const items = await listItems(app.prisma, filters);
    const format = query.format === 'csv' ? 'csv' : 'json';
    if (format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="larder-items.csv"');
      return itemsToCsv(items);
    }
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="larder-items.json"');
    return serializeItemList(items);
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

  // Mutations are now role-gated (authz-hardening slice): members and admins
  // may create/update; only admins may delete.
  app.post('/api/items', { preHandler: [authenticate, requireRole('admin', 'member')] }, async (req, reply) => {
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

  app.patch('/api/items/:id', { preHandler: [authenticate, requireRole('admin', 'member')] }, async (req, reply) => {
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

  app.delete('/api/items/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
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
