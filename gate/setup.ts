import { execSync } from 'node:child_process';

// Dedicated throwaway database for the held-out gate, pushed once per worker.
process.env.DATABASE_URL = 'file:./gate.db';
process.env.JWT_SECRET = 'gate-secret';

execSync('prisma db push --force-reset --skip-generate', {
  stdio: 'ignore',
  env: process.env,
});
