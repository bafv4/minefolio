// 操作設定の変更履歴（config_history）のうち、「公開面に影響する変更」を判定する単一の決定点。
//
// 背景: 公開面（プロフィール・操作設定一覧・比較等）はメイン（config_presets.isMain）プリセットの
// 内容を表示する（docs/presets.md、shouldUsePresetSnapshot()）。メインでない編集・作成・削除・
// 編集対象の切替（apply-preset）は公開内容を変えないため、「お気に入り走者の動き」には出さない。
//
// 記録規約（スキーマ変更なし）:
//   config_history.preset_id は「公開面に影響する変更のときだけ、そのメインプリセットの id を入れる」。
//   影響しない変更は null。書き込み側は resolve*PublicPresetId() の返り値をそのまま preset_id に入れる。
//   読み取り側は publicConfigChangeCondition() で絞り込む。
//   preset_id を履歴画面（/me/presets）が読むことはない（列を選択していない）ため意味を変えて問題ない。
//
// 移行前の既存行: 旧実装は apply-preset・非メイン作成などでも preset_id を入れていたため、
// preset_id だけでは公開影響の有無を区別できない。PUBLIC_CONFIG_HISTORY_SINCE より前の行は
// 一律で「公開影響なし」として扱う（プライバシー保護側に倒す）。
import { and, eq, gte, isNotNull, type SQL } from "drizzle-orm";
import { configHistory, configPresets } from "./schema";
import type { Database } from "./db";

type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** この規約で書かれた行の開始時刻（これより前の行は判定情報が無いため公開影響なし扱い） */
export const PUBLIC_CONFIG_HISTORY_SINCE = new Date("2026-11-14T00:00:00Z");

/**
 * config_history の行のうち、公開面に影響した変更だけを選ぶ SQL 条件。
 * 例: db.select().from(configHistory).where(and(inArray(configHistory.userId, ids), publicConfigChangeCondition()))
 */
export function publicConfigChangeCondition(since: Date = PUBLIC_CONFIG_HISTORY_SINCE): SQL {
  return and(isNotNull(configHistory.presetId), gte(configHistory.createdAt, since))!;
}

/**
 * 指定プリセットがそのユーザーのメインなら id を返す（preset_id に入れる値）。メインでなければ null。
 * 「メインへ切替」「メインの作成」「メインを対象にした反映（Playground・テンプレート）」用。
 */
export async function resolvePublicPresetId(
  db: DatabaseOrTransaction,
  userId: string,
  presetId: string,
): Promise<string | null> {
  const row = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.id, presetId), eq(configPresets.userId, userId), eq(configPresets.isMain, true)),
    columns: { id: true },
  });
  return row?.id ?? null;
}

/**
 * 編集中（isActive）のプリセットがメインなら、その id を返す。それ以外は null。
 * ライブ設定（キー配置・デバイス・アイテム・サーチクラフト等）の保存は編集中プリセットへ
 * 書き込むため、「メイン＝編集中」のときだけ公開面に影響する。
 */
export async function resolveActivePublicPresetId(
  db: DatabaseOrTransaction,
  userId: string,
): Promise<string | null> {
  const row = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, userId), eq(configPresets.isActive, true), eq(configPresets.isMain, true)),
    columns: { id: true },
  });
  return row?.id ?? null;
}
