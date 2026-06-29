# Larder

> Internal **lab equipment & consumables register** — *what kit do we have, where
> is it, who has it checked out, what's running low.*

Larder is the small internal tool the lab uses to keep track of equipment and
consumables: a searchable register of items, who has them checked out, and what's
below its reorder threshold.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · TypeScript · Vite · React Router v6 · TanStack Query v4 · MUI v5 |
| Backend | Node · TypeScript · Fastify · Prisma · SQLite · Zod |
| Auth | JWT sessions, roles `admin` / `member` / `viewer` |
| Tests | Vitest (unit/integration) · Playwright (e2e) |
| Tooling | pnpm · ESLint · shared `tsconfig` |

Everything runs in-process against a SQLite file — no external services.

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:generate      # generate the Prisma client
pnpm db:reset         # create the SQLite db and load the deterministic seed
pnpm dev              # API on :3001, client on :5173 (proxied)
```

### Seed logins

The seed loads four users (password `password123`):

| Email | Role |
|-------|------|
| `alice@larder.test` | admin |
| `bob@larder.test` | member |
| `carol@larder.test` | member |
| `dave@larder.test` | viewer |

## Scripts

| Command | Does |
|---------|------|
| `pnpm dev` | run API + client with hot reload |
| `pnpm typecheck` | `tsc --noEmit` across the project |
| `pnpm test` | Vitest suite |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm build` | typecheck + build the client |
| `pnpm db:reset` | reset + reseed the SQLite database |
| `pnpm lint` | ESLint |

## Layout

```
prisma/            schema.prisma, deterministic seed
src/shared/        types + serialize.ts (shared read/export path)
src/server/        Fastify app: auth, routes, queries
src/client/        React app: api client, hooks, pages
tests/             Vitest suite
e2e/               Playwright smoke
```
