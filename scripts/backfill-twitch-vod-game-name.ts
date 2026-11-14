// twitch_vod_cache.game_name が NULL の過去行に、ゲーム名（カテゴリ）を埋める一回限りのスクリプト。
//
// 【重要な限界】Helix はアーカイブ（VOD）単位のゲーム名を返さない。ここで埋まるのは
// 「このスクリプトを実行した時点の、そのチャンネルの現在のカテゴリ」であり、古いアーカイブほど
// 実際に配信していたカテゴリと違う可能性がある（新規取り込み分は取り込み時点のカテゴリを保存している）。
//
// 方針:
//   - 対象は game_name IS NULL の行のみ（埋め済みの行は触らない）。
//   - user_login ごとに /helix/users（login → broadcaster_id）と /helix/channels（game_name）を
//     それぞれ100件ずつまとめて呼ぶ（チャンネルごとの N 回呼び出しはしない）。
//   - カテゴリが空・取得失敗のチャンネルの行は NULL のまま残す。
//   - Twitch 認証情報は TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET（app/lib/twitch.ts のトークン取得を使用）。
//
// 実行:
//   pnpm exec tsx scripts/backfill-twitch-vod-game-name.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/backfill-twitch-vod-game-name.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/backfill-twitch-vod-game-name.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/backfill-twitch-vod-game-name.ts --remote --apply  # リモートに適用
import { and, isNull, sql } from "drizzle-orm";
import { createDb } from "../app/lib/db";
import { twitchVodCache } from "../app/lib/schema";
import { getTwitchAppToken, getChannelGameNames } from "../app/lib/twitch";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();
const apply = process.argv.includes("--apply");
const db = createDb(url, authToken);

console.log(`モード: ${apply ? "APPLY（実際に埋めます）" : "DRY-RUN（表示のみ・DB には書きません）"}`);
console.log(
  "注意: 埋まるのは「実行時点のチャンネルのカテゴリ」です（Helix はアーカイブ単位のゲーム名を返さない）。古いアーカイブほど実際と違う可能性があります。",
);

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET が未設定です。");
  process.exit(1);
}

const rows = await db
  .select({ login: twitchVodCache.userLogin, count: sql<number>`count(*)` })
  .from(twitchVodCache)
  .where(isNull(twitchVodCache.gameName))
  .groupBy(twitchVodCache.userLogin);

const totalRows = rows.reduce((n, r) => n + Number(r.count), 0);
console.log(`対象: ${totalRows} 行 / ${rows.length} チャンネル`);
if (rows.length === 0) process.exit(0);

const token = await getTwitchAppToken(clientId, clientSecret);
if (!token) {
  console.error("Twitch トークンを取得できませんでした。");
  process.exit(1);
}
const headers = { "Client-ID": clientId, Authorization: `Bearer ${token}` };

// login → broadcaster_id（100件ずつ）
const logins = [...new Set(rows.map((r) => r.login.toLowerCase()))];
const idByLogin = new Map<string, string>();
for (let i = 0; i < logins.length; i += 100) {
  const batch = logins.slice(i, i + 100);
  const params = batch.map((l) => `login=${encodeURIComponent(l)}`).join("&");
  const res = await fetch(`https://api.twitch.tv/helix/users?${params}`, { headers });
  if (!res.ok) {
    console.error(`/users 失敗 (${res.status})。このバッチのチャンネルは NULL のままです。`);
    continue;
  }
  const data = (await res.json()) as { data?: Array<{ id: string; login: string }> };
  for (const u of data.data ?? []) idByLogin.set(u.login.toLowerCase(), u.id);
}

// broadcaster_id → game_name（100件ずつ。空・失敗は含まれない）
const gameById = await getChannelGameNames(headers, [...idByLogin.values()]);

let filledRows = 0;
let skippedRows = 0;
for (const r of rows) {
  const login = r.login.toLowerCase();
  const game = gameById.get(idByLogin.get(login) ?? "");
  if (!game) {
    skippedRows += Number(r.count);
    console.log(`  ${r.login}: ${r.count} 行 → （取得できず・NULL のまま）`);
    continue;
  }
  console.log(`  ${r.login}: ${r.count} 行 → ${game}`);
  filledRows += Number(r.count);
  if (apply) {
    await db
      .update(twitchVodCache)
      .set({ gameName: game })
      .where(and(sql`lower(${twitchVodCache.userLogin}) = ${login}`, isNull(twitchVodCache.gameName)));
  }
}

console.log(
  `${apply ? "更新" : "更新予定"}: ${filledRows} 行 / NULL のまま: ${skippedRows} 行${apply ? "" : "（DRY-RUN のため未更新。--apply で実行）"}`,
);
