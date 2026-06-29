import type { PrismaClient } from '@prisma/client';

// Read/query layer for items. The base ships a plain "list everything"; the
// saved-views / search-filter slice extends this module, and the export slice
// reads through it too — so both contend here.

export async function listItems(prisma: PrismaClient) {
  return prisma.item.findMany({ orderBy: { name: 'asc' } });
}

export async function getItem(prisma: PrismaClient, id: string) {
  return prisma.item.findUnique({ where: { id } });
}
