import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import {
  MinecraftItemIcon,
  formatItemName,
  getItemNameJa,
} from "@bafv4/mcitems/1.16/react";
import type { FingerType } from "@/lib/keybindings";
import { getActualKeyInfos, toUiRemaps, type RemapInfo } from "@/lib/remap-utils";
import { VirtualKeyboard, keybindingsToMap } from "@/components/virtual-keyboard";
import { t } from "@/lib/messages";

const TEXTURE_BASE_URL = "/mcitems";

// ========================================
// 共通型
// ========================================

export type EmbedUserData = {
  slug: string;
  displayName: string | null;
  mcid: string | null;
  presets: Array<{
    name: string;
    isActive: boolean;
    keybindingsData: string | null;
    remapsData: string | null;
    playerConfigData: string | null;
    searchCraftsData: string | null;
  }>;
  keybindings: Array<{ action: string; keyCode: string; category: string }>;
  keyRemaps: Array<{
    sourceKey: string;
    targetKey: string | null;
    software: string | null;
    outputMode: string | null;
    outputCharacter: string | null;
  }>;
  playerConfig: {
    keyboardLayout: string | null;
    fingerAssignments: string | null;
  } | null;
  searchCrafts: Array<{
    id: string;
    sequence: number;
    items: string;
    searchStr: string | null;
    comment: string | null;
    timing: string | null;
  }>;
};

// ========================================
// HTML からembed参照を抽出
// ========================================

export type EmbedRef = {
  type: "keybind" | "searchcraft";
  userSlug: string;
  presetName: string | null;
};

export function extractEmbedRefs(html: string): EmbedRef[] {
  const refs: EmbedRef[] = [];
  const regex = /data-(keybind|searchcraft)-embed[^>]*data-user-slug="([^"]*)"[^>]*(?:data-preset-name="([^"]*)")?/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    refs.push({
      type: match[1] as "keybind" | "searchcraft",
      userSlug: match[2],
      presetName: match[3] || null,
    });
  }
  // Also handle the case where data-preset-name comes before data-user-slug
  const regex2 = /data-(keybind|searchcraft)-embed[^>]*data-preset-name="([^"]*)"[^>]*data-user-slug="([^"]*)"[^>]*/g;
  while ((match = regex2.exec(html)) !== null) {
    const existing = refs.find(
      (r) => r.type === match![1] && r.userSlug === match![3]
    );
    if (!existing) {
      refs.push({
        type: match[1] as "keybind" | "searchcraft",
        userSlug: match[3],
        presetName: match[2] || null,
      });
    }
  }
  return refs;
}

/** ユニークなユーザーslug一覧を取得 */
export function getUniqueEmbedSlugs(refs: EmbedRef[]): string[] {
  return [...new Set(refs.map((r) => r.userSlug))];
}

// ========================================
// コンテンツをembed境界で分割
// ========================================

export type ContentSegment =
  | { type: "html"; content: string }
  | { type: "keybind-embed"; userSlug: string; presetName: string | null }
  | { type: "searchcraft-embed"; userSlug: string; presetName: string | null };

export function splitContentAtEmbeds(html: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const embedRegex = /<div[^>]*data-(keybind|searchcraft)-embed[^>]*><\/div>/g;

  let lastIndex = 0;
  let match;
  while ((match = embedRegex.exec(html)) !== null) {
    // HTMLテキスト部分
    if (match.index > lastIndex) {
      segments.push({ type: "html", content: html.slice(lastIndex, match.index) });
    }

    const tag = match[0];
    const embedType = match[1] as "keybind" | "searchcraft";
    const slugMatch = tag.match(/data-user-slug="([^"]*)"/);
    const presetMatch = tag.match(/data-preset-name="([^"]*)"/);

    segments.push({
      type: `${embedType}-embed` as "keybind-embed" | "searchcraft-embed",
      userSlug: slugMatch?.[1] ?? "",
      presetName: presetMatch?.[1] ?? null,
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    segments.push({ type: "html", content: html.slice(lastIndex) });
  }

  return segments;
}

// ========================================
// リマップ表示コンポーネント
// ========================================

export function KeybindEmbedView({
  userData,
  presetName,
}: {
  userData: EmbedUserData;
  presetName: string | null;
}) {
  const displayName = userData.displayName || userData.mcid || userData.slug;

  // プリセット名指定時はそのプリセットのデータを使用
  let keybindingsRaw = userData.keybindings;
  let remapsRaw = userData.keyRemaps;
  let layout = userData.playerConfig?.keyboardLayout ?? "US";

  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.keybindingsData) {
      keybindingsRaw = JSON.parse(preset.keybindingsData);
    }
    if (preset?.remapsData) {
      remapsRaw = JSON.parse(preset.remapsData);
    }
    if (preset?.playerConfigData) {
      const config = JSON.parse(preset.playerConfigData);
      layout = config.keyboardLayout ?? layout;
    }
  }

  const remaps = toUiRemaps(remapsRaw as Parameters<typeof toUiRemaps>[0]);
  const keyboardLayout = (layout || "US") as "US" | "JIS" | "US_TKL" | "JIS_TKL";

  // 指割り当てを取得
  let fingerAssignmentsJson = userData.playerConfig?.fingerAssignments ?? null;
  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.playerConfigData) {
      const config = JSON.parse(preset.playerConfigData);
      if (config.fingerAssignments) fingerAssignmentsJson = config.fingerAssignments;
    }
  }
  const fingerAssignments = fingerAssignmentsJson
    ? (JSON.parse(fingerAssignmentsJson) as Record<string, FingerType[]>)
    : {};

  if (remaps.length === 0) {
    return (
      <div className="my-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noRemaps")}
      </div>
    );
  }

  return (
    <div className="my-4 not-prose">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-medium">
            {displayName}
            {presetName && <span className="text-muted-foreground ml-2">({presetName})</span>}
            {" — "}{t("playerProfile.remapTab")}
          </span>
          <Link to={`/player/${userData.slug}`} className="text-xs text-primary hover:underline">
            {t("playerProfile.viewProfile")}
          </Link>
        </div>
        <div className="p-4 overflow-x-auto">
          <VirtualKeyboard
            layout={keyboardLayout}
            keybindings={keybindingsToMap(keybindingsRaw)}
            remaps={remaps}
            fingerAssignments={fingerAssignments}
            showRemaps
            showFingerAssignments
            hideNumpad
          />
        </div>
      </div>
    </div>
  );
}

// ========================================
// サーチクラフト表示コンポーネント
// ========================================

function getItemDisplayName(itemId: string): string {
  return getItemNameJa(itemId) || formatItemName(itemId);
}

const TIMING_LABELS: Record<string, string> = {
  bastion: "Bastion",
  fortress: "Fortress",
  other: t("playerProfile.timingOther"),
};

const TIMING_ORDER = ["bastion", "fortress", "other"] as const;

export function SearchCraftEmbedView({
  userData,
  presetName,
}: {
  userData: EmbedUserData;
  presetName: string | null;
}) {
  const displayName = userData.displayName || userData.mcid || userData.slug;

  let crafts = userData.searchCrafts;
  let remapsRaw = userData.keyRemaps;

  if (presetName) {
    const preset = userData.presets.find((p) => p.name === presetName);
    if (preset?.searchCraftsData) {
      crafts = JSON.parse(preset.searchCraftsData);
    }
    if (preset?.remapsData) {
      remapsRaw = JSON.parse(preset.remapsData);
    }
  }

  const remaps = toUiRemaps(remapsRaw as Parameters<typeof toUiRemaps>[0]);

  if (crafts.length === 0) {
    return (
      <div className="my-4 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {displayName} — {t("playerProfile.noSearchCraft")}
      </div>
    );
  }

  const hasAnyTiming = crafts.some((c) => c.timing);

  const renderCraft = (craft: typeof crafts[0]) => {
    const items = typeof craft.items === "string" ? JSON.parse(craft.items) as string[] : craft.items as unknown as string[];
    const keyInfos = craft.searchStr ? getActualKeyInfos(craft.searchStr, remaps) : [];

    return (
      <Card key={craft.id}>
        <CardContent className="px-4 py-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {items.map((itemId: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-1.5">
                  <MinecraftItemIcon itemId={itemId} size={28} textureBaseUrl={TEXTURE_BASE_URL} className="pixelated" />
                  <span className="text-base">{getItemDisplayName(itemId)}</span>
                </div>
              ))}
            </div>
            {craft.searchStr && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground shrink-0">{t("playerProfile.searchLabel")}</span>
                  <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono">{craft.searchStr}</code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0 mt-0.5">{t("playerProfile.inputKeysLabel")}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {keyInfos.map((info, idx) => (
                      <kbd key={idx} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs">
                        {info.displayLabel}
                      </kbd>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {craft.comment && <p className="text-sm text-muted-foreground">{craft.comment}</p>}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderGrouped = () => {
    const grouped = new Map<string | null, typeof crafts>();
    for (const craft of crafts) {
      const key = craft.timing;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(craft);
    }
    const sortedKeys: (string | null)[] = [];
    for (const timing of TIMING_ORDER) {
      if (grouped.has(timing)) sortedKeys.push(timing);
    }
    if (grouped.has(null)) sortedKeys.push(null);

    return (
      <div className="space-y-4">
        {sortedKeys.map((timing) => (
          <div key={timing ?? "__none"} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
              {timing ? TIMING_LABELS[timing] ?? timing : t("playerProfile.timingUnspecified")}
            </h4>
            <div className="space-y-3">{grouped.get(timing)!.map(renderCraft)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="my-4 not-prose">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-medium">
            {displayName}
            {presetName && <span className="text-muted-foreground ml-2">({presetName})</span>}
            {" — "}{t("playerProfile.searchCraftTab")}
          </span>
          <Link to={`/player/${userData.slug}`} className="text-xs text-primary hover:underline">
            {t("playerProfile.viewProfile")}
          </Link>
        </div>
        <div className="p-4">
          {hasAnyTiming ? renderGrouped() : (
            <div className="space-y-3">{crafts.map(renderCraft)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
