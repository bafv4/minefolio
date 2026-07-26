import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createTranslator } from "@/lib/messages";
import { resolveLocale } from "@/lib/locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { loadKeybindingsListPlayers } from "@/lib/keybindings-list.server";
import { getActionLabel, getKeyLabel, isUnbound, getKeyCombinationLabel } from "@/lib/keybindings";
import { getRemapSourceLabel, getRemapOutputLabel } from "@/lib/remap-utils";
import { calculateCm360, getWindowsMultiplier } from "@/lib/mouse-settings";

const KEYBOARD_ACTIONS = [
  "forward", "back", "left", "right", "sprint", "sneak",
  "inventory", "swapHands", "drop", "pickBlock",
  "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
  "hotbar6", "hotbar7", "hotbar8", "hotbar9",
] as const;

function escapeCsv(v: string): string {
  let s = v;
  // CSV式（フォーミュラ）インジェクション対策: =,+,-,@,タブ,CR で始まる値は
  // 表計算ソフトで数式として評価され得るため、先頭に ' を付けて無害化する。
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // CSV のヘッダー・ラベルは閲覧者のロケールに合わせる
  const locale = resolveLocale(request);
  const t = createTranslator(locale);
  const url = new URL(request.url);
  const sections = url.searchParams.get("sections")?.split(",") ?? ["actions"];
  // 個別指定: userSlugs=slug1,slug2 のように指定すると対象を絞り込む。未指定なら全公開ユーザー。
  const userSlugsParam = url.searchParams.get("userSlugs");
  const userSlugs = userSlugsParam
    ? userSlugsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const db = createDb();

  // 一覧ページと同じ共有ローダーを使う（メインプリセットのスナップショット優先・
  // 視聴者ロール除外・空ユーザー除外まで一覧と同一の絞り込み）
  const players = await loadKeybindingsListPlayers(db, {
    slugs: userSlugs ?? undefined,
  });

  const playerName = (p: typeof players[0]) => getLocalizedDisplayName(p, locale);

  const csvBlocks: string[] = [];

  if (sections.includes("actions")) {
    const header = ["Player", ...KEYBOARD_ACTIONS.map((a) => getActionLabel(t, a))];
    csvBlocks.push(header.map(escapeCsv).join(","));
    for (const player of players) {
      const keybindMap = new Map(player.keybindings.map((kb) => [kb.action, kb.keyCode]));
      const layout = player.playerConfig?.keyboardLayout;
      const row = [
        playerName(player),
        ...KEYBOARD_ACTIONS.map((action) => {
          const keyCode = keybindMap.get(action);
          if (!keyCode || isUnbound(keyCode)) return "";
          return keyCode.includes("+")
            ? getKeyCombinationLabel(t, keyCode, layout)
            : getKeyLabel(t, keyCode, layout);
        }),
      ];
      csvBlocks.push(row.map(escapeCsv).join(","));
    }
  }

  if (sections.includes("remaps")) {
    if (csvBlocks.length > 0) csvBlocks.push(""); // separator
    csvBlocks.push(["Player", "Source Key", "Target Key", "Type"].map(escapeCsv).join(","));
    for (const player of players) {
      const layout = player.playerConfig?.keyboardLayout;
      for (const remap of player.keyRemaps) {
        const source = getRemapSourceLabel(t, remap.sourceKey, layout);
        const target = remap.targetKey
          ? (remap.targetKey.includes("+")
            ? getKeyCombinationLabel(t, remap.targetKey, layout)
            : getKeyLabel(t, remap.targetKey, layout))
          : "(disabled)";
        // 未設定は空欄、それ以外は小文字enum値のまま出力
        const type = remap.remapType === "unset" ? "" : remap.remapType;
        csvBlocks.push([playerName(player), source, target, type].map(escapeCsv).join(","));
      }
    }
  }

  if (sections.includes("custom-actions")) {
    if (csvBlocks.length > 0) csvBlocks.push("");
    csvBlocks.push(["Player", "Trigger Key", "Action Name"].map(escapeCsv).join(","));
    for (const player of players) {
      const layout = player.playerConfig?.keyboardLayout;
      for (const action of player.customActions) {
        const key = getKeyCombinationLabel(t, action.triggerKey, layout);
        csvBlocks.push([playerName(player), key, action.actionName].map(escapeCsv).join(","));
      }
    }
  }

  if (sections.includes("mouse")) {
    if (csvBlocks.length > 0) csvBlocks.push("");
    csvBlocks.push(["Player", "DPI", "Sensitivity (%)", "cm/360", "Win Sens Multiplier", "Cursor Speed", "Raw Input", "Mouse Accel"].map(escapeCsv).join(","));
    for (const player of players) {
      const config = player.playerConfig;
      const cm360 = config ? calculateCm360(config.mouseDpi, config.gameSensitivity, config.rawInput, config.windowsSpeed, config.windowsSpeedMultiplier) : null;
      const cursorSpeed = config?.mouseDpi != null
        ? Math.round(config.mouseDpi * getWindowsMultiplier(config.windowsSpeed, config.windowsSpeedMultiplier))
        : null;
      const sensPercent = config?.gameSensitivity != null ? Math.floor(config.gameSensitivity * 200) : null;
      const winMultiplier = config ? getWindowsMultiplier(config.windowsSpeed, config.windowsSpeedMultiplier) : null;
      csvBlocks.push([
        playerName(player),
        config?.mouseDpi?.toString() ?? "",
        sensPercent?.toString() ?? "",
        cm360 != null ? cm360.toFixed(1) : "",
        winMultiplier?.toString() ?? "",
        cursorSpeed?.toString() ?? "",
        config?.rawInput != null ? (config.rawInput ? "ON" : "OFF") : "",
        config?.mouseAcceleration != null ? (config.mouseAcceleration ? "ON" : "OFF") : "",
      ].map(escapeCsv).join(","));
    }
  }

  const bom = "\uFEFF";
  const csv = bom + csvBlocks.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="keybindings.csv"`,
    },
  });
}
