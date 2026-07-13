import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  return auth.handler(request);
}

export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  return auth.handler(request);
}
