import type { PrismaClient } from '@prisma/client';

export async function listCheckouts(prisma: PrismaClient) {
  return prisma.checkoutRecord.findMany({ orderBy: { checkedOutAt: 'desc' } });
}

export async function listActiveCheckouts(prisma: PrismaClient) {
  return prisma.checkoutRecord.findMany({ where: { returnedAt: null } });
}
