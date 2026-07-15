/**
 * Vercel Webhook 受信エンドポイント（リリース通知）
 *
 * Vercel ダッシュボードで登録した Webhook（deployment.succeeded）を受け取り、
 * Production デプロイでバージョンが上がっていた場合のみ Discord に通知する。
 *
 * - 署名検証: x-vercel-signature ヘッダー（リクエストボディの HMAC-SHA1）
 * - 重複防止: app_meta に最終通知バージョンを保存し、同一バージョンでは通知しない
 *   （バージョンを上げないデプロイ・同一コミットの再デプロイでは通知されない）
 * - このエンドポイントは通知対象のデプロイ自身が処理する前提（bundleされた
 *   package.json / changelog.md を通知内容に使うため）。エイリアス切替前に
 *   旧デプロイへ届いた場合は 503 を返し、Vercel のリトライで新デプロイに処理させる
 */

import type { ActionFunctionArgs } from "react-router";
import { getEnv } from "@/lib/env.server";
import { getAppMeta, setAppMeta } from "@/lib/app-meta.server";
import { verifyVercelSignature, buildReleaseDescription } from "@/lib/release-notify.server";
import changelogMd from "@/content/changelog.md?raw";
import packageJson from "../../../../package.json";

const LAST_NOTIFIED_VERSION_KEY = "release_notify:last_version";

interface VercelWebhookBody {
  type: string;
  payload?: {
    target?: string | null;
    deployment?: {
      meta?: Record<string, string | undefined>;
    };
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const env = getEnv();
  const secret = env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("VERCEL_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyVercelSignature(rawBody, request.headers.get("x-vercel-signature"), secret)) {
    console.warn("Vercel webhook signature verification failed");
    return new Response("Invalid signature", { status: 401 });
  }

  let body: VercelWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Production デプロイの成功イベントのみ処理する
  if (body.type !== "deployment.succeeded" || body.payload?.target !== "production") {
    return Response.json({ success: true, skipped: "not a production deployment" });
  }

  // エイリアス切替レース対策: このコードが通知対象のデプロイ自身でなければ
  // 503 を返してリトライさせる（切替完了後は新デプロイが処理する）
  const deployedSha = body.payload?.deployment?.meta?.githubCommitSha;
  const selfSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (deployedSha && selfSha && deployedSha !== selfSha) {
    return new Response("Serving deployment does not match webhook deployment; retry", {
      status: 503,
    });
  }

  const version = packageJson.version;
  const lastNotified = await getAppMeta(LAST_NOTIFIED_VERSION_KEY);
  if (lastNotified === version) {
    return Response.json({ success: true, skipped: "version already notified", version });
  }

  const webhookUrl = env.DISCORD_RELEASE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_RELEASE_WEBHOOK_URL is not set; skipping release notification");
    return Response.json({ success: true, skipped: "discord webhook not configured" });
  }

  const changelogUrl = `${env.APP_URL}/developers/changelog`;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: `🚀 Minefolio ${version} をリリースしました`,
          url: changelogUrl,
          description: buildReleaseDescription(changelogMd, version, changelogUrl),
          color: 5763719,
          timestamp: new Date().toISOString(),
          footer: { text: "Minefolio" },
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Discord release notification failed:", res.status, await res.text());
    return new Response("Discord notification failed", { status: 502 });
  }

  await setAppMeta(LAST_NOTIFIED_VERSION_KEY, version);
  console.log("Release notification sent:", version);
  return Response.json({ success: true, notified: version });
}

export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
