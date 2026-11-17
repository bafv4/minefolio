import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  CONTRAST_ATTRIBUTE,
  CONTRAST_CHANGE_EVENT,
  CONTRAST_STORAGE_KEY,
  readStoredContrast,
  resolveContrast,
  writeStoredContrast,
} from "@/lib/contrast";

const OS_QUERY = "(prefers-contrast: more)";

function getSnapshot(): boolean {
  return resolveContrast(readStoredContrast(), window.matchMedia(OS_QUERY).matches);
}

// サーバーとハイドレーション直後はオフ。マウント後にクライアントの値へ切り替わる（属性は初回描画前スクリプトが先に付ける）
function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(OS_QUERY);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CONTRAST_STORAGE_KEY) onChange();
  };
  mql.addEventListener("change", onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CONTRAST_CHANGE_EVENT, onChange);
  return () => {
    mql.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CONTRAST_CHANGE_EVENT, onChange);
  };
}

/**
 * ハイコントラストのオン・オフ。明示の選択（localStorage）が無い間は OS の設定に追従し、
 * 別タブでの変更（storage）にも追従する。属性の反映は ContrastSync（providers.tsx）が行う。
 */
export function useContrast() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setEnabled = useCallback((next: boolean) => {
    writeStoredContrast(next ? "more" : "normal");
    window.dispatchEvent(new Event(CONTRAST_CHANGE_EVENT));
  }, []);
  return { enabled, setEnabled };
}

// ハイドレーション中もクライアントの値を読む（描画物が無いので不一致は起きない）。
// サーバー用の false を使うと、初回描画前スクリプトが付けた属性を一瞬外してちらつく
function getClientSnapshot(): boolean {
  return typeof window === "undefined" ? false : getSnapshot();
}

/** html の data-contrast 属性を現在値に合わせる（Providers に1つだけ置く） */
export function ContrastSync() {
  const enabled = useSyncExternalStore(subscribe, getClientSnapshot, getClientSnapshot);
  useEffect(() => {
    const root = document.documentElement;
    if (enabled) root.setAttribute(CONTRAST_ATTRIBUTE, "more");
    else root.removeAttribute(CONTRAST_ATTRIBUTE);
  }, [enabled]);
  return null;
}
