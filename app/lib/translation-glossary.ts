// 自動翻訳の用語集（ja ↔ en）。詳細は docs/translation.md。
//
// MCSR（Minecraft スピードラン）の記事は固有の用語で機械翻訳が崩れる。
// 「ブラインド」を "blind"（形容詞）と訳す、「分岐」を "branch" と直訳する、といった破綻を
// プロンプトへ対訳を載せることで防ぐ。
//
// **エントリを増減・修正したら GLOSSARY_VERSION を上げること。**
// 翻訳キャッシュ（content_translations.glossaryVersion）の失効キーになっているため、
// 上げないと古い訳文が残り続ける。

/**
 * 用語集のバージョン。
 * GLOSSARY を変更したら必ずインクリメントする（既存の翻訳がすべて失効し、再翻訳される）。
 */
export const GLOSSARY_VERSION = 1;

/** 対訳 1 件。note は訳し分けの指示（任意） */
export interface GlossaryEntry {
  ja: string;
  en: string;
  /** 誤訳しやすい理由・使い分けの補足。プロンプトへ載せる */
  note?: string;
}

/**
 * ja ↔ en の対訳。方向は問わない（プロンプトでは対訳表として提示する）。
 *
 * 載せる基準:
 * - 一般語と綴りが同じで文脈依存の誤訳が起きるもの（ブラインド / 分岐 / ピース）
 * - 競技コミュニティの定訳があるもの（RSG / Any% / 更新）
 * 載せないもの:
 * - 訳す必要がない固有名詞（Minecraft / Java / Bedrock）。これは「訳さない」指示側で扱う
 */
export const GLOSSARY: GlossaryEntry[] = [
  // --- ラン種別・カテゴリ ---
  { ja: "ランダムシード", en: "Random Seed Glitchless (RSG)" },
  { ja: "セットシード", en: "Set Seed Glitchless (SSG)" },
  { ja: "走者", en: "runner" },
  { ja: "走る", en: "to run (a category)", note: "「記事を走る」ではなく走行のこと" },
  { ja: "詰め", en: "optimization", note: "タイムを詰める＝shave time。直訳の stuffing は誤り" },
  { ja: "更新", en: "personal best (PB)", note: "記録の文脈では「自己ベスト更新」。ソフトウェア更新の update とは別" },

  // --- 進行・地形 ---
  { ja: "ネザー入り", en: "nether enter" },
  { ja: "バスティオン", en: "bastion" },
  { ja: "砦", en: "bastion", note: "バスティオン（Bastion Remnant）の略称として使われる" },
  { ja: "要塞", en: "fortress", note: "ネザー要塞（Nether Fortress）。ストロングホールドとは別物" },
  { ja: "ストロングホールド", en: "stronghold" },
  { ja: "エンド入り", en: "end enter" },
  { ja: "分岐", en: "route split", note: "ルートの分かれ目。プログラムの branch ではない" },
  { ja: "ブラインド", en: "blind travel", note: "エンダーアイの1投目から直接向かう手法。形容詞の blind ではない" },
  { ja: "ピース", en: "peaceful", note: "難易度ピースフル。piece ではない" },

  // --- アイテム・数値 ---
  { ja: "エンダーアイ", en: "Eye of Ender" },
  { ja: "エンダーパール", en: "Ender Pearl" },
  { ja: "ブレイズロッド", en: "Blaze Rod" },
  { ja: "取引", en: "bartering", note: "ピグリンとの交換。trade（村人）とは区別する" },
  { ja: "湧き", en: "spawn rate", note: "mob の湧き。プレイヤーのリスポーンとは別" },

  // --- 操作・設定（本サイト固有の語彙）---
  { ja: "キー配置", en: "keybindings" },
  { ja: "リマップ", en: "key remap" },
  { ja: "サーチクラフト", en: "search craft" },
  { ja: "振り向き", en: "cm/360", note: "マウス感度の指標。turning around ではない" },
  { ja: "指割り当て", en: "finger assignment" },
  { ja: "プリセット", en: "preset" },
];

/** プロンプトへ載せる対訳表（1行1件） */
export function formatGlossary(): string {
  return GLOSSARY.map((e) =>
    e.note ? `${e.ja} = ${e.en}  // ${e.note}` : `${e.ja} = ${e.en}`,
  ).join("\n");
}
