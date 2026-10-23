import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createTranslator } from "@/lib/messages";
import { resolveLocale } from "@/lib/locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { loadKeybindingsListPlayers } from "@/lib/keybindings-list.server";
import { getActionLabel, getKeyLabel, isUnbound, getKeyCombinationLabel } from "@/lib/keybindings";
import { getRemapSourceLabel, getRemapOutputLabel } from "@/lib/remap-utils";
import {
  calculateCm360,
  calculateCursorSpeed,
  getWindowsMultiplierOrNull,
  toSensitivityPercent,
} from "@/lib/mouse-settings";

const KEYBOARD_ACTIONS = [
  "forward", "back", "left", "right", "sprint", "sneak",
  "inventory", "swapHands", "drop", "pickBlock",
  "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
  "hotbar6", "hotbar7", "hotbar8", "hotbar9",
] as const;

// 出力できるセクションの許可リスト。各セクションの分岐と sections パラメータの検証の両方がこれを参照する
const CSV_SECTIONS = ["actions", "remaps", "custom-actions", "mouse"] as const;
type CsvSection = (typeof CSV_SECTIONS)[number];

function isCsvSection(v: string): v is CsvSection {
  return (CSV_SECTIONS as readonly string[]).includes(v);
}

// カンマ区切りのパラメータを分割し、各要素をトリムして空要素を除く
function splitCsvParam(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

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

  // パラメータ検証（DB アクセスより前にできるものを先に行う）。
  // 指定が不正なら 200 の空 CSV ではなく 400 を返す。
  // sections: 未指定なら actions。指定時は分割・トリム・空要素除去し、空または許可リスト外を含めば 400
  const sectionsParam = url.searchParams.get("sections");
  const requestedSections =
    sectionsParam === null ? ["actions"] : splitCsvParam(sectionsParam);
  if (requestedSections.length === 0) {
    return Response.json(
      { error: `sections must contain at least one of: ${CSV_SECTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  const unknownSections = requestedSections.filter((s) => !isCsvSection(s));
  if (unknownSections.length > 0) {
    return Response.json(
      {
        error: `Unknown sections: ${unknownSections.join(", ")}. Allowed: ${CSV_SECTIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const sections = new Set<CsvSection>(requestedSections as CsvSection[]);

  // 個別指定: userSlugs=slug1,slug2 のように指定すると対象を絞り込む。未指定なら全公開ユーザー。
  // 指定時は分割・トリム・空要素除去し、空なら 400（存在照合はローダー結果との突き合わせで後段）
  const userSlugsParam = url.searchParams.get("userSlugs");
  const userSlugs = userSlugsParam === null ? null : splitCsvParam(userSlugsParam);
  if (userSlugs !== null && userSlugs.length === 0) {
    return Response.json({ error: "userSlugs must contain at least one slug" }, { status: 400 });
  }

  const db = createDb();

  // 一覧ページと同じ共有ローダーを使う（メインプリセットのスナップショット優先・
  // 視聴者ロール除外・空ユーザー除外まで一覧と同一の絞り込み）
  const players = await loadKeybindingsListPlayers(db, {
    slugs: userSlugs ?? undefined,
  });

  // 指定 slug がローダーから返らなければ 400。存在しない・非公開・視聴者ロール・設定が空は
  // 区別しない（非公開ユーザーの存在を漏らさないため）。照合はローダー（DB の slug 一致）と同じく
  // 大文字小文字を区別する
  if (userSlugs !== null) {
    const found = new Set(players.map((p) => p.slug));
    const notFound = [...new Set(userSlugs.filter((s) => !found.has(s)))];
    if (notFound.length > 0) {
      return Response.json(
        { error: "Some userSlugs were not found or are not exportable", notFound },
        { status: 400 },
      );
    }
  }

  const playerName = (p: typeof players[0]) => getLocalizedDisplayName(p, locale);

  const csvBlocks: string[] = [];

  if (sections.has("actions")) {
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

  if (sections.has("remaps")) {
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

  if (sections.has("custom-actions")) {
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

  if (sections.has("mouse")) {
    if (csvBlocks.length > 0) csvBlocks.push("");
    csvBlocks.push(["Player", "DPI", "Sensitivity (%)", "cm/360", "Win Sens Multiplier", "Cursor Speed", "Raw Input", "Mouse Accel"].map(escapeCsv).join(","));
    for (const player of players) {
      const config = player.playerConfig;
      const cm360 = config ? calculateCm360(config.mouseDpi, config.gameSensitivity, config.rawInput, config.windowsSpeed, config.windowsSpeedMultiplier) : null;
      const cursorSpeed = config
        ? calculateCursorSpeed(config.mouseDpi, config.windowsSpeed, config.windowsSpeedMultiplier)
        : null;
      // 感度は生データとして出力（有効範囲外の値もそのまま）
      const sensPercent = toSensitivityPercent(config?.gameSensitivity);
      const winMultiplier = config ? getWindowsMultiplierOrNull(config.windowsSpeed, config.windowsSpeedMultiplier) : null;
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
