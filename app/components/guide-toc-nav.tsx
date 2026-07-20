// ガイドの目次（GitBook 風）。
// - 広い画面（xl 以上）: 本文左に sticky 表示（GuideTocSidebar）
// - 狭い画面: 上部固定バーのハンバーガーから左ドロワーで表示（GuideTocMobile）
// どちらも共通の TocList を描画し、現在表示中の見出しをハイライトする。
import { useEffect, useState } from "react";
import { List, Menu } from "lucide-react";
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
                jumpToHeading(item.id);
                onNavigate?.(item.id);
              }}
              aria-current={isActive ? "location" : undefined}
              className={cn(
                "block rounded-md border-l-2 py-1 pr-2 text-sm leading-snug transition-colors",
                isActive
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
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
  const activeId = useActiveHeading(items);
  if (items.length < 2) return null;

  return (
    <nav
      aria-label="目次"
      className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto"
    >
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <List className="h-3.5 w-3.5" />
        目次
      </p>
      <TocList items={items} activeId={activeId} />
    </nav>
  );
}

/**
 * 狭い画面用の目次。上部に sticky なバーを置き、ハンバーガーから左ドロワーで開く。
 * 親側で `xl:hidden` などの表示制御を行う前提。
 */
export function GuideTocMobile({ items }: { items: TocItem[] }) {
  const [open, setOpen] = useState(false);
  const activeId = useActiveHeading(items);
  if (items.length < 2) return null;

  return (
    <div className="sticky top-16 z-30 -mx-4 mb-6 border-y border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold sm:px-6"
          >
            <Menu className="h-4 w-4 text-muted-foreground" />
            目次
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
        >
          <SheetTitle className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold">
            <List className="h-4 w-4 text-muted-foreground" />
            目次
          </SheetTitle>
          <div className="flex-1 overflow-y-auto p-3">
            {/* SheetClose でラップし、項目タップ時にジャンプしつつドロワーを閉じる */}
            <TocList
              items={items}
              activeId={activeId}
              onNavigate={() => setOpen(false)}
            />
          </div>
          {/* アクセシビリティ用の隠しクローズ（右上 X は SheetContent 既定） */}
          <SheetClose className="sr-only">閉じる</SheetClose>
        </SheetContent>
      </Sheet>
    </div>
  );
}
