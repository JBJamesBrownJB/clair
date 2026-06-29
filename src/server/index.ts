import { buildApp } from './app';
import { prisma } from './prisma';

const port = Number(process.env.PORT || 3001);
const app = buildApp(prisma);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`Larder API listening on http://localhost:${port}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
