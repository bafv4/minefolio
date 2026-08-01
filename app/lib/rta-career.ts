// users.rtaStartedYearMonth（"YYYY-MM" 文字列、未回答は null）のパース・検証・経過期間算出。
// サーバー（/me/edit の action 検証）とクライアント（プロフィール表示・編集フォーム）の
// 双方から使うため、.server ではない純粋モジュールに置く。

/** RTA開始年月の下限。Minecraft の公開年（2009）より前は不正扱いにする */
export const RTA_STARTED_MIN_YEAR = 2009;

const RTA_STARTED_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type RtaStartedYearMonth = {
  year: number;
  /** 1〜12（0起点ではない） */
  month: number;
};

export type RtaCareerElapsed = {
  totalMonths: number;
  years: number;
  /** 年に満たない端数の月数（0〜11） */
  months: number;
};

/**
 * "YYYY-MM" を年・月に分解する。書式が不正なら null。
 * 範囲（下限・未来）の検証は行わない — `isValidRtaStartedYearMonth` を使う。
 */
export function parseRtaStartedYearMonth(value: string): RtaStartedYearMonth | null {
  if (!RTA_STARTED_PATTERN.test(value)) return null;
  const [year, month] = value.split("-");
  return { year: Number(year), month: Number(month) };
}

/** 年月を通算月数に変換（比較用） */
function toTotalMonths(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function isInRange(parsed: RtaStartedYearMonth, now: Date): boolean {
  if (parsed.year < RTA_STARTED_MIN_YEAR) return false;
  // 未来の年月は不正
  return (
    toTotalMonths(parsed.year, parsed.month) <=
    toTotalMonths(now.getFullYear(), now.getMonth() + 1)
  );
}

/** "YYYY-MM" 書式で、かつ 2009-01 以上・現在年月以下かどうか */
export function isValidRtaStartedYearMonth(value: string, now: Date = new Date()): boolean {
  const parsed = parseRtaStartedYearMonth(value);
  return parsed !== null && isInRange(parsed, now);
}

/**
 * 開始年月から現在までの経過期間を算出する。値が不正なら null。
 * 日は考慮せず月単位で数える（"2020-06" と 2026-08 なら 74 ヶ月 = 6年2ヶ月）。
 */
export function rtaCareerElapsed(value: string, now: Date = new Date()): RtaCareerElapsed | null {
  const parsed = parseRtaStartedYearMonth(value);
  if (!parsed || !isInRange(parsed, now)) return null;

  const totalMonths = Math.max(
    0,
    toTotalMonths(now.getFullYear(), now.getMonth() + 1) - toTotalMonths(parsed.year, parsed.month),
  );

  return {
    totalMonths,
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
  };
}
