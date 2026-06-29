import type { PrismaClient, Prisma } from '@prisma/client';

// Read/query layer for items. The saved-views / search-filter slice extends
// this with multi-field search, category/location facets and a low-stock
// filter. The export slice reads through the same listing.

export interface ItemFilters {
  q?: string;
  category?: string;
  location?: string;
  lowStock?: boolean;
}

export async function listItems(prisma: PrismaClient, filters: ItemFilters = {}) {
  const where: Prisma.ItemWhereInput = {};

  if (filters.q) {
    // SQLite LIKE is case-insensitive for ASCII, so `contains` gives a
    // forgiving multi-field search across the obvious text columns.
    where.OR = [
      { name: { contains: filters.q } },
      { category: { contains: filters.q } },
      { location: { contains: filters.q } },
      { barcode: { contains: filters.q } },
      { notes: { contains: filters.q } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.location) where.location = filters.location;

  const items = await prisma.item.findMany({ where, orderBy: { name: 'asc' } });

  // Low-stock is a column-to-column comparison; SQLite/Prisma can't express it
  // in `where`, so it's applied here.
  if (filters.lowStock) {
    return items.filter((i) => i.quantity <= i.lowStockThreshold);
  }
  return items;
}

export async function getItem(prisma: PrismaClient, id: string) {
  return prisma.item.findUnique({ where: { id } });
}

export async function listCategories(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.item.findMany({ select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } });
  return rows.map((r) => r.category);
}
