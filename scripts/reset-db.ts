import { execSync } from 'node:child_process';
import minimist from 'minimist';

// minimist is pinned at 1.2.5 — a version with a known prototype-pollution
// advisory (raw material for the Dependabot-remediation slice). It parses the
// optional --db flag for an alternate SQLite path.
const argv = minimist(process.argv.slice(2));
const dbPath: string = argv.db || 'file:./dev.db';

const env = { ...process.env, DATABASE_URL: dbPath.startsWith('file:') ? dbPath : `file:${dbPath}` };

function run(cmd: string): void {
  execSync(cmd, { stdio: 'inherit', env });
}

run('prisma db push --force-reset --skip-generate');
run('tsx prisma/seed.ts');
// eslint-disable-next-line no-console
console.log('Database reset and seeded.');
