// リマップ / サーチクラフト埋め込みの「何が出るか」の要約。挿入ダイアログのプレビューとノードビューが共用する。
// 解決は公開ページと同じ規則（/api/guides/embed-resolve → lib/guide-embed-data.ts の選び方）なので、
// ここで「見つかりません」なら記事でも出ない。
import { AlertTriangle, Loader2 } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import {
  findEmbedPreset,
  summarizeKeybindEmbed,
  summarizeSearchCraftEmbed,
  type EmbedUserData,
} from "@/lib/guide-embed-data";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import type { Translator } from "@/lib/messages";
import type { EmbedUserState } from "../lib/embed-user-cache";

export type EmbedKind = "keybind" | "searchcraft";

/**
 * タイミングの短い表示名。固有名詞は search-craft-template-view.tsx の TIMING_META と同じ表記
 * （あちらはアイテム名辞書を引き込むため、エディタからは import しない）
 */
function timingShortLabel(t: Translator, timing: SearchCraftTiming | null): string {
  switch (timing) {
    case null:
      return t("playerProfile.timingUnspecified");
    case "ow":
      return "OW";
    case "bastion":
      return "Bastion";
    case "bastion_fort":
      return "Bastion→Fort";
    case "fortress":
      return "Fortress";
    case "blinded":
      return "Blinded";
    case "other":
      return t("playerProfile.timingOther");
  }
}

/** 解決できたか（挿入ダイアログの「挿入」を押せるか） */
export function isEmbedResolved(state: EmbedUserState): boolean {
  return state.status === "found";
}

/** 見つからないプリセット名は、公開ページと同じく既定の設定で数える */
function effectivePresetName(user: EmbedUserData, presetName: string | null): string | null {
  return presetName && findEmbedPreset(user, presetName) ? presetName : null;
}

/**
 * 解決できたが中身が 0 件か（リマップなし・サーチクラフト未登録）。記事には「〜が設定されていません」とだけ出る。
 * 挿入は止めない（走者が後から設定すれば記事にも出る）。ダイアログのボタンの文言（「このまま挿入」）にも使う
 */
export function isEmbedEmpty(kind: EmbedKind, state: EmbedUserState, presetName: string | null): boolean {
  if (state.status !== "found") return false;
  const preset = effectivePresetName(state.user, presetName);
  return kind === "searchcraft"
    ? summarizeSearchCraftEmbed(state.user, preset).total === 0
    : summarizeKeybindEmbed(state.user, preset).remapCount === 0;
}

/** 記事が 0 件のときに出す文（guide-embeds.tsx と同じキー）から、引用に使うため末尾の句点を落とす */
function articleEmptyText(t: Translator, kind: EmbedKind): string {
  const text = kind === "searchcraft" ? t("playerProfile.noSearchCraft") : t("playerProfile.noRemaps");
  return text.replace(/[。.]$/, "");
}

/**
 * 1 行目: 走者名（＋プリセット名）、2 行目: 中身の要約。
 * 読み込み中・見つからない・通信の失敗をそれぞれ出す。プリセット名が見つからないときは、
 * 公開ページと同じく既定の設定が出ることを警告として添える
 */
export function EmbedSummary({
  kind,
  state,
  userQuery,
  presetName,
}: {
  kind: EmbedKind;
  state: EmbedUserState;
  /** 保存されている（または選んだ）走者の指定。見つからないときの表示に使う */
  userQuery: string;
  presetName: string | null;
}) {
  const t = useT();
  const locale = useLocale();

  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t("guideEditor.embedLoading")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-warning" role="status">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("guideEditor.embedLoadFailed")}
      </p>
    );
  }
  if (state.status === "missing") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-destructive" role="status">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">
          {userQuery.trim()
            ? t("guideEditor.embedUserMissing", { user: userQuery.trim() })
            : t("guideEditor.embedUserEmpty")}
        </span>
      </p>
    );
  }

  const user = state.user;
  const name = getLocalizedDisplayName(user, locale);
  const presetMissing = !!presetName && !findEmbedPreset(user, presetName);
  // 見つからないプリセット名は、公開ページと同じく既定の設定で数える
  const effectivePreset = effectivePresetName(user, presetName);

  // 0 件なら summary は null（代わりに、記事に出る文を warning で添える）
  let summary: string | null;
  if (kind === "searchcraft") {
    const s = summarizeSearchCraftEmbed(user, effectivePreset);
    summary =
      s.total === 0
        ? null
        : t("guideEditor.embedSummarySearchCraft", {
            groups: s.groups.map((g) => `${timingShortLabel(t, g.timing)} ${g.count}`).join("・"),
            count: s.total,
          });
  } else {
    const s = summarizeKeybindEmbed(user, effectivePreset);
    summary = s.remapCount === 0 ? null : t("guideEditor.embedSummaryRemaps", { count: s.remapCount });
  }

  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <p className="min-w-0 break-words">
        <span className="font-medium">{name}</span>
        {user.mcid && user.mcid !== name && (
          <span className="ml-1.5 text-xs text-muted-foreground">@{user.mcid}</span>
        )}
        <span className="text-muted-foreground">
          {" — "}
          {presetName && !presetMissing ? presetName : t("guideEditor.embedPresetDefaultShort")}
        </span>
      </p>
      {summary !== null ? (
        <p className="text-xs text-muted-foreground">{summary}</p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t("guideEditor.embedSummaryEmptyWarning", { text: articleEmptyText(t, kind) })}
          </span>
        </p>
      )}
      {presetMissing && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t("guideEditor.embedPresetMissing", { preset: presetName })}
          </span>
        </p>
      )}
    </div>
  );
}
