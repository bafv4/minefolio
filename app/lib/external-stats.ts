// 外部サービス（Speedrun.com, PaceMan, MCSR Ranked）からの統計情報取得

// ============================================
// 型定義
// ============================================

// Speedrun.com
export interface SpeedrunComUser {
  id: string;
  names: {
    international: string;
    japanese?: string;
  };
  weblink: string;
}

export interface SpeedrunComPersonalBest {
  place: number;
  run: {
    id: string;
    weblink: string;
    game: string;
    category: string;
    level?: string;
    date: string;
    times: {
      primary_t: number; // 秒単位
    };
    videos?: {
      links?: { uri: string }[];
    };
    system?: {
      platform?: string; // プラットフォームID
      emulated?: boolean;
      region?: string;
    };
    values?: Record<string, string>; // variables の値（バージョン等）
  };
  game: {
    data: {
      id: string;
      names: { international: string };
      abbreviation: string;
      platforms?: {
        data?: { id: string; name: string }[];
      };
    };
  };
  category: {
    data: {
      id: string;
      name: string;
      variables?: {
        data?: {
          id: string;
          name: string;
          values: {
            values: Record<string, { label: string }>;
          };
        }[];
      };
    };
  };
  // 表示用に追加
  platformName?: string;
  versionName?: string;
}

export interface SpeedrunComStats {
  user: SpeedrunComUser | null;
  personalBests: SpeedrunComPersonalBest[];
  error?: string;
}

// PaceMan（登録確認のみ）
export interface PaceManStats {
  isRegistered: boolean; // プレイヤーがPaceManに登録されているか
}

// MCSR Ranked
export interface MCSRRankedUser {
  uuid: string;
  nickname: string;
  roleType: number;
  eloRate: number | null;
  eloRank: number | null;
  badge?: {
    uuid: string;
    name: string;
  };
}

export interface MCSRRankedSeasonData {
  season: number;
  seasonResult?: {
    eloRate: number;
    eloRank: number;
    phasePoint: number;
  };
  bestTime?: number;
  bestTimeAllTime?: number; // 全期間のベストタイム
  records: {
    win: number;
    lose: number;
    draw: number;
  };
  highestWinStreak: number;
  currentWinStreak: number;
  lastMatchDecay?: {
    decayDate: string;
    decayAmount: number;
  };
}

export interface MCSRRankedStats {
  isRegistered: boolean; // プレイヤーがMCSR Rankedに登録されているか
  user: MCSRRankedUser | null;
  seasonData: MCSRRankedSeasonData | null;
  recentMatches: MCSRRankedMatch[];
  error?: string;
}

export interface MCSRRankedMatch {
  id: string;
  type: number;
  season: number;
  date: string;
  result: "win" | "lose" | "draw";
  time: number | null;
  opponentUuid: string;
  opponentNickname: string;
  eloChange: number;
  eloAfter: number;
}

// ============================================
// Speedrun.com API
// ============================================
const SPEEDRUN_API_BASE = "https://www.speedrun.com/api/v1";

export async function fetchSpeedrunComStats(username: string): Promise<SpeedrunComStats> {
  try {
    // ユーザー情報を取得
    const userRes = await fetch(`${SPEEDRUN_API_BASE}/users?lookup=${encodeURIComponent(username)}`);
    if (!userRes.ok) {
      return { user: null, personalBests: [], error: "ユーザーが見つかりません" };
    }
    const userData = (await userRes.json()) as { data: SpeedrunComUser[] };
    const users = userData.data;

    if (!users || users.length === 0) {
      return { user: null, personalBests: [], error: "ユーザーが見つかりません" };
    }

    const user = users[0];

    // 自己ベストを取得（embeded game, category, platform, variables情報も取得）
    const pbRes = await fetch(
      `${SPEEDRUN_API_BASE}/users/${user.id}/personal-bests?embed=game.platforms,category.variables`
    );
    if (!pbRes.ok) {
      return { user, personalBests: [], error: "記録の取得に失敗しました" };
    }
    const pbData = (await pbRes.json()) as { data?: SpeedrunComPersonalBest[] };
    const rawPersonalBests = pbData.data ?? [];

    if (rawPersonalBests.length === 0) {
      return { user, personalBests: [] };
    }

    // platformNameとversionNameを設定
    const personalBests = rawPersonalBests.map((pb) => {
      // プラットフォーム名を取得
      let platformName: string | undefined;
      if (pb.run.system?.platform && pb.game?.data?.platforms?.data) {
        const platform = pb.game.data.platforms.data.find(
          (p) => p.id === pb.run.system?.platform
        );
        platformName = platform?.name;
      }

      // バージョン名を取得（variables から "Version" や "バージョン" を探す）
      let versionName: string | undefined;
      if (pb.run.values && pb.category?.data?.variables?.data) {
        for (const variable of pb.category.data.variables.data) {
          const varName = variable.name.toLowerCase();
          if (varName.includes("version") || varName.includes("バージョン")) {
            const valueId = pb.run.values[variable.id];
            if (valueId && variable.values.values[valueId]) {
              versionName = variable.values.values[valueId].label;
              break;
            }
          }
        }
      }

      return {
        ...pb,
        platformName,
        versionName,
      };
    });

    // Minecraftカテゴリのみフィルタ（任意）
    const minecraftPbs = personalBests.filter(
      (pb) => pb.game?.data?.abbreviation?.toLowerCase().includes("mc") ||
              pb.game?.data?.names?.international?.toLowerCase().includes("minecraft")
    );

    return { user, personalBests: minecraftPbs.length > 0 ? minecraftPbs : personalBests };
  } catch (error) {
    console.error("Speedrun.com API error:", error);
    return { user: null, personalBests: [], error: "APIエラーが発生しました" };
  }
}

// ============================================
// PaceMan API（登録確認のみ）
// ============================================
const PACEMAN_API_BASE = "https://paceman.gg/stats/api";

// PaceManプレイヤー登録確認
export async function checkPaceManPlayer(playerName: string): Promise<PaceManStats> {
  try {
    // getSessionStats APIはプレイヤーが存在しない場合 {"error":"Unknown user"} を返す
    const res = await fetch(`${PACEMAN_API_BASE}/getSessionStats/?name=${encodeURIComponent(playerName)}&hours=24`);
    if (!res.ok) return { isRegistered: false };
    const data = await res.json() as { error?: string } | Record<string, unknown> | null;
    // エラーレスポンスの場合は未登録
    if (data && typeof data === "object" && "error" in data) {
      return { isRegistered: false };
    }
    return { isRegistered: true };
  } catch {
    return { isRegistered: false };
  }
}

// ============================================
// MCSR Ranked API
// ============================================
const RANKED_API_BASE = "https://mcsrranked.com/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RankedApiResponse = { status: string; data: any };

// マッチタイプ定数
const MATCH_TYPE_RANKED = 2;

export async function fetchMCSRRankedStats(identifier: string): Promise<MCSRRankedStats> {
  try {
    // ユーザー情報を取得（存在確認を兼ねる）
    const userRes = await fetch(`${RANKED_API_BASE}/users/${encodeURIComponent(identifier)}`);
    if (!userRes.ok) {
      return { isRegistered: false, user: null, seasonData: null, recentMatches: [] };
    }

    const userData = (await userRes.json()) as RankedApiResponse | null;
    if (!userData || userData.status !== "success" || !userData.data) {
      return { isRegistered: false, user: null, seasonData: null, recentMatches: [] };
    }

    // UUIDがない場合は未登録
    if (!userData.data.uuid) {
      return { isRegistered: false, user: null, seasonData: null, recentMatches: [] };
    }

    const user: MCSRRankedUser = {
      uuid: userData.data.uuid,
      nickname: userData.data.nickname ?? "Unknown",
      roleType: userData.data.roleType ?? 0,
      eloRate: userData.data.eloRate ?? null,
      eloRank: userData.data.eloRank ?? null,
      badge: userData.data.badge,
    };

    // シーズンデータ（最新シーズン）と全期間統計
    let seasonData: MCSRRankedSeasonData | null = null;
    if (userData.data.statistics) {
      const stats = userData.data.statistics;

      // Rankedモードの数値のみを抽出するヘルパー
      const extractRankedNumber = (value: unknown): number | null => {
        if (value == null) return null;
        if (typeof value === "number") return value;
        if (typeof value === "object" && value !== null) {
          const obj = value as { ranked?: number | null; casual?: number | null };
          return obj.ranked ?? null;
        }
        return null;
      };

      // 全期間のRankedベストタイムを取得
      const bestTimeAllTime = extractRankedNumber(stats.total?.bestTime);

      // 今シーズンのRankedベストタイム
      const seasonBestTime = extractRankedNumber(stats.season?.bestTime);

      seasonData = {
        season: 0, // シーズン番号はAPIから取得できないため0で初期化
        seasonResult: userData.data.seasonResult,
        bestTime: seasonBestTime ?? undefined,
        bestTimeAllTime: bestTimeAllTime ?? undefined,
        records: {
          win: extractRankedNumber(stats.season?.wins) ?? 0,
          lose: extractRankedNumber(stats.season?.loses) ?? 0,
          draw: 0, // drawsはAPIに存在しない
        },
        highestWinStreak: extractRankedNumber(stats.season?.highestWinStreak) ?? 0,
        currentWinStreak: extractRankedNumber(stats.season?.currentWinStreak) ?? 0,
      };
    }

    // 最近のRankedマッチ履歴を取得（type=2でRankedモードのみ、30件）
    const matchesRes = await fetch(
      `${RANKED_API_BASE}/users/${encodeURIComponent(identifier)}/matches?count=30&type=${MATCH_TYPE_RANKED}`
    );
    let recentMatches: MCSRRankedMatch[] = [];

    if (matchesRes.ok) {
      const matchesData = (await matchesRes.json()) as RankedApiResponse | null;
      if (matchesData && matchesData.status === "success" && Array.isArray(matchesData.data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recentMatches = matchesData.data
          .filter((m: any) => m && m.id && Array.isArray(m.players) && m.type === MATCH_TYPE_RANKED)
          .map((m: any) => {
            // 自分のUUIDを特定
            const playerIndex = m.players?.findIndex((p: any) => p?.uuid === user.uuid) ?? -1;
            const opponentIndex = playerIndex === 0 ? 1 : 0;
            const opponentData = m.players?.[opponentIndex];

            // 勝敗判定: result.uuid が勝者
            let result: "win" | "lose" | "draw" = "draw";
            if (m.result?.uuid) {
              result = m.result.uuid === user.uuid ? "win" : "lose";
            } else if (m.forfeited && m.result?.uuid) {
              result = m.result.uuid === user.uuid ? "win" : "lose";
            }

            // 自分のタイム: 勝者のみtimeが記録される
            const playerTime = m.result?.uuid === user.uuid ? m.result?.time : null;

            // Elo変動: changes配列から自分のデータを取得
            const playerChange = Array.isArray(m.changes)
              ? m.changes.find((c: any) => c?.uuid === user.uuid)
              : null;
            const eloChange = playerChange?.change ?? 0;
            const eloAfter = playerChange?.eloRate ? playerChange.eloRate + eloChange : 0;

            return {
              id: String(m.id),
              type: m.type ?? 0,
              season: m.season ?? 0,
              date: m.date ?? "",
              result,
              time: playerTime ?? null,
              opponentUuid: opponentData?.uuid ?? "",
              opponentNickname: opponentData?.nickname ?? "Unknown",
              eloChange,
              eloAfter,
            };
          });
      }
    }

    return { isRegistered: true, user, seasonData, recentMatches };
  } catch (error) {
    console.error("MCSR Ranked API error:", error);
    return { isRegistered: false, user: null, seasonData: null, recentMatches: [], error: "APIエラーが発生しました" };
  }
}

// ============================================
// 統合取得関数
// ============================================
export interface ExternalStatsData {
  speedruncom?: SpeedrunComStats;
  paceman?: PaceManStats;
  ranked?: MCSRRankedStats;
}

export async function fetchAllExternalStats(
  mcid: string,
  speedruncomUsername?: string | null,
): Promise<ExternalStatsData> {
  const results: ExternalStatsData = {};

  // 並列で取得
  const promises: Promise<void>[] = [];

  // Speedrun.com（ユーザー名が設定されている場合のみ）
  if (speedruncomUsername) {
    promises.push(
      fetchSpeedrunComStats(speedruncomUsername).then((data) => {
        results.speedruncom = data;
      })
    );
  }

  // PaceMan（MCIDで検索、登録確認のみ）
  promises.push(
    checkPaceManPlayer(mcid).then((data) => {
      results.paceman = data;
    })
  );

  // MCSR Ranked（MCIDで検索）
  promises.push(
    fetchMCSRRankedStats(mcid).then((data) => {
      results.ranked = data;
    })
  );

  await Promise.all(promises);

  return results;
}
