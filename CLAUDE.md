# Larder — working notes

Internal lab equipment & consumables register. Keep it simple and boring; this is
infrastructure the lab depends on, not a playground.

## Conventions

- **Single source of truth for shapes:** `src/shared/types.ts`. The API and the
  client both build against it. `ApiResult<T>` is the response envelope.
- **All HTTP responses funnel through `src/shared/serialize.ts`.** If you add a read
  or export path, serialize through here — don't hand-roll new shapes elsewhere.
- **Server:** Fastify plugins under `src/server/routes/*`, query helpers under
  `src/server/queries/*`. Validate request bodies with Zod.
- **Auth:** `src/server/auth/*`. The author of a mutation is the authenticated user
  (`req.user`), never the request body.
- **Client:** all network calls go through `src/client/api.ts`; data access via the
  TanStack Query hooks in `src/client/hooks/*`.
- **Database:** Prisma + SQLite. Schema in `prisma/schema.prisma`; the seed in
  `prisma/seed.ts` is deterministic — keep it that way (no wall-clock, no RNG).

## Before you push

```bash
pnpm typecheck && pnpm test && pnpm build
```
