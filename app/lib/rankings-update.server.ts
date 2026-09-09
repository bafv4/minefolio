// プレイヤーランキング（Speedrun.com / MCSR Ranked）の更新ロジック。
// api/cron/update-rankings.ts の全ユーザー走査ループから「1ユーザー分の処理」を抽出したもの。
// targeted-refresh.server.ts の refreshSrcRankingsForUser から1ユーザー単位でも呼べる。

import { createId } from "@paralleldrive/cuid2";
import { eq, and, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { users, speedrunCategories, playerRankings } from "./schema";

const SPEEDRUN_API_BASE = "https://www.speedrun.com/api/v1";
const RANKED_API_BASE = "https://mcsrranked.com/api";

// ============================================
// 型定義
// ============================================

interface SpeedruncomPbResponse {
  data: {
    id: string;
    weblink: string;
    place: number;
    run: {
      id: string;
      weblink: string;
      category: string;
      date: string | null;
      times: {
        primary_t: number;
      };
      videos?: {
        links?: { uri: string }[];
      };
      values?: Record<string, string>;
    };
  }[];
}

// 未承認記録用のレスポンス型
interface SpeedruncomRunsResponse {
  data: {
    id: string;
    weblink: string;
    category: string;
    date: string | null;
    submitted: string | null;
    times: {
      primary_t: number;
    };
    videos?: {
      links?: { uri: string }[];
    };
    values?: Record<string, string>;
    status: {
      status: "new" | "verified" | "rejected";
      examiner?: string;
      "verify-date"?: string;
      reason?: string;
    };
  }[];
}

interface RankedUserResponse {
  status: string;
  data: {
    uuid: string;
    nickname: string;
    eloRate: number | null;
    eloRank: number | null;
    statistics?: {
      season?: {
        bestTime?: {
          ranked?: number;
        };
        wins?: number | { ranked?: number };
        loses?: number | { ranked?: number };
      };
    };
  };
}

interface SpeedruncomUserSearchResponse {
  data: {
    id: string;
    names: {
      international: string;
    };
  }[];
}

export type RankingsCategory = typeof speedrunCategories.$inferSelect;

export interface RankingsUserInput {
  id: string;
  mcid: string | null;
  uuid: string | null;
  speedruncomId: string | null;
  speedruncomUsername: string | null;
}

export interface UpdateUserRankingsResult {
  speedruncomUpdates: number;
  rankedPbUpdates: number;
  rankedEloUpdates: number;
  speedruncomIdResolved: boolean;
}

// ============================================
// ユーティリティ
// ============================================

function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const millis = Math.round(ms % 1000);

  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}:${remainingMins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  }

  return `${mins}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function formatTimeSeconds(seconds: number): string {
  return formatTimeMs(seconds * 1000);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Speedrun.com API
// ============================================

/**
 * MCIDからSpeedrun.comユーザーを検索
 */
async function searchSpeedruncomUser(mcid: string): Promise<string | null> {
  const url = `${SPEEDRUN_API_BASE}/users?name=${encodeURIComponent(mcid)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Minefolio/1.0 (https://minefolio.app)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as SpeedruncomUserSearchResponse;

  // 完全一致するユーザーを探す
  const exactMatch = data.data.find(
    (u) => u.names.international.toLowerCase() === mcid.toLowerCase()
  );

  return exactMatch?.id ?? null;
}

async function fetchSpeedruncomUserPbs(
  speedruncomUserId: string,
  gameId: string = "j1npme6p"
): Promise<SpeedruncomPbResponse["data"]> {
  const url = `${SPEEDRUN_API_BASE}/users/${speedruncomUserId}/personal-bests?game=${gameId}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Minefolio/1.0 (https://minefolio.app)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Speedrun.com API error: ${response.status}`);
  }

  const data = (await response.json()) as SpeedruncomPbResponse;
  return data.data;
}

/**
 * ユーザーの未承認記録を取得
 */
async function fetchSpeedruncomUserPendingRuns(
  speedruncomUserId: string,
  gameId: string = "j1npme6p"
): Promise<SpeedruncomRunsResponse["data"]> {
  const url = `${SPEEDRUN_API_BASE}/runs?user=${speedruncomUserId}&game=${gameId}&status=new&max=200`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Minefolio/1.0 (https://minefolio.app)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Speedrun.com API error: ${response.status}`);
  }

  const data = (await response.json()) as SpeedruncomRunsResponse;
  return data.data;
}

// ============================================
// MCSR Ranked API
// ============================================

async function fetchRankedUserData(uuid: string): Promise<RankedUserResponse["data"] | null> {
  const cleanUuid = uuid.replace(/-/g, "");
  const url = `${RANKED_API_BASE}/users/${cleanUuid}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Minefolio/1.0 (https://minefolio.app)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`MCSR Ranked API error: ${response.status}`);
  }

  const data = (await response.json()) as RankedUserResponse;

  if (data.status !== "success") {
    return null;
  }

  return data.data;
}

// ============================================
// メイン処理
// ============================================

// ユーザー1人分の playerRankings を1回のクエリでメモリに引き当て、
// ユーザー×カテゴリの二重ループ内での N+1 lookup を避けるためのローカルミラー行。
// 以後このユーザーのイテレーション内では、このミラー配列のみを更新/削除/挿入の
// 判定ソースとし、DBへの読み取りは行わない（書き込みSQLは従来どおり都度実行する）。
interface LocalRankingRow {
  id: string;
  rankingType: "speedruncom" | "ranked_pb" | "ranked_elo";
  categoryId: string | null;
  speedruncomRunId: string | null;
  verificationStatus: "verified" | "new" | "rejected" | null;
  timeMs: number | null;
}

/**
 * 1ユーザー分の Speedrun.com / MCSR Ranked ランキングを取得して playerRankings に反映する。
 * cron（api/cron/update-rankings.ts）の全ユーザー走査ループと、targeted-refresh.server.ts の
 * 1ユーザー即時更新の両方から呼ばれる共通部品。
 *
 * 個々の外部API呼び出し（Speedrun.com ID解決・Speedrun.com記録取得・MCSR Ranked取得）は
 * それぞれ独立した try/catch で保護されており、失敗しても他のセクションの処理は続行する。
 * ただし playerRankings のミラー読み込み（DBクエリ）自体は try で囲っていない
 * （呼び出し元の外側の例外処理に委ねる、cron 側の既存挙動を踏襲）。
 */
export async function updateUserRankings(
  db: Database,
  categories: RankingsCategory[],
  user: RankingsUserInput
): Promise<UpdateUserRankingsResult> {
  let speedruncomUpdates = 0;
  let rankedPbUpdates = 0;
  let rankedEloUpdates = 0;
  let speedruncomIdResolved = false;

  // Speedrun.com IDの解決（usernameはあるがidがない場合）
  let speedruncomId = user.speedruncomId;
  if (!speedruncomId && user.speedruncomUsername) {
    try {
      // URLが入っている場合はユーザー名を抽出
      let username = user.speedruncomUsername;
      if (username.includes("speedrun.com/users/")) {
        const match = username.match(/speedrun\.com\/users\/([^/\s]+)/);
        if (match) {
          username = match[1];
        }
      }

      const resolvedId = await searchSpeedruncomUser(username);
      if (resolvedId) {
        // IDをDBに保存
        await db
          .update(users)
          .set({ speedruncomId: resolvedId })
          .where(eq(users.id, user.id));
        speedruncomId = resolvedId;
        speedruncomIdResolved = true;
        console.log(`Resolved Speedrun.com ID for ${user.mcid}: ${resolvedId}`);
      } else {
        console.log(`Could not resolve Speedrun.com ID for ${user.mcid} (username: ${username})`);
      }
      await sleep(500); // レート制限対策
    } catch (error) {
      console.error(`Error resolving Speedrun.com ID for ${user.mcid}:`, error);
    }
  }

  // このユーザーの playerRankings を1回だけ取得し、以降のループ内 lookup は
  // すべてこのメモリ配列に対して行う（N+1 解消。書き込みSQLは従来どおり実行し、
  // その都度このミラー配列も更新する）。
  let userRankings: LocalRankingRow[] = [];
  if (speedruncomId || user.uuid) {
    userRankings = await db.query.playerRankings.findMany({
      where: eq(playerRankings.userId, user.id),
      columns: {
        id: true,
        rankingType: true,
        categoryId: true,
        speedruncomRunId: true,
        verificationStatus: true,
        timeMs: true,
      },
    });
  }

  // Speedrun.com ランキング
  if (speedruncomId) {
    try {
      // 承認済み記録を取得
      const pbs = await fetchSpeedruncomUserPbs(speedruncomId);

      // 未承認記録を取得
      await sleep(300); // レート制限対策
      const pendingRuns = await fetchSpeedruncomUserPendingRuns(speedruncomId);

      for (const category of categories) {
        if (!category.speedruncomCategoryId || !category.speedruncomVariables) {
          continue;
        }

        const variables = JSON.parse(category.speedruncomVariables) as Record<string, string>;

        // 承認済み記録をマッチング
        const matchingPb = pbs.find((pb) => {
          if (pb.run.category !== category.speedruncomCategoryId) {
            return false;
          }
          for (const [varId, valueId] of Object.entries(variables)) {
            if (pb.run.values?.[varId] !== valueId) {
              return false;
            }
          }
          return true;
        });

        // 未承認記録をマッチング（カテゴリと変数が一致するもの全て）
        const matchingPendingRuns = pendingRuns.filter((run) => {
          if (run.category !== category.speedruncomCategoryId) {
            return false;
          }
          for (const [varId, valueId] of Object.entries(variables)) {
            if (run.values?.[varId] !== valueId) {
              return false;
            }
          }
          return true;
        });

        // 承認済み記録を保存/更新
        if (matchingPb) {
          const timeMs = matchingPb.run.times.primary_t * 1000;
          const videoUrl = matchingPb.run.videos?.links?.[0]?.uri;

          const existing = userRankings.find(
            (r) =>
              r.rankingType === "speedruncom" &&
              r.categoryId === category.id &&
              r.speedruncomRunId === matchingPb.run.id
          );

          if (existing) {
            await db
              .update(playerRankings)
              .set({
                speedruncomRunId: matchingPb.run.id,
                speedruncomPlayerId: speedruncomId,
                verificationStatus: "verified",
                timeMs,
                timeFormatted: formatTimeSeconds(matchingPb.run.times.primary_t),
                recordDate: matchingPb.run.date,
                videoUrl,
                runWeblink: matchingPb.run.weblink,
                lastFetched: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(playerRankings.id, existing.id));

            // ミラー更新: 直後の承認済み重複判定・未承認整理が最新状態を見られるようにする
            existing.speedruncomRunId = matchingPb.run.id;
            existing.verificationStatus = "verified";
            existing.timeMs = timeMs;
          } else {
            // 同じカテゴリの古い承認済み記録を削除してから新規作成。
            // 削除と挿入をトランザクションで原子化し、並行 cron での孤児化を防ぐ。
            const newId = createId();
            await db.transaction(async (tx) => {
              await tx.delete(playerRankings).where(
                and(
                  eq(playerRankings.userId, user.id),
                  eq(playerRankings.rankingType, "speedruncom"),
                  eq(playerRankings.categoryId, category.id),
                  eq(playerRankings.verificationStatus, "verified")
                )
              );

              await tx.insert(playerRankings).values({
                id: newId,
                userId: user.id,
                rankingType: "speedruncom",
                categoryId: category.id,
                speedruncomRunId: matchingPb.run.id,
                speedruncomPlayerId: speedruncomId,
                verificationStatus: "verified",
                timeMs,
                timeFormatted: formatTimeSeconds(matchingPb.run.times.primary_t),
                recordDate: matchingPb.run.date,
                videoUrl,
                runWeblink: matchingPb.run.weblink,
                lastFetched: new Date(),
              });
            });

            // ミラー更新: 削除された旧・承認済み記録を配列から除去し、新規行を追加
            userRankings = userRankings.filter(
              (r) =>
                !(
                  r.rankingType === "speedruncom" &&
                  r.categoryId === category.id &&
                  r.verificationStatus === "verified"
                )
            );
            userRankings.push({
              id: newId,
              rankingType: "speedruncom",
              categoryId: category.id,
              speedruncomRunId: matchingPb.run.id,
              verificationStatus: "verified",
              timeMs,
            });
          }

          speedruncomUpdates++;
        }

        // 未承認記録を保存/更新
        for (const pendingRun of matchingPendingRuns) {
          const timeMs = pendingRun.times.primary_t * 1000;
          const videoUrl = pendingRun.videos?.links?.[0]?.uri;

          const existingPending = userRankings.find(
            (r) => r.rankingType === "speedruncom" && r.speedruncomRunId === pendingRun.id
          );

          if (existingPending) {
            await db
              .update(playerRankings)
              .set({
                verificationStatus: "new",
                timeMs,
                timeFormatted: formatTimeSeconds(pendingRun.times.primary_t),
                recordDate: pendingRun.date,
                videoUrl,
                runWeblink: pendingRun.weblink,
                lastFetched: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(playerRankings.id, existingPending.id));

            // ミラー更新: verificationStatus を維持更新（既に "new" の想定だが明示的に反映）
            existingPending.verificationStatus = "new";
            existingPending.timeMs = timeMs;
          } else {
            const newId = createId();
            await db.insert(playerRankings).values({
              id: newId,
              userId: user.id,
              rankingType: "speedruncom",
              categoryId: category.id,
              speedruncomRunId: pendingRun.id,
              speedruncomPlayerId: speedruncomId,
              verificationStatus: "new",
              timeMs,
              timeFormatted: formatTimeSeconds(pendingRun.times.primary_t),
              recordDate: pendingRun.date,
              videoUrl,
              runWeblink: pendingRun.weblink,
              lastFetched: new Date(),
            });

            // ミラー更新: 同一イテレーション内の承認済み未承認整理（下記）が
            // この新規未承認記録を認識できるよう配列に追加する
            userRankings.push({
              id: newId,
              rankingType: "speedruncom",
              categoryId: category.id,
              speedruncomRunId: pendingRun.id,
              verificationStatus: "new",
              timeMs,
            });
          }

          speedruncomUpdates++;
        }

        // 承認済みになった未承認記録を削除（APIで未承認として返ってこなくなった記録）
        const existingPendingRecords = userRankings.filter(
          (r) =>
            r.rankingType === "speedruncom" &&
            r.categoryId === category.id &&
            r.verificationStatus === "new"
        );

        for (const existingPending of existingPendingRecords) {
          const stillPending = matchingPendingRuns.some(
            (run) => run.id === existingPending.speedruncomRunId
          );
          if (!stillPending) {
            // 未承認でなくなった記録を削除（承認済みまたはリジェクトされた）
            await db.delete(playerRankings).where(eq(playerRankings.id, existingPending.id));

            // ミラー更新: 削除した行を配列からも除去
            userRankings = userRankings.filter((r) => r.id !== existingPending.id);
          }
        }
      }

      await sleep(500); // レート制限対策
    } catch (error) {
      console.error(`Speedrun.com error for ${user.mcid}:`, error);
    }
  }

  // MCSR Ranked ランキング
  if (user.uuid) {
    try {
      const userData = await fetchRankedUserData(user.uuid);

      if (userData) {
        const stats = userData.statistics?.season;

        // PBランキング
        const bestTime = stats?.bestTime?.ranked;
        if (bestTime) {
          const existingPb = userRankings.find((r) => r.rankingType === "ranked_pb");

          if (existingPb) {
            await db
              .update(playerRankings)
              .set({
                timeMs: bestTime,
                timeFormatted: formatTimeMs(bestTime),
                lastFetched: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(playerRankings.id, existingPb.id));

            // ミラー更新
            existingPb.timeMs = bestTime;
          } else {
            const newId = createId();
            await db.insert(playerRankings).values({
              id: newId,
              userId: user.id,
              rankingType: "ranked_pb",
              timeMs: bestTime,
              timeFormatted: formatTimeMs(bestTime),
              lastFetched: new Date(),
            });

            // ミラー更新
            userRankings.push({
              id: newId,
              rankingType: "ranked_pb",
              categoryId: null,
              speedruncomRunId: null,
              verificationStatus: "verified",
              timeMs: bestTime,
            });
          }

          rankedPbUpdates++;
        }

        // Eloランキング
        if (userData.eloRate) {
          const wins =
            typeof stats?.wins === "number"
              ? stats.wins
              : (stats?.wins as { ranked?: number } | undefined)?.ranked ?? 0;
          const losses =
            typeof stats?.loses === "number"
              ? stats.loses
              : (stats?.loses as { ranked?: number } | undefined)?.ranked ?? 0;
          const totalGames = wins + losses;
          const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;

          const existingElo = userRankings.find((r) => r.rankingType === "ranked_elo");

          if (existingElo) {
            await db
              .update(playerRankings)
              .set({
                eloRate: userData.eloRate,
                wins,
                losses,
                winRate,
                lastFetched: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(playerRankings.id, existingElo.id));
          } else {
            const newId = createId();
            await db.insert(playerRankings).values({
              id: newId,
              userId: user.id,
              rankingType: "ranked_elo",
              eloRate: userData.eloRate,
              wins,
              losses,
              winRate,
              lastFetched: new Date(),
            });

            // ミラー更新
            userRankings.push({
              id: newId,
              rankingType: "ranked_elo",
              categoryId: null,
              speedruncomRunId: null,
              verificationStatus: "verified",
              timeMs: null,
            });
          }

          rankedEloUpdates++;
        }
      }

      await sleep(200); // レート制限対策
    } catch (error) {
      console.error(`MCSR Ranked error for ${user.mcid}:`, error);
    }
  }

  return { speedruncomUpdates, rankedPbUpdates, rankedEloUpdates, speedruncomIdResolved };
}

/**
 * 同一プレイヤー・同一カテゴリで審査済み(verified)記録が複数ある場合、
 * 最速（timeMs 最小）のみ残し、遅い方を削除する。
 * userId を指定すればそのユーザーのみに絞って整理する（targeted-refresh 用）。
 * 省略時は全ユーザー対象（cron の全体走査後の整理用、既存挙動どおり）。
 */
export async function cleanupDuplicateVerifiedRankings(
  db: Database,
  userId?: string
): Promise<number> {
  const baseCondition = and(
    eq(playerRankings.rankingType, "speedruncom"),
    eq(playerRankings.verificationStatus, "verified")
  );
  const verifiedRecords = await db.query.playerRankings.findMany({
    where: userId ? and(baseCondition, eq(playerRankings.userId, userId)) : baseCondition,
    columns: { id: true, userId: true, categoryId: true, timeMs: true },
  });

  const verifiedGroups = new Map<string, { id: string; timeMs: number }[]>();
  for (const rec of verifiedRecords) {
    const key = `${rec.userId}::${rec.categoryId ?? ""}`;
    const group = verifiedGroups.get(key) ?? [];
    // timeMs が null の記録は最も遅い扱い（削除対象になりやすく）
    group.push({ id: rec.id, timeMs: rec.timeMs ?? Number.MAX_SAFE_INTEGER });
    verifiedGroups.set(key, group);
  }

  const duplicateIds: string[] = [];
  for (const group of verifiedGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.timeMs - b.timeMs);
    // 先頭（最速）を残し、残り（遅い方）を削除対象に
    for (const rec of group.slice(1)) duplicateIds.push(rec.id);
  }

  if (duplicateIds.length === 0) return 0;

  await db.delete(playerRankings).where(inArray(playerRankings.id, duplicateIds));
  return duplicateIds.length;
}
