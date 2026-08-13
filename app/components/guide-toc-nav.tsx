// ガイドの目次（GitBook 風）。
// - 広い画面（xl 以上）: 本文左に sticky 表示（GuideTocSidebar）
// - 狭い画面: 上部固定バーのハンバーガーから左ドロワーで表示（GuideTocMobile）
// どちらも共通の TocList を描画し、現在表示中の見出しをハイライトする。
import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "@/hooks/use-locale";
import { List } from "lucide-react";
import { useOverlayScrollbarY } from "@/hooks/use-overlay-scrollbar-y";
import { cn } from "@/lib/utils";
import type { TocItem } from "@/lib/guide-toc";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";

/** 見出しへスムーズスクロールする（履歴にハッシュを残す） */
function jumpToHeading(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

/**
 * スクロール位置に応じて現在の見出し id を返す。
 * 見出し上端が「追従ヘッダー下（約6rem）」を最後に超えたものをアクティブとする。
 */
function useActiveHeading(items: TocItem[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length === 0) return;

    const ids = items.map((i) => i.id);
    let ticking = false;

    const update = () => {
      ticking = false;
      // ヘッダー(h-16=4rem) + 余白 を考慮したしきい値
      const threshold = 96;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - threshold <= 1) {
          current = id;
        } else {
          break;
        }
      }
      // ページ最下部付近では最後の見出しを active にする
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      ) {
        current = ids[ids.length - 1];
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  return activeId;
}

/**
 * アクティブ見出しの変化に合わせて、目次コンテナ「内だけ」をスクロールし、
 * 現在の項目が常に見える位置に来るようにする（本文が長く目次が縦に溢れる場合の追従）。
 * ウィンドウ本体のスクロール位置は変更しない（container.scrollTop のみ操作）。
 */
function useFollowActiveHeading(
  containerRef: RefObject<HTMLElement | null>,
  activeId: string | null,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeId) return;
    const link = container.querySelector<HTMLElement>(`a[href="#${activeId}"]`);
    if (!link) return;
    const cRect = container.getBoundingClientRect();
    const lRect = link.getBoundingClientRect();
    const margin = 12;
    if (lRect.top < cRect.top + margin) {
      container.scrollTop -= cRect.top + margin - lRect.top;
    } else if (lRect.bottom > cRect.bottom - margin) {
      container.scrollTop += lRect.bottom - (cRect.bottom - margin);
    }
  }, [containerRef, activeId]);
}

/**
 * サイドバー目次の最大高さ「画面高 - ヘッダー高 - フッター高 - マージン」を算出する。
 * ヘッダー / フッターは高さ可変のため実測し、リサイズで再計算する。
 * SSR・初期描画では近似値を用い、マウント後に実測値へ差し替える。
 */
const TOC_HEIGHT_MARGIN_PX = 64;
function useTocMaxHeight(): string {
  const [maxHeight, setMaxHeight] = useState("calc(100vh - 16rem)");
  useEffect(() => {
    const compute = () => {
      const headerH =
        document.querySelector("header")?.getBoundingClientRect().height ?? 64;
      const footerH =
        document.querySelector("footer")?.getBoundingClientRect().height ?? 0;
      setMaxHeight(
        `calc(100vh - ${Math.round(headerH + footerH + TOC_HEIGHT_MARGIN_PX)}px)`,
      );
    };
    compute();
    window.addEventListener("resize", compute, { passive: true });
    return () => window.removeEventListener("resize", compute);
  }, []);
  return maxHeight;
}

/** 目次リスト本体（サイドバー・ドロワー共通） */
function TocList({
  items,
  activeId,
  onNavigate,
}: {
  items: TocItem[];
  activeId: string | null;
  onNavigate?: (id: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                // onNavigate があればスクロールも呼び出し側に委ねる
                // （ドロワーは閉じてからスクロールする必要があるため）
                if (onNavigate) onNavigate(item.id);
                else jumpToHeading(item.id);
              }}
              aria-current={isActive ? "location" : undefined}
              className={cn(
                // アクティブは左端の真っ直ぐな縦線（角丸なし）。ホバーは文字色のみ変え、枠線・背景は付けない
                "block border-l-2 py-1 pr-2 text-sm leading-snug transition-colors",
                isActive
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              style={{ paddingLeft: `${(item.level - 1) * 0.875 + 0.625}rem` }}
            >
              {item.text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 広い画面用の目次サイドバー。sticky でスクロール追従する。
 * 親側で `hidden xl:block` などの表示制御を行う前提。
 */
export function GuideTocSidebar({ items }: { items: TocItem[] }) {
  const t = useT();
  const activeId = useActiveHeading(items);
  const { scrollerRef, scrollbar } = useOverlayScrollbarY();
  useFollowActiveHeading(scrollerRef, activeId);
  const maxHeight = useTocMaxHeight();
  if (items.length < 2) return null;

  return (
    // 目次領域をカード化。高さは最大で「画面高 - ヘッダー - フッター - マージン」とし
    // sticky 表示（ヘッダー/フッターは可変なので実測して算出）。
    // 「目次」見出しは固定し、リスト部分だけを内部スクロールさせる。
    // スクロールバーは横幅を取らないオーバーレイ（ネイティブは非表示）。
    <nav
      aria-label={t("guideToc.title")}
      style={{ maxHeight }}
      className="sticky top-24 flex flex-col rounded-xl border bg-card p-3"
    >
      <p className="mb-2 flex shrink-0 items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <List className="h-3.5 w-3.5" />
        {t("guideToc.title")}
      </p>
      {/* max-h では percentage 高さ（h-full）が解決しないため、
          入れ子の flex-col + flex-1 でスクローラを高さ制約する */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TocList items={items} activeId={activeId} />
        </div>
        {scrollbar}
      </div>
    </nav>
  );
}

/**
 * 狭い画面用の目次。上部に sticky なバーを置き、ハンバーガーから左ドロワーで開く。
 * 親側で `xl:hidden` などの表示制御を行う前提。
 */
export function GuideTocMobile({ items }: { items: TocItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const activeId = useActiveHeading(items);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useFollowActiveHeading(scrollRef, activeId);
  if (items.length < 2) return null;

  const handleNavigate = (id: string) => {
    setOpen(false);
    // ドロワーが開いている間は Radix が body のスクロールをロックするため、
    // 開いたまま scrollIntoView しても効かない。閉じアニメーション
    // （duration-300）でロックが解除された後にスクロールする。
    window.setTimeout(() => jumpToHeading(id), 320);
  };

  return (
    // 2xl:hidden はこの sticky バー自身に付ける（ラッパーで包むと sticky の
    // 可動域がバー高さ分しかなくなり、スクロールで流れて操作できなくなる）。
    // -mx-* は親（guides/view.tsx の article）の左右パディングを打ち消して全幅化する。
    // モバイル（base）は article 側が px-0 になったため打ち消し不要（sm 以上は sm:px-6 と対）。
    <div className="2xl:hidden sticky top-16 z-30 mb-6 border-y border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3.5 text-sm font-semibold hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
          >
            <List className="h-4 w-4 text-muted-foreground" />
            {t("guideToc.title")}
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
        >
          <SheetTitle className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold">
            <List className="h-4 w-4 text-muted-foreground" />
            {t("guideToc.title")}
          </SheetTitle>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-3">
            {/* 項目タップで閉じてからスクロールする（handleNavigate） */}
            <TocList
              items={items}
              activeId={activeId}
              onNavigate={handleNavigate}
            />
          </div>
          {/* アクセシビリティ用の隠しクローズ（右上 X は SheetContent 既定） */}
          <SheetClose className="sr-only">{t("guideToc.close")}</SheetClose>
        </SheetContent>
      </Sheet>
    </div>
  );
}
