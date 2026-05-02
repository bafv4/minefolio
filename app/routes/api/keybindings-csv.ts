import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { users, keybindings, keyRemaps, customActions } from "@/lib/schema";
import { eq, asc, desc, and, inArray } from "drizzle-orm";
import { getActionLabel, getKeyLabel, isUnbound, getKeyCombinationLabel } from "@/lib/keybindings";
import { getRemapSourceLabel, getRemapOutputLabel } from "@/lib/remap-utils";

const KEYBOARD_ACTIONS = [
  "forward", "back", "left", "right", "sprint", "sneak",
  "inventory", "swapHands", "drop", "pickBlock",
  "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
  "hotbar6", "hotbar7", "hotbar8", "hotbar9",
] as const;

// Windowsポインター速度の乗数
const WINDOWS_POINTER_MULTIPLIERS: Record<number, number> = {
  1: 0.03125, 2: 0.0625, 3: 0.125, 4: 0.25, 5: 0.375,
  6: 0.5, 7: 0.625, 8: 0.75, 9: 0.875, 10: 1,
  11: 1.25, 12: 1.5, 13: 1.75, 14: 2, 15: 2.25,
  16: 2.5, 17: 2.75, 18: 3, 19: 3.25, 20: 3.5,
};

function getWindowsMultiplier(windowsSpeed: number | null, windowsSpeedMultiplier: number | null): number {
  if (windowsSpeedMultiplier != null && windowsSpeedMultiplier > 0) return windowsSpeedMultiplier;
  return windowsSpeed != null ? (WINDOWS_POINTER_MULTIPLIERS[windowsSpeed] ?? 1.0) : 1.0;
}

function calculateCm360(
  dpi: number | null, sensitivity: number | null,
  rawInput: boolean | null, windowsSpeed: number | null,
  windowsSpeedMultiplier: number | null = null
): number | null {
  if (dpi == null || sensitivity == null) return null;
  const f = 0.6 * sensitivity + 0.2;
  const cm360Base = 6096 / (dpi * 8 * f * f * f) / 2;
  if (rawInput === true) return cm360Base;
  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return cm360Base / winMultiplier;
}

function escapeCsv(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sections = url.searchParams.get("sections")?.split(",") ?? ["actions"];
  // 個別指定: userSlugs=slug1,slug2 のように指定すると対象を絞り込む。未指定なら全公開ユーザー。
  const userSlugsParam = url.searchParams.get("userSlugs");
  const userSlugs = userSlugsParam
    ? userSlugsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const db = createDb();

  const whereCondition = userSlugs && userSlugs.length > 0
    ? and(eq(users.profileVisibility, "public"), inArray(users.slug, userSlugs))
    : eq(users.profileVisibility, "public");

  const allPlayers = await db.query.users.findMany({
    where: whereCondition,
    orderBy: [desc(users.createdAt)],
    columns: {
      id: true,
      mcid: true,
      slug: true,
      displayName: true,
    },
    with: {
      keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
      keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
      playerConfig: {
        columns: {
          keyboardLayout: true,
          mouseDpi: true,
          gameSensitivity: true,
          windowsSpeed: true,
          windowsSpeedMultiplier: true,
          rawInput: true,
          mouseAcceleration: true,
        },
      },
      customActions: { orderBy: [asc(customActions.displayOrder), asc(customActions.actionName)] },
    },
  });

  const players = allPlayers.filter(
    (p) => p.keybindings.length > 0 || p.keyRemaps.length > 0 || p.customActions.length > 0
  );

  const playerName = (p: typeof players[0]) => p.displayName ?? p.mcid ?? p.slug;

  const csvBlocks: string[] = [];

  if (sections.includes("actions")) {
    const header = ["Player", ...KEYBOARD_ACTIONS.map((a) => getActionLabel(a))];
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
            ? getKeyCombinationLabel(keyCode, layout)
            : getKeyLabel(keyCode, layout);
        }),
      ];
      csvBlocks.push(row.map(escapeCsv).join(","));
    }
  }

  if (sections.includes("remaps")) {
    if (csvBlocks.length > 0) csvBlocks.push(""); // separator
    csvBlocks.push(["Player", "Source Key", "Target Key"].map(escapeCsv).join(","));
    for (const player of players) {
      const layout = player.playerConfig?.keyboardLayout;
      for (const remap of player.keyRemaps) {
        const source = getRemapSourceLabel(remap.sourceKey, layout);
        const target = remap.targetKey
          ? (remap.targetKey.includes("+")
            ? getKeyCombinationLabel(remap.targetKey, layout)
            : getKeyLabel(remap.targetKey, layout))
          : "(disabled)";
        csvBlocks.push([playerName(player), source, target].map(escapeCsv).join(","));
      }
    }
  }

  if (sections.includes("custom-actions")) {
    if (csvBlocks.length > 0) csvBlocks.push("");
    csvBlocks.push(["Player", "Trigger Key", "Action Name"].map(escapeCsv).join(","));
    for (const player of players) {
      const layout = player.playerConfig?.keyboardLayout;
      for (const action of player.customActions) {
        const key = getKeyCombinationLabel(action.triggerKey, layout);
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
