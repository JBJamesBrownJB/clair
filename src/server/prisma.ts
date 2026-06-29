import { PrismaClient } from '@prisma/client';

// Process-wide client for the running server and the seed script. Tests build
// their own client against a throwaway SQLite file (see tests/setup.ts).
export const prisma = new PrismaClient();
