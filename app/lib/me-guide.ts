// /me の「はじめに」ガイド（初回ツアー・チェックリスト）の共有部分。サーバー・クライアント両方から import する。
import type { users } from "./schema";

/** api/me/guide が受け付ける種別と、更新する users の列の対応 */
export const ME_GUIDE_COLUMNS = {
  tour: "meTourCompletedAt",
  checklist: "meChecklistDismissedAt",
} as const satisfies Record<string, keyof typeof users.$inferSelect>;

export type MeGuideKind = keyof typeof ME_GUIDE_COLUMNS;

/** フォーム値から種別を取り出す。未知の値・未指定は null */
export function parseMeGuideKind(value: unknown): MeGuideKind | null {
  return typeof value === "string" && Object.hasOwn(ME_GUIDE_COLUMNS, value)
    ? (value as MeGuideKind)
    : null;
}

// ---- チェックリスト ----

export const ME_CHECKLIST_STEPS = [
  { key: "mcid", to: "/me/edit" },
  { key: "bio", to: "/me/edit#bio" },
  { key: "keybindings", to: "/me/keybindings" },
  { key: "devices", to: "/me/devices" },
  { key: "records", to: "/me/records" },
  { key: "playstyle", to: "/me/playstyle" },
] as const;

export type MeChecklistStepKey = (typeof ME_CHECKLIST_STEPS)[number]["key"];

export interface MeChecklistStep {
  key: MeChecklistStepKey;
  to: string;
  done: boolean;
}

export interface MeChecklistData {
  steps: MeChecklistStep[];
  doneCount: number;
  total: number;
}

export interface MeChecklistInput {
  mcid: string | null | undefined;
  bedrockMcid?: string | null;
  /** 自己紹介（users.bio。空白のみは未入力扱い） */
  bio?: string | null;
  /** Speedrun.com のユーザー名・ID（どちらかが入っていれば登録済み） */
  speedruncomUsername?: string | null;
  speedruncomId?: string | null;
  keybindingCount: number;
  /** player_configs の行（無ければ null） */
  config: {
    keyboardLayout?: string | null;
    keyboardModel?: string | null;
    mouseModel?: string | null;
    mouseDpi?: number | null;
    gameSensitivity?: number | null;
    cm360?: number | null;
    /** コントローラー設定（JSON 文字列。コントローラー・タッチの走者はこちらを入れる） */
    controllerSettings?: string | null;
  } | null;
  recordCount: number;
  /** playstyles の行（無ければ null） */
  playstyle: {
    versions?: string | null;
    categories?: string | null;
    hotbarSwitching?: string | null;
  } | null;
}

function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "[]";
  return true;
}

/** 既存データから各手順の完了を判定する純粋関数 */
export function computeMeChecklist(input: MeChecklistInput): MeChecklistData {
  const { config, playstyle } = input;
  const done: Record<MeChecklistStepKey, boolean> = {
    mcid: filled(input.mcid) || filled(input.bedrockMcid),
    bio: filled(input.bio),
    keybindings: input.keybindingCount > 0,
    devices:
      config != null &&
      [
        config.keyboardLayout,
        config.keyboardModel,
        config.mouseModel,
        config.mouseDpi,
        config.gameSensitivity,
        config.cm360,
        config.controllerSettings,
      ].some(filled),
    records: input.recordCount > 0 || filled(input.speedruncomUsername) || filled(input.speedruncomId),
    playstyle:
      playstyle != null &&
      [playstyle.versions, playstyle.categories, playstyle.hotbarSwitching].some(filled),
  };
  const steps = ME_CHECKLIST_STEPS.map((s) => ({ key: s.key, to: s.to, done: done[s.key] }));
  return { steps, doneCount: steps.filter((s) => s.done).length, total: steps.length };
}

/**
 * 完了・閉じた日時を api/me/guide に記録する（クライアント用）。
 * useFetcher.submit だと表示中の子ルートまで再検証されるため、素の fetch で送る。失敗しても表示は変えない
 * （次回の読み込みでまた出るだけ）。
 */
export async function recordMeGuide(kind: MeGuideKind): Promise<void> {
  try {
    await fetch("/api/me/guide", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ kind }),
    });
  } catch {
    // 記録できなくても致命的ではない
  }
}
