// 手動保存フック（自動セーブ廃止）。
// - draft（下書き保存）: ドラフト列へ保存。公開版と公開状態（isPublished）は変えない。
// - publish（右端の保存ボタン。文言は「公開」/「更新を公開」/「保存」）: 公開版と isPublished を書き換え、ドラフトをクリアする。
// パフォーマンスのため content 等を reactive に保持せず、保存時に値を受け取る。
import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";
import type { MessageKey } from "@/lib/messages";

export interface GuideSaveValues {
  title: string;
  content: string;
  summary: string;
  tags: string[];
  isPublished: boolean;
  coverImageUrl: string | null;
  slug: string;
  /** 自動翻訳の許可（ライブ列。下書き保存・保存のどちらでも送る）。undefined なら送らず、サーバーは列を変えない */
  allowAutoTranslation?: boolean;
}

export type SaveMode = "draft" | "publish" | "discard";

/** 保存アクションのレスポンス（edit.tsx の action が素の object で返す） */
export interface GuideSaveResult {
  success?: boolean;
  mode?: SaveMode;
  /** 保存後の実効スラッグ（変更時はこれへ編集URLを差し替える） */
  slug?: string;
  error?: string;
}

function toFormData(v: GuideSaveValues, mode: SaveMode): FormData {
  const fd = new FormData();
  fd.append("_action", mode);
  fd.append("title", v.title);
  fd.append("content", v.content);
  fd.append("summary", v.summary);
  fd.append("tags", JSON.stringify(v.tags));
  fd.append("isPublished", String(v.isPublished));
  fd.append("coverImageUrl", v.coverImageUrl ?? "");
  fd.append("slug", v.slug);
  if (v.allowAutoTranslation !== undefined) {
    fd.append("allowAutoTranslation", String(v.allowAutoTranslation));
  }
  return fd;
}

/**
 * 右端の保存ボタン（mode=publish）を押した結果。公開状態はこの保存でだけ書き換わる
 * （下書き保存は isPublished を送っても変えない — edit.tsx の action）ので、
 * 「いま読者に公開されているか（保存済みの isPublished）」と「公開の設定（設定モーダルのスイッチ）」の組で決まる。
 * - publish: 非公開 → 公開（読者に公開する）
 * - publishUpdate: 公開中のまま公開版を更新する
 * - unpublish: 公開中 → 非公開（公開を取り下げる）
 * - saveUnpublished: 非公開のまま保存する
 */
export type PublishAction = "publish" | "publishUpdate" | "unpublish" | "saveUnpublished";

export function getPublishAction(livePublished: boolean, publishSetting: boolean): PublishAction {
  if (publishSetting) return livePublished ? "publishUpdate" : "publish";
  return livePublished ? "unpublish" : "saveUnpublished";
}

/** 保存ボタンの文言・ツールチップ・公開状態ピルの文言 */
export const PUBLISH_ACTION_MESSAGES: Record<
  PublishAction,
  { label: MessageKey; hint: MessageKey; status: MessageKey }
> = {
  publish: {
    label: "guideEditor.toolbar.publish",
    hint: "guideEditor.toolbar.publishHint",
    status: "guideEditor.toolbar.statusPrivatePendingPublish",
  },
  publishUpdate: {
    label: "guideEditor.toolbar.publishUpdate",
    hint: "guideEditor.toolbar.publishUpdateHint",
    status: "guideEditor.toolbar.statusPublic",
  },
  unpublish: {
    label: "guideEditor.save",
    hint: "guideEditor.toolbar.unpublishHint",
    status: "guideEditor.toolbar.statusPublicPendingUnpublish",
  },
  saveUnpublished: {
    label: "guideEditor.save",
    hint: "guideEditor.toolbar.saveUnpublishedHint",
    status: "guideEditor.toolbar.statusPrivate",
  },
};

export interface UseGuideSaveResult {
  /** 保存を実行（draft = 下書き保存 / publish = 公開版へ保存）。値は呼び出し時に渡す */
  submit: (mode: SaveMode, values: GuideSaveValues) => void;
  /** 送信中 */
  saving: boolean;
  /** 直近の保存結果 */
  lastSaved: { mode: SaveMode; at: Date } | null;
  /** action のレスポンス（エラー通知・スラッグ変更後のURL差し替えに使う） */
  data: GuideSaveResult | undefined;
}

export function useGuideSave(): UseGuideSaveResult {
  const fetcher = useFetcher<GuideSaveResult>();
  const [lastSaved, setLastSaved] = useState<{ mode: SaveMode; at: Date } | null>(null);
  const pendingMode = useRef<SaveMode | null>(null);

  const saving = fetcher.state !== "idle";

  const submit = useCallback(
    (mode: SaveMode, values: GuideSaveValues) => {
      pendingMode.current = mode;
      fetcher.submit(toFormData(values, mode), { method: "post" });
    },
    [fetcher],
  );

  // 送信完了 → 最終保存情報を記録
  useEffect(() => {
    if (fetcher.state === "idle" && pendingMode.current) {
      setLastSaved({ mode: pendingMode.current, at: new Date() });
      pendingMode.current = null;
    }
  }, [fetcher.state]);

  return { submit, saving, lastSaved, data: fetcher.data };
}
