import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import { seed } from '../prisma/seed';

export const prisma = new PrismaClient();
export const app: FastifyInstance = buildApp(prisma);

export async function resetDb(): Promise<void> {
  await seed(prisma);
}

const LOGINS = {
  admin: { email: 'alice@larder.test', password: 'password123' },
  member: { email: 'bob@larder.test', password: 'password123' },
  viewer: { email: 'dave@larder.test', password: 'password123' },
} as const;

export type RoleName = keyof typeof LOGINS;

export async function tokenFor(role: RoleName): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: LOGINS[role] });
  return res.json().data.token as string;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
