import type { PaceManStats } from "./external-stats";

/**
 * PaceMan の登録確認（ブラウザ用）。paceman.gg は CORS 非対応のため `/api/paceman-registration` 経由で取得する。
 * 取得失敗（非2xx・ネットワークエラー）は未登録と区別するため例外を投げる。
 */
export async function fetchPaceManRegistration(mcid: string): Promise<PaceManStats> {
  const res = await fetch(`/api/paceman-registration?name=${encodeURIComponent(mcid)}`);
  // 400 は名前の形式が PaceMan の対象外（Java 版の 3〜16 文字の英数字と _ 以外）なので、失敗ではなく未登録とみなす
  if (res.status === 400) return { isRegistered: false };
  if (!res.ok) throw new Error(`paceman-registration HTTP ${res.status}`);
  const data = (await res.json()) as { isRegistered?: unknown };
  return { isRegistered: data.isRegistered === true };
}
