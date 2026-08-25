// MCSR Ranked の階級（レート帯）算出。
//
// MCSR Ranked API（mcsrranked.com）はユーザーの Elo レート（`eloRate`）のみを返し、
// 階級（Coal〜Netherite、及びそのサブディビジョン I〜III）は含まれない。
// そのため公式ゲーム内UI（https://wiki.mcsrranked.com/gameplay/elo_and_ranks の画像で
// 確認済みの閾値）を基に、Elo レートからクライアント側で階級を算出する。
//
// サーバー・クライアント双方（ランキング一覧のサーバーレンダリングと、プロフィールページの
// クライアント側フェッチ）から参照するため `.server` にしない純粋モジュール。

export type RankTierKey = "coal" | "iron" | "gold" | "emerald" | "diamond" | "netherite";

export interface RankTier {
  key: RankTierKey;
  /** サブディビジョン（I=1〜III=3、数字が大きいほど上位）。Netherite はサブディビジョンなし */
  division: 1 | 2 | 3 | null;
  /** 表示ラベル（例: "Coal I" "Diamond III" "Netherite"）。英語固有名のため翻訳しない */
  label: string;
}

interface TierThreshold {
  /** この閾値以上の Elo レートで到達する階級（昇順で定義） */
  minElo: number;
  key: RankTierKey;
  division: 1 | 2 | 3 | null;
}

const TIER_KEY_LABELS: Record<RankTierKey, string> = {
  coal: "Coal",
  iron: "Iron",
  gold: "Gold",
  emerald: "Emerald",
  diamond: "Diamond",
  netherite: "Netherite",
};

const DIVISION_LABELS: Record<1 | 2 | 3, string> = {
  1: "I",
  2: "II",
  3: "III",
};

// 公式ゲーム内UIで確認済みの閾値（昇順）。Diamond は II が 1650+、III が 1800+ と
// 他階級（100刻み）と異なる非対称な区切りになっている点に注意。
const TIER_THRESHOLDS: TierThreshold[] = [
  { minElo: 0, key: "coal", division: 1 },
  { minElo: 400, key: "coal", division: 2 },
  { minElo: 500, key: "coal", division: 3 },
  { minElo: 600, key: "iron", division: 1 },
  { minElo: 700, key: "iron", division: 2 },
  { minElo: 800, key: "iron", division: 3 },
  { minElo: 900, key: "gold", division: 1 },
  { minElo: 1000, key: "gold", division: 2 },
  { minElo: 1100, key: "gold", division: 3 },
  { minElo: 1200, key: "emerald", division: 1 },
  { minElo: 1300, key: "emerald", division: 2 },
  { minElo: 1400, key: "emerald", division: 3 },
  { minElo: 1500, key: "diamond", division: 1 },
  { minElo: 1650, key: "diamond", division: 2 },
  { minElo: 1800, key: "diamond", division: 3 },
  { minElo: 2000, key: "netherite", division: null },
];

function formatLabel(key: RankTierKey, division: 1 | 2 | 3 | null): string {
  if (division === null) return TIER_KEY_LABELS[key];
  return `${TIER_KEY_LABELS[key]} ${DIVISION_LABELS[division]}`;
}

/**
 * Elo レートから MCSR Ranked の階級を算出する。
 * 負値は Coal I 扱い。閾値テーブル（`TIER_THRESHOLDS`）は昇順のため、
 * 該当レート以下の閾値のうち最も高いものを採用する。
 */
export function getRankTier(eloRate: number): RankTier {
  const clampedElo = Math.max(0, Number.isFinite(eloRate) ? eloRate : 0);

  let matched = TIER_THRESHOLDS[0];
  for (const threshold of TIER_THRESHOLDS) {
    if (clampedElo < threshold.minElo) break;
    matched = threshold;
  }

  return {
    key: matched.key,
    division: matched.division,
    label: formatLabel(matched.key, matched.division),
  };
}
