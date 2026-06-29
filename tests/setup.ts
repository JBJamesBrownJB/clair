import { execSync } from 'node:child_process';

// Point every test at a throwaway SQLite file and push the schema once per
// worker. This runs before any test module is imported, so the Prisma client
// constructed in the server/helpers picks up this DATABASE_URL.
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'test-secret';

execSync('prisma db push --force-reset --skip-generate', {
  stdio: 'ignore',
  env: process.env,
});
