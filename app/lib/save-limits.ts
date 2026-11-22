/**
 * 設定・装備まわりの保存（キー配置・デバイス・アイテム・サーチクラフト・プリセット・インポート）の
 * 件数・文字数の上限と、フォーム値の小さな検証ヘルパー。
 *
 * 上限は「悪用で DB を膨らませられない」水準（現実的な最大の10倍程度）。画面側の上限より緩く、
 * 既存データがこの値を超えて保存できなくなることを避ける。超過したらエラーを返し、何も書かない。
 * `.server` ではないモジュールに置く（描画側・テストからも参照できるように）。
 */

export const SAVE_LIMITS = {
  /** 1ユーザーのプリセット数（コピーも数える） */
  presetsPerUser: 50,
  presetName: 100,
  presetDescription: 500,

  /** リマップ（保存後の総数。/me/import の1回あたり上限 1000 と同じ） */
  remaps: 1000,
  /** カスタムキー（保存後の総数） */
  customKeys: 200,
  /** カスタムアクション（保存後の総数） */
  customActions: 200,
  /** キーバインド更新（既存の上限） */
  keybindingUpdates: 1000,
  /** キー名・アクション名・ソフト名・キーコードなどの短い文字列 */
  shortText: 200,
  /** メモ・説明などの長めの文字列（リマップ・カスタムアクション） */
  memo: 1000,

  /** アイテム配置の件数 */
  itemLayouts: 100,
  /** 1配置あたりのスロット数・オフハンドのアイテム数・1スロットのアイテム数 */
  itemSlotsPerLayout: 100,
  itemsPerSlot: 50,
  segmentName: 100,
  layoutNotes: 10000,

  /** サーチクラフトの件数・1件あたりのアイテム数・コメント・サーチ文字列 */
  searchCrafts: 500,
  craftItems: 50,
  craftComment: 500,
  craftSearchString: 500,
  /** Loop の件数（1つあたりのステップ数は search-craft-templates の MAX_LOOP_STEPS） */
  searchCraftLoops: 200,

  keyboardModel: 100,
  mouseModel: 100,
  controllerModel: 100,
  deviceNotes: 10000,
} as const;

/** 文字列で、かつ max 文字以内か */
export function isStringWithin(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

/** 欠落・null、または max 文字以内の文字列か（任意の文字列欄の検証） */
export function isOptionalStringWithin(value: unknown, max: number): boolean {
  return value === undefined || value === null || isStringWithin(value, max);
}

/**
 * FormData から文字列欄を取り出す。未送信や File（`as string` で通すと `.trim` が TypeError で 500 になる）は null。
 */
export function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

/** FOV（Minecraft の設定範囲）。整数 30〜110 */
export function isValidFov(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 110;
}

/**
 * GUI スケール。整数 0〜10（0 = 自動）。
 * バニラは高解像度環境で 5〜9 が正当値になりうるため上限は 10 まで許容する。
 */
export function isValidGuiScale(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
}
