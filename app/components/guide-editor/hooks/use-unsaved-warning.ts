// 未保存離脱の警告。アプリ内遷移は useBlocker、タブ閉じ/リロードは beforeunload で抑止。
import { useEffect } from "react";
import { useBlocker } from "react-router";
import type { Blocker } from "react-router";

/**
 * @param dirty 未保存変更があるか（status !== "saved"）
 * @returns アプリ内遷移ブロッカー。state === "blocked" の間は確認 UI を表示する
 */
export function useUnsavedWarning(dirty: boolean): Blocker {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return blocker;
}
