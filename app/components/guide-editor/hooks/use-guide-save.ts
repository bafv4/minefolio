// 手動保存フック（自動セーブ廃止）。
// - draft（仮保存）: ドラフト列へ保存。公開版は変えない。
// - publish（保存）: 公開版を書き換え、ドラフトをクリアする。
// パフォーマンスのため content 等を reactive に保持せず、保存時に値を受け取る。
import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";

export interface GuideSaveValues {
  title: string;
  content: string;
  summary: string;
  tags: string[];
  isPublished: boolean;
  coverImageUrl: string | null;
}

export type SaveMode = "draft" | "publish";

function toFormData(v: GuideSaveValues, mode: SaveMode): FormData {
  const fd = new FormData();
  fd.append("_action", mode);
  fd.append("title", v.title);
  fd.append("content", v.content);
  fd.append("summary", v.summary);
  fd.append("tags", JSON.stringify(v.tags));
  fd.append("isPublished", String(v.isPublished));
  fd.append("coverImageUrl", v.coverImageUrl ?? "");
  return fd;
}

export interface UseGuideSaveResult {
  /** 保存を実行（draft = 仮保存 / publish = 保存）。値は呼び出し時に渡す */
  submit: (mode: SaveMode, values: GuideSaveValues) => void;
  /** 送信中 */
  saving: boolean;
  /** 直近の保存結果 */
  lastSaved: { mode: SaveMode; at: Date } | null;
}

export function useGuideSave(): UseGuideSaveResult {
  const fetcher = useFetcher();
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

  return { submit, saving, lastSaved };
}
