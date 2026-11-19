// /keybindings 配下の URL ↔ state 同期用 nuqs parser 定義。
// すべてのビュー（grid/table/stats）とサブタブ、フィルタを統合管理する。
import {
  createSerializer,
  parseAsArrayOf,
  parseAsFloat,
  parseAsString,
  parseAsStringEnum,
} from "nuqs";

/**
 * 表ビュー内のサブタブ。操作はプレイヤー画面と同じ粒度
 * （移動 / インベントリ / 戦闘・UI）で分け、加えてリマップ・カスタム・マウス。
 * ビュー（表 / ビジュアル / 統計）自体は独立ルートに分割済み。
 */
export const TAB_OPTIONS = [
  "movement",
  "inventory",
  "combat-ui",
  "remaps",
  "custom-actions",
  "mouse",
] as const;
export type Tab = (typeof TAB_OPTIONS)[number];

/**
 * 表のタブごとの操作（列の並び順）。列定義・操作＝キーの絞り込み・統計からの遷移先タブが
 * 同じ分類を参照するため、ここを単一情報源にする。
 * ホットバー 1〜9 は表では 1 列（`action.hotbar`）に集約するが、操作としては個別に持つ。
 */
export const MOVEMENT_ACTIONS = ["forward", "back", "left", "right", "jump", "sneak", "sprint"] as const;
export const HOTBAR_ACTIONS = [
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
] as const;
export const INVENTORY_ACTIONS = ["swapHands", "inventory", "pickBlock", "drop"] as const;
export const COMBAT_UI_ACTIONS = [
  "attack",
  "use",
  "togglePerspective",
  "chat",
  "command",
  "fullscreen",
] as const;

/** 「操作＝キー」の絞り込みで選べる操作（表の列と同じ順） */
export const BIND_FILTER_ACTIONS: readonly string[] = [
  ...MOVEMENT_ACTIONS,
  ...INVENTORY_ACTIONS,
  ...HOTBAR_ACTIONS,
  ...COMBAT_UI_ACTIONS,
];

/** その操作が載っている表のタブ。表にない操作は null */
export function tabForAction(action: string): Tab | null {
  const is = (list: readonly string[]) => list.includes(action);
  if (is(MOVEMENT_ACTIONS)) return "movement";
  if (is(INVENTORY_ACTIONS) || is(HOTBAR_ACTIONS)) return "inventory";
  if (is(COMBAT_UI_ACTIONS)) return "combat-ui";
  return null;
}

/**
 * 並べ替えキー（表の列 id・URL の sort）がそのタブの列か。タブを替えたときに、
 * 移った先に無い列の並べ替えを外すのに使う（"mouse.*" はマウス、"action.*" は操作の分類で決まる。
 * ホットバーは 1 列 "action.hotbar" に集約されていてインベントリのタブにある）。
 */
export function sortKeyBelongsToTab(key: string, tab: Tab): boolean {
  if (key.startsWith("mouse.")) return tab === "mouse";
  if (key.startsWith("action.")) {
    const action = key.slice("action.".length);
    return (action === "hotbar" ? "inventory" : tabForAction(action)) === tab;
  }
  return false;
}

/**
 * nuqs の useQueryStates にそのまま渡せる parser マップ。
 * - `q` は loader に届ける必要があるため、利用側で `{ shallow: false }` を指定すること。
 * - 他のフィルタはクライアント側で完結する（loader 再走しない）。
 */
export const keybindingsParsers = {
  tab: parseAsStringEnum([...TAB_OPTIONS]).withDefault("movement"),
  dpiMin: parseAsFloat,
  dpiMax: parseAsFloat,
  sensMin: parseAsFloat,
  sensMax: parseAsFloat,
  cm360Min: parseAsFloat,
  cm360Max: parseAsFloat,
  /** 表示するユーザーを限定する slug 一覧（空なら全件表示）。表・ビジュアル横断で適用。 */
  users: parseAsArrayOf(parseAsString).withDefault([]),
  /** 操作＝キーの絞り込み。"action:keyCode"（例: "sprint:ControlLeft"）の列で、全条件を満たす走者だけ表示する。 */
  bind: parseAsArrayOf(parseAsString).withDefault([]),
  /** ソート "key:dir" 形式（例: "cm360:asc"、キー名なら "action.sprint:asc"） */
  sort: parseAsString.withDefault(""),
} as const;

/** ソート文字列のパース */
export function parseSort(
  raw: string,
): { key: string; direction: "asc" | "desc" } | null {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (!key || (dir !== "asc" && dir !== "desc")) return null;
  return { key, direction: dir };
}

/** ソート文字列の組み立て */
export function formatSort(key: string, direction: "asc" | "desc"): string {
  return `${key}:${direction}`;
}

/** 操作＝キーの絞り込み条件 1 件 */
export type BindCondition = { action: string; keyCode: string };

/**
 * URL の `bind` の 1 要素（"sprint:ControlLeft"）を読む。最初の ":" で操作とキーに分ける。
 * 未知の操作・":" なし・キーが空のものは null（手書きの URL や古いリンクで落ちないよう捨てる）。
 */
export function parseBindCondition(raw: string): BindCondition | null {
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const action = raw.slice(0, i);
  const keyCode = raw.slice(i + 1);
  if (!keyCode || !BIND_FILTER_ACTIONS.includes(action)) return null;
  return { action, keyCode };
}

export function formatBindCondition(cond: BindCondition): string {
  return `${cond.action}:${cond.keyCode}`;
}

/**
 * `bind` の配列から有効な条件を取り出す。同じ操作が複数あるときは後のものに置き換える
 * （1 つの操作に同時に割り当てられるキーは 1 つなので、同じ操作の AND は常に空になり意味を持たない）。
 */
export function parseBindConditions(raws: readonly string[]): BindCondition[] {
  const byAction = new Map<string, BindCondition>();
  for (const raw of raws) {
    const cond = parseBindCondition(raw);
    if (cond) byAction.set(cond.action, cond);
  }
  return [...byAction.values()];
}

/** 条件を足す。同じ操作の条件があれば置き換える（並びは保つ）。無効な要素は捨てる */
export function upsertBindCondition(raws: readonly string[], cond: BindCondition): string[] {
  const valid = parseBindConditions(raws).map(formatBindCondition);
  const next = formatBindCondition(cond);
  const idx = valid.findIndex((r) => r.startsWith(`${cond.action}:`));
  if (idx >= 0) return valid.map((r, i) => (i === idx ? next : r));
  return [...valid, next];
}

/** 統計から表へリンクするときに users へ載せられる人数の上限（URL を長くしすぎない） */
export const MAX_USERS_IN_LINK = 100;

const serializeKeybindingsUrl = createSerializer(keybindingsParsers);

/**
 * 表（/keybindings）へのリンクを組み立てる。既存パラメータ（users / bind / tab）をそのまま使い、
 * 値の URL エンコードは nuqs の serializer に任せる。
 */
export function buildKeybindingsTableHref(params: {
  tab: Tab;
  users?: readonly string[];
  bind?: readonly BindCondition[];
}): string {
  return serializeKeybindingsUrl("/keybindings", {
    tab: params.tab,
    users: params.users && params.users.length > 0 ? [...params.users] : null,
    bind: params.bind && params.bind.length > 0 ? params.bind.map(formatBindCondition) : null,
  });
}
