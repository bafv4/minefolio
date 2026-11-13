import { asc } from "drizzle-orm";
import { searchCrafts, searchCraftLoops } from "./schema";
import { serializeSearchCrafts, serializeRemaps, serializeSearchCraftLoops } from "./preset-utils";
import { filterRemapsForChat } from "./remap-utils";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  parseTemplateLoops,
  toEditorCrafts,
  toEditorLoops,
  toEditorRemaps,
} from "./search-craft-templates";

/**
 * テンプレートエディタ（新規・編集）のローダーが、ユーザーの現在のサーチクラフト設定を
 * 読むための `with` 句。`loadEditorSettingsFromUser` の入力になる。
 * （ライブ設定の読み込み専用。`schema` を値として使うため `.server` に置く）
 */
export const SEARCH_CRAFT_USER_WITH = {
  searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
  searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
  keyRemaps: true as const,
  playerConfig: { columns: { gameLanguage: true, keyboardLayout: true } as const },
};

/**
 * ユーザーのライブ設定（クラフト・リマップ・Loop）を、エディタの「現在の設定から読み込む」用の
 * 形（draft id 付き）へ変換する。
 */
export function loadEditorSettingsFromUser(user: {
  searchCrafts: Parameters<typeof serializeSearchCrafts>[0];
  searchCraftLoops: Parameters<typeof serializeSearchCraftLoops>[0];
  keyRemaps: Parameters<typeof serializeRemaps>[0];
}) {
  const crafts = toEditorCrafts(parseTemplateCrafts(serializeSearchCrafts(user.searchCrafts)));
  // ライブの Loop（craftId 参照）を、いったんプリセットと同一の craftSeq 形式に変換してから
  // craftIndex 形式へデコードし、現在の crafts の draft id へ解決する
  const loops = toEditorLoops(
    parseTemplateLoops(
      serializeSearchCraftLoops(user.searchCraftLoops, user.searchCrafts),
      crafts.length,
    ),
    crafts,
  );
  return {
    crafts,
    // テンプレートは chat 用途のため、trigger 専用リマップはプレフィルに含めない
    remaps: toEditorRemaps(filterRemapsForChat(parseTemplateRemaps(serializeRemaps(user.keyRemaps)))),
    loops,
  };
}
