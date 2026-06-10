// オートセーブフック。debounce → 差分検出 → fetcher.submit を集約。
// 旧 index.tsx の useDebounced + 3 つの保存 useEffect + handleManualSave を 1 箇所に統合。
// 返り値の saveNow で即時保存（手動保存 / 公開トグル）を行う。
import { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "react-router";
import { AUTO_SAVE_DEBOUNCE_MS } from "../constants";
import type { SaveStatus } from "../types";

/** 保存対象フィールド（FormData I/O は旧実装と不変） */
export interface AutoSaveValues {
  title: string;
  content: string;
  summary: string;
  tags: string[];
  isPublished: boolean;
  coverImageUrl: string | null;
}

/** 全フィールドを 1 つの署名にまとめ、差分判定を単純化する */
function signature(v: AutoSaveValues): string {
  return JSON.stringify([v.title, v.content, v.summary, v.tags, v.isPublished, v.coverImageUrl]);
}

function toFormData(v: AutoSaveValues): FormData {
  const formData = new FormData();
  formData.append("title", v.title);
  formData.append("content", v.content);
  formData.append("summary", v.summary);
  formData.append("tags", JSON.stringify(v.tags));
  formData.append("isPublished", String(v.isPublished));
  formData.append("coverImageUrl", v.coverImageUrl ?? "");
  return formData;
}

/** 汎用 debounce（旧 useDebounced を移植） */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface UseAutoSaveResult {
  status: SaveStatus;
  lastSavedAt: Date | null;
  /** 現在値を即時保存（debounce を待たない） */
  saveNow: () => void;
}

export function useAutoSave(values: AutoSaveValues): UseAutoSaveResult {
  const fetcher = useFetcher();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // 最新値・保存済み署名を ref で保持（コールバックの再生成を避ける）
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const savedSigRef = useRef(signature(values));

  const sig = signature(values);
  const debouncedSig = useDebounced(sig, AUTO_SAVE_DEBOUNCE_MS);

  const submit = useCallback(
    (v: AutoSaveValues) => {
      fetcher.submit(toFormData(v), { method: "post" });
      savedSigRef.current = signature(v);
      setStatus("saving");
    },
    [fetcher],
  );

  const saveNow = useCallback(() => {
    submit(valuesRef.current);
  }, [submit]);

  // 編集で署名が変わったら未保存（保存中の上書きは避ける）
  useEffect(() => {
    if (sig !== savedSigRef.current) {
      setStatus((prev) => (prev === "saving" ? prev : "unsaved"));
    }
  }, [sig]);

  // debounce 経過後、保存済みと差があれば自動保存
  useEffect(() => {
    if (debouncedSig !== savedSigRef.current) {
      submit(valuesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSig]);

  // 送信完了 → 保存済み + 最終保存時刻。直後に未保存編集があれば unsaved へ戻す
  useEffect(() => {
    if (fetcher.state === "idle" && status === "saving") {
      setLastSavedAt(new Date());
      setStatus(signature(valuesRef.current) !== savedSigRef.current ? "unsaved" : "saved");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  return { status, lastSavedAt, saveNow };
}
