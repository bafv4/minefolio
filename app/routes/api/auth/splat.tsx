import type { Route } from "./+types/splat";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  return auth.handler(request);
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);

  return auth.handler(request);
}
