/**
 * プレイヤーランキング更新用APIエンドポイント
 * Cron Triggerまたは外部サービスから定期的に呼び出される
 *
 * 処理内容:
 * - 各MinefolioユーザーのSpeedrun.com記録を取得
 * - 各MinefolioユーザーのMCSR Ranked記録を取得
 * - DBに保存
 */

import { createDb } from "@/lib/db";
import { users, speedrunCategories, playerRankings, type User } from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";
import { excludeViewersCondition } from "@/lib/users-filter";

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

interface SpeedruncomUserSearchResponse {
  data: {
    id: string;
    names: {
      international: string;
    };
  }[];
}

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

export async function loader({ request }: { request: Request }) {
  // セキュリティ: Vercel Cron認証（fail closed）。
  // CRON_SECRET が未設定の場合はチェックを飛ばさず拒否する。飛ばすと、
  // 全公開ユーザーを走査してレート制限付き外部APIを叩き DB 書き込みを行う
  // この重い処理を、匿名の攻撃者が自由に起動できてしまうため。
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    console.error("CRON_SECRET is not configured; refusing cron request");
    return new Response("Service Unavailable", { status: 503 });
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    console.warn("Unauthorized cron request attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("Rankings update started:", new Date().toISOString());

  try {
    const db = createDb();

    // アクティブなカテゴリを取得
    const categories = await db.query.speedrunCategories.findMany({
      where: eq(speedrunCategories.isActive, true),
    });

    // 公開ユーザーを取得（視聴者ロールは除外）
    const allUsers = await db.query.users.findMany({
      where: and(eq(users.profileVisibility, "public"), excludeViewersCondition),
      columns: {
        id: true,
        mcid: true,
        uuid: true,
        speedruncomId: true,
        speedruncomUsername: true,
      },
    });

    console.log(`Processing ${allUsers.length} users, ${categories.length} categories`);

    let speedruncomUpdates = 0;
    let rankedPbUpdates = 0;
    let rankedEloUpdates = 0;
    let speedruncomIdResolved = 0;

    for (const user of allUsers) {
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
            speedruncomIdResolved++;
            console.log(`Resolved Speedrun.com ID for ${user.mcid}: ${resolvedId}`);
          } else {
            console.log(`Could not resolve Speedrun.com ID for ${user.mcid} (username: ${username})`);
          }
          await sleep(500); // レート制限対策
        } catch (error) {
          console.error(`Error resolving Speedrun.com ID for ${user.mcid}:`, error);
        }
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

              const existing = await db.query.playerRankings.findFirst({
                where: and(
                  eq(playerRankings.userId, user.id),
                  eq(playerRankings.rankingType, "speedruncom"),
                  eq(playerRankings.categoryId, category.id),
                  eq(playerRankings.speedruncomRunId, matchingPb.run.id)
                ),
              });

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
              } else {
                // 同じカテゴリの古い承認済み記録を削除してから新規作成。
                // 削除と挿入をトランザクションで原子化し、並行 cron での孤児化を防ぐ。
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
              }

              speedruncomUpdates++;
            }

            // 未承認記録を保存/更新
            for (const pendingRun of matchingPendingRuns) {
              const timeMs = pendingRun.times.primary_t * 1000;
              const videoUrl = pendingRun.videos?.links?.[0]?.uri;

              const existingPending = await db.query.playerRankings.findFirst({
                where: and(
                  eq(playerRankings.userId, user.id),
                  eq(playerRankings.rankingType, "speedruncom"),
                  eq(playerRankings.speedruncomRunId, pendingRun.id)
                ),
              });

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
              } else {
                await db.insert(playerRankings).values({
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
              }

              speedruncomUpdates++;
            }

            // 承認済みになった未承認記録を削除（APIで未承認として返ってこなくなった記録）
            const existingPendingRecords = await db.query.playerRankings.findMany({
              where: and(
                eq(playerRankings.userId, user.id),
                eq(playerRankings.rankingType, "speedruncom"),
                eq(playerRankings.categoryId, category.id),
                eq(playerRankings.verificationStatus, "new")
              ),
            });

            for (const existingPending of existingPendingRecords) {
              const stillPending = matchingPendingRuns.some(
                (run) => run.id === existingPending.speedruncomRunId
              );
              if (!stillPending) {
                // 未承認でなくなった記録を削除（承認済みまたはリジェクトされた）
                await db.delete(playerRankings).where(eq(playerRankings.id, existingPending.id));
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
              const existingPb = await db.query.playerRankings.findFirst({
                where: and(
                  eq(playerRankings.userId, user.id),
                  eq(playerRankings.rankingType, "ranked_pb")
                ),
              });

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
              } else {
                await db.insert(playerRankings).values({
                  userId: user.id,
                  rankingType: "ranked_pb",
                  timeMs: bestTime,
                  timeFormatted: formatTimeMs(bestTime),
                  lastFetched: new Date(),
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

              const existingElo = await db.query.playerRankings.findFirst({
                where: and(
                  eq(playerRankings.userId, user.id),
                  eq(playerRankings.rankingType, "ranked_elo")
                ),
              });

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
                await db.insert(playerRankings).values({
                  userId: user.id,
                  rankingType: "ranked_elo",
                  eloRate: userData.eloRate,
                  wins,
                  losses,
                  winRate,
                  lastFetched: new Date(),
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
    }

    // ============================================
    // 重複した審査済み記録の整理
    // 同一プレイヤー・同一カテゴリで審査済み(verified)記録が複数ある場合、
    // 最速（timeMs 最小）のみ残し、遅い方を削除する。
    // ============================================
    let duplicatesRemoved = 0;
    const verifiedRecords = await db.query.playerRankings.findMany({
      where: and(
        eq(playerRankings.rankingType, "speedruncom"),
        eq(playerRankings.verificationStatus, "verified")
      ),
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

    if (duplicateIds.length > 0) {
      await db.delete(playerRankings).where(inArray(playerRankings.id, duplicateIds));
      duplicatesRemoved = duplicateIds.length;
    }

    console.log(`Rankings update completed: SRC=${speedruncomUpdates}, PB=${rankedPbUpdates}, Elo=${rankedEloUpdates}, IDs resolved=${speedruncomIdResolved}, dup removed=${duplicatesRemoved}`);

    return Response.json({
      success: true,
      message: "Rankings updated successfully",
      stats: {
        usersProcessed: allUsers.length,
        categoriesCount: categories.length,
        speedruncomUpdates,
        rankedPbUpdates,
        rankedEloUpdates,
        speedruncomIdResolved,
        duplicatesRemoved,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to update rankings:", error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
