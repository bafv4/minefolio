// users.rtaStartedYearMonth（"YYYY-MM" 文字列、未回答は null）のパース・検証・経過期間算出と、
// 表示用の文言組み立て。
// サーバー（/me/edit の action 検証）とクライアント（プロフィール表示・比較・編集フォーム）の
// 双方から使うため、.server ではない純粋モジュールに置く。
import type { Locale } from "./locale";
import type { Translator } from "./messages";

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

/** パース済みの開始年月から現在までの経過期間を算出する（範囲検証は呼び出し側の責務） */
function elapsedFrom(started: RtaStartedYearMonth, now: Date): RtaCareerElapsed {
  const totalMonths = Math.max(
    0,
    toTotalMonths(now.getFullYear(), now.getMonth() + 1) -
      toTotalMonths(started.year, started.month),
  );

  return {
    totalMonths,
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
  };
}

/**
 * 開始年月から現在までの経過期間を算出する。値が不正なら null。
 * 日は考慮せず月単位で数える（"2020-06" と 2026-08 なら 74 ヶ月 = 6年2ヶ月）。
 */
export function rtaCareerElapsed(value: string, now: Date = new Date()): RtaCareerElapsed | null {
  const parsed = parseRtaStartedYearMonth(value);
  if (!parsed || !isInRange(parsed, now)) return null;
  return elapsedFrom(parsed, now);
}

/** 表示用の RTA歴（経過期間 + ロケールに合わせて整形した開始年月） */
export type RtaCareerView = RtaCareerElapsed & {
  /** 開始年月の表示。ja: "2020/6" / en: "Jun 2020" */
  start: string;
};

// 年月だけを UTC 基準で整形する（ローカルタイムゾーンだと月がずれる環境がある）
const EN_START_FORMATTER = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** 開始年月の表示文字列（ja は "2020/6"、en は "Jun 2020"） */
export function formatRtaStartedLabel(
  started: RtaStartedYearMonth,
  locale: Locale,
): string {
  if (locale === "ja") return `${started.year}/${started.month}`;
  return EN_START_FORMATTER.format(Date.UTC(started.year, started.month - 1, 1));
}

/**
 * 保存値（"YYYY-MM"）から表示用の RTA歴を組み立てる。未回答・不正値は null。
 * `now` は SSR とハイドレーションで結果を揃えるため、呼び出し側が基準時刻を渡す。
 */
export function rtaCareerView(
  value: string | null | undefined,
  locale: Locale,
  now: Date = new Date(),
): RtaCareerView | null {
  if (!value) return null;
  const started = parseRtaStartedYearMonth(value);
  if (!started || !isInRange(started, now)) return null;
  const elapsed = elapsedFrom(started, now);
  return { ...elapsed, start: formatRtaStartedLabel(started, locale) };
}

/** 年表示が端数月を切り捨てているか（＝ヒントで正確な経過を補う価値があるか） */
export function hasRtaCareerRemainder(view: RtaCareerView): boolean {
  return view.years >= 1 && view.months > 0;
}

/**
 * 画面に出す RTA歴の文言。1年以上は年のみ（端数月は切り捨て）、
 * 1年未満は月数、開始月と同じ月なら「1か月未満」。
 * 英語の単複は文言側で分けるため、1 のときだけ単数キーへ切り替える。
 */
export function rtaCareerLabel(t: Translator, view: RtaCareerView): string {
  if (view.totalMonths === 0) {
    return t("playerProfile.rtaCareerJustStarted", { start: view.start });
  }
  if (view.years >= 1) {
    return t(
      view.years === 1
        ? "playerProfile.rtaCareerYearsOne"
        : "playerProfile.rtaCareerYears",
      { years: view.years, start: view.start },
    );
  }
  return t(
    view.months === 1
      ? "playerProfile.rtaCareerMonthsOne"
      : "playerProfile.rtaCareerMonths",
    { months: view.months, start: view.start },
  );
}

/** 端数月まで含む正確な文言。端数が無ければ通常表記と同じものを返す */
export function rtaCareerExactLabel(t: Translator, view: RtaCareerView): string {
  if (!hasRtaCareerRemainder(view)) return rtaCareerLabel(t, view);
  // 英語の単複（1 year / 2 months）に対応するため、年・月を単位付き文字列に
  // 組み立ててからテンプレートへ渡す（ja は単複同形なので同じ値）
  const years = t(
    view.years === 1
      ? "playerProfile.rtaCareerYearsUnitOne"
      : "playerProfile.rtaCareerYearsUnit",
    { years: view.years },
  );
  const months = t(
    view.months === 1
      ? "playerProfile.rtaCareerMonthsUnitOne"
      : "playerProfile.rtaCareerMonthsUnit",
    { months: view.months },
  );
  return t("playerProfile.rtaCareerExact", { years, months, start: view.start });
}
