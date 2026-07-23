import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { t } from "@/lib/messages";
import { unreadEntries, type ChangelogEntry } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Sparkles } from "lucide-react";

// markdown 描画（react-markdown 一式）はポップオーバーを開いた時にだけロードする。
// チャンク取得に失敗した場合（再デプロイ後の旧タブ等）はページ全体をエラーに
// 落とさず、markdown 原文のプレーンテキスト表示にフォールバックする
const WhatsNewMarkdown = lazy(() =>
  import("./whats-new-markdown")
    .then((mod) => ({ default: mod.WhatsNewMarkdown }))
    .catch(() => ({
      default: ({ markdown }: { markdown: string }) => (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{markdown}</p>
      ),
    })),
);

const SEEN_VERSION_KEY = "minefolio_whats_new_seen";
/** ポップオーバーに積んで表示する未読バージョンの上限 */
const DISPLAY_LIMIT = 5;
// ヘッダーにはデスクトップ用・モバイル用の2インスタンスがあるため、
// 片方で既読化したらもう片方のドットも消すための同一タブ内イベント
const READ_EVENT = "minefolio:whats-new-read";
// requestIdleCallback 非対応環境（Safari 等）向けのフォールバック遅延
const IDLE_FALLBACK_MS = 200;

/** requestIdleCallback があれば使い、なければ setTimeout でフォールバックする */
function scheduleIdle(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback);
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}

function readSeenVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

function writeSeenVersion(version: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SEEN_VERSION_KEY, version);
  } catch {
    // localStorage が使えない環境では既読を永続化しない（ドットが残るだけで実害なし）
  }
}

// カテゴリバッジと本文h3見出しの突き合わせ用（markdown記法の ` を除いて比較）
function normalizeHeading(text: string): string {
  return text.replace(/`/g, "").trim();
}

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  // changelog.md 全文＋パース処理を含む ./whats-new-data はアイドル時に
  // 動的 import する（共通レイアウトの初期チャンクから分離するため）。
  // 読み込み前は null（Skeleton表示・未読判定なし）
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [unreadList, setUnreadList] = useState<ChangelogEntry[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // READ_EVENT ハンドラから「自分が開いて表示中か」を同期的に参照するためのref
  const openRef = useRef(false);

  const latest = entries?.[0] ?? null;

  // SSRとの整合のため、entries読み込み・未読判定は初回マウントの useEffect に
  // 閉じ込める（cookie-consent.tsx と同じ隔離パターン。初期レンダは常に「未読なし」）
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      import("./whats-new-data")
        .then(({ entries: loaded }) => {
          if (cancelled) return;
          setEntries(loaded);
          const latestEntry = loaded[0] ?? null;
          if (!latestEntry) return;
          const seen = readSeenVersion();
          if (seen !== latestEntry.version) {
            const list = unreadEntries(loaded, seen);
            if (list.length > 0) {
              setUnreadList(list);
              setHasUnread(true);
            }
          }
        })
        .catch(() => {
          // チャンク取得失敗時は entries を null のままにし、バッジ非表示に倒す
        });
    });

    const handleRead = () => {
      setHasUnread(false);
      // 開いて表示中のインスタンスは未読スタックを維持し、
      // 非表示側（もう一方のブレークポイント用）だけ既読表示に戻す
      if (!openRef.current) setUnreadList([]);
    };
    window.addEventListener(READ_EVENT, handleRead);
    return () => {
      cancelled = true;
      cancelIdle();
      window.removeEventListener(READ_EVENT, handleRead);
    };
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
    if (nextOpen && latest) {
      // 既読化済みの再オープンでは未読スタックをやめ、最新1件の常設表示に戻す
      if (!hasUnread && unreadList.length > 0) setUnreadList([]);
      // 開いた瞬間に全件既読化。閉じ方による意味の違いは作らない
      writeSeenVersion(latest.version);
      setHasUnread(false);
      window.dispatchEvent(new Event(READ_EVENT));
    }
  };

  // カテゴリバッジのクリックで、本文内の該当セクション（### 見出し）へスクロール
  const scrollToCategory = (category: string) => {
    const container = bodyRef.current;
    if (!container) return;
    const target = Array.from(container.querySelectorAll("h3")).find(
      (heading) => normalizeHeading(heading.textContent ?? "") === normalizeHeading(category),
    );
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top:
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        4,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  // 未読があれば未読分を積んで表示、なければ常設導線として最新1件を表示
  // entries === null（読み込み中）の間は空のまま。本文は下でSkeletonにフォールバック
  const displayEntries =
    unreadList.length > 0 ? unreadList.slice(0, DISPLAY_LIMIT) : (entries ?? []).slice(0, 1);
  const hiddenCount = Math.max(0, unreadList.length - DISPLAY_LIMIT);
  const multi = displayEntries.length > 1;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={hasUnread ? t("whatsNew.ariaLabelUnread") : t("whatsNew.ariaLabel")}
        >
          {/* ベル・封筒は通知/メールと誤解されるため、新着の意味で Sparkles を使う */}
          <Sparkles className="h-5 w-5" aria-hidden />
          {hasUnread && (
            <span
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-background animate-in fade-in duration-300"
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand shrink-0" aria-hidden />
            <span className="text-sm font-semibold">{t("whatsNew.title")}</span>
            {multi ? (
              <Badge variant="secondary">
                {t("whatsNew.unreadCount", { count: unreadList.length })}
              </Badge>
            ) : (
              latest && <Badge variant="secondary">{latest.version}</Badge>
            )}
            {!multi && latest && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {latest.date}
              </span>
            )}
          </div>
          {!multi && displayEntries[0] && displayEntries[0].categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {displayEntries[0].categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => scrollToCategory(category)}
                  className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand transition-colors hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {category}
                </button>
              ))}
            </div>
          )}
        </div>

        {entries === null ? (
          // ./whats-new-data のアイドル読み込みが終わる前にポップオーバーが開かれた場合
          <div className="space-y-2 px-4 py-3">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : displayEntries.length > 0 ? (
          <div ref={bodyRef} className="max-h-[min(55vh,320px)] overflow-y-auto overscroll-contain px-4 py-3">
            <Suspense
              fallback={
                <div className="space-y-2 py-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              }
            >
              {displayEntries.map((entry, index) => (
                <div key={entry.version}>
                  {multi && (
                    <div
                      className={cn(
                        "flex items-baseline gap-2",
                        index > 0 && "mt-3 border-t border-dashed border-border pt-3",
                      )}
                    >
                      <span className="text-xs font-semibold">{entry.version}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {entry.date}
                      </span>
                    </div>
                  )}
                  <WhatsNewMarkdown markdown={entry.body} />
                </div>
              ))}
            </Suspense>
            {hiddenCount > 0 && (
              <p className="mt-3 border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
                {t("whatsNew.hiddenCount", { count: hiddenCount })}
              </p>
            )}
          </div>
        ) : (
          <p className="px-4 py-3 text-xs text-muted-foreground">{t("whatsNew.empty")}</p>
        )}

        <div className="border-t border-border px-4 py-2.5">
          <Link
            to="/developers/changelog"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-link hover:underline"
          >
            {t("whatsNew.viewChangelog")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
