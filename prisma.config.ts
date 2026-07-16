import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'packages/core/prisma/schema.prisma',
  migrations: { path: 'packages/core/prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
