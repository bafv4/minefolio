// リマップ / サーチクラフト埋め込み（data-user-slug だけを持つ）の走者データを、エディタの中で引く軽いキャッシュ。
// 公開ページと同じ規則で解決する API（/api/guides/embed-resolve）を使う。NodeView は再マウントが多いため、
// モジュール内で保持し、同じ走者への同時の問い合わせは1つにまとめる。
import { useEffect, useState } from "react";
import type { EmbedUserData } from "@/lib/guide-embed-data";

/** null = 取得済みだが見つからない（存在しない・非公開） */
const cache = new Map<string, EmbedUserData | null>();
const inflight = new Map<string, Promise<EmbedUserData | null | undefined>>();

/**
 * 走者のデータを引く。undefined は通信の失敗（キャッシュしない。次回に再試行）。
 * fresh=true ならキャッシュを使わず取り直す（挿入ダイアログで選び直したとき。走者が設定を変えていることがある）
 */
export function fetchEmbedUser(
  user: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<EmbedUserData | null | undefined> {
  const key = user.trim();
  if (!key) return Promise.resolve(null);
  if (!fresh && cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = fetch(`/api/guides/embed-resolve?user=${encodeURIComponent(key)}`)
    .then(async (res) => {
      if (!res.ok) return undefined;
      const data = (await res.json()) as { user: EmbedUserData | null };
      return data.user ?? null;
    })
    .catch(() => undefined)
    .then((result) => {
      inflight.delete(key);
      if (result !== undefined) cache.set(key, result);
      return result;
    });
  inflight.set(key, promise);
  return promise;
}

export function getCachedEmbedUser(user: string): EmbedUserData | null | undefined {
  return cache.get(user.trim());
}

/** 解決の状態。loading = 問い合わせ中、error = 通信の失敗、missing = 見つからない */
export type EmbedUserState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "found"; user: EmbedUserData };

function toState(value: EmbedUserData | null | undefined): EmbedUserState {
  if (value === undefined) return { status: "loading" };
  return value ? { status: "found", user: value } : { status: "missing" };
}

/** 走者の指定（slug / MCID）を解決する。空なら missing */
export function useEmbedUser(user: string, { fresh = false }: { fresh?: boolean } = {}): EmbedUserState {
  const key = user.trim();
  const [state, setState] = useState<EmbedUserState>(() =>
    key ? toState(fresh ? undefined : getCachedEmbedUser(key)) : { status: "missing" },
  );

  useEffect(() => {
    if (!key) {
      setState({ status: "missing" });
      return;
    }
    const cached = fresh ? undefined : getCachedEmbedUser(key);
    if (cached !== undefined) {
      setState(toState(cached));
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchEmbedUser(key, { fresh }).then((result) => {
      if (cancelled) return;
      setState(result === undefined ? { status: "error" } : toState(result));
    });
    return () => {
      cancelled = true;
    };
  }, [key, fresh]);

  return state;
}
