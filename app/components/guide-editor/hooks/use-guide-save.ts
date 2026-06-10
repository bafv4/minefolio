// 手動保存フック（自動セーブ廃止）。
// - draft（仮保存）: ドラフト列へ保存。公開版は変えない。
// - publish（保存）: 公開版を書き換え、ドラフトをクリアする。
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

function signature(v: GuideSaveValues): string {
  return JSON.stringify([v.title, v.content, v.summary, v.tags, v.isPublished, v.coverImageUrl]);
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
  return fd;
}

export interface UseGuideSaveResult {
  /** 保存を実行（draft = 仮保存 / publish = 保存） */
  save: (mode: SaveMode) => void;
  /** 最後の保存以降に未保存の変更があるか */
  isDirty: boolean;
  /** 送信中 */
  saving: boolean;
  /** 直近の保存結果 */
  lastSaved: { mode: SaveMode; at: Date } | null;
}

export function useGuideSave(values: GuideSaveValues): UseGuideSaveResult {
  const fetcher = useFetcher();
  const [savedSig, setSavedSig] = useState(() => signature(values));
  const [lastSaved, setLastSaved] = useState<{ mode: SaveMode; at: Date } | null>(null);
  const pendingMode = useRef<SaveMode | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const isDirty = signature(values) !== savedSig;
  const saving = fetcher.state !== "idle";

  const save = useCallback(
    (mode: SaveMode) => {
      const v = valuesRef.current;
      pendingMode.current = mode;
      fetcher.submit(toFormData(v, mode), { method: "post" });
      setSavedSig(signature(v));
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

  return { save, isDirty, saving, lastSaved };
}
