// キー配置 / サーチクラフト埋め込みの「何が出るか」の要約。挿入ダイアログのプレビューとノードビューが共用する。
// 解決は公開ページと同じ規則（/api/guides/embed-resolve → lib/guide-embed-data.ts の選び方）なので、
// ここで「見つかりません」なら記事でも出ない。
import { AlertTriangle, Loader2 } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import {
  findEmbedPreset,
  summarizeKeybindEmbed,
  summarizeSearchCraftEmbed,
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
  const effectivePreset = presetMissing ? null : presetName;

  let summary: string;
  if (kind === "searchcraft") {
    const s = summarizeSearchCraftEmbed(user, effectivePreset);
    summary =
      s.total === 0
        ? t("guideEditor.embedSummaryNoSearchCraft")
        : t("guideEditor.embedSummarySearchCraft", {
            groups: s.groups.map((g) => `${timingShortLabel(t, g.timing)} ${g.count}`).join("・"),
            count: s.total,
          });
  } else {
    const s = summarizeKeybindEmbed(user, effectivePreset);
    summary =
      s.remapCount === 0
        ? t("guideEditor.embedSummaryNoRemaps")
        : t("guideEditor.embedSummaryRemaps", { count: s.remapCount });
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
      <p className="text-xs text-muted-foreground">{summary}</p>
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
