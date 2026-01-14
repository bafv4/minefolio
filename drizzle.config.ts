import type { Config } from "drizzle-kit";

export default {
  schema: "./app/lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",  // PostgreSQL → SQLite
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_D1_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
} satisfies Config;