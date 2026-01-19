import type { AppLoadContext } from "react-router";
import type { Env } from "../app/env";

declare module "react-router" {
  interface AppLoadContext {
    env: Env;
  }
}

export function getLoadContext(): AppLoadContext {
  return {
    env: {
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL!,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,
      DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET!,
      APP_URL: process.env.APP_URL!,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
      LEGACY_API_URL: process.env.LEGACY_API_URL,
      TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    },
  };
}
