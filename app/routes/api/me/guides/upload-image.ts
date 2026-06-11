import type { ActionFunctionArgs } from "react-router";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function action({ context, request }: ActionFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as HandleUploadBody;

  return handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      // user は外側で検証済みだが、コールバック実行時の型ナロー目的で再確認
      if (!user || !user.id) {
        throw new Error("Unauthorized");
      }
      if (!pathname.startsWith(`guides/${user.id}/`)) {
        throw new Error("Invalid path");
      }
      return {
        allowedContentTypes: [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ],
        maximumSizeInBytes: 5 * 1024 * 1024,
      };
    },
    onUploadCompleted: async ({ blob }) => {
      console.log("Guide image uploaded:", blob.url);
    },
  });
}
