// ガイドの目次（GitBook 風）。
// - 広い画面（xl 以上）: 本文左のガターに sticky 表示（GuideTocSidebar）
// - xl 未満: 上部固定バーのハンバーガーから左ドロワーで表示（GuideTocMobile）
// どちらも共通の TocList を描画し、現在表示中の見出しをハイライトする。
// 最上位の階層だけを常に出し、下の階層は「いま読んでいる節」の分だけ既定で展開する（visibleTocItems）。
// 節ごとの開閉ボタンで手動の開閉もでき、サイドバーは目次全体も畳める（状態は保存しない）。
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useT } from "@/hooks/use-locale";
import { ChevronRight, List } from "lucide-react";
import { useOverlayScrollbarY } from "@/hooks/use-overlay-scrollbar-y";
import { cn } from "@/lib/utils";
import {
  visibleTocItems,
  tocSectionKeys,
  tocDisplayedActiveId,
  TOC_LEAD_SECTION,
  type TocItem,
} from "@/lib/guide-toc";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * 見出しへスクロールし、フォーカスも移す（履歴にハッシュを残す）。
 * フォーカスを移さないと、次の Tab が選んだ節ではなく元の位置（目次バーなど）から進んでしまう。
 * 「動きを減らす」設定ならスムーズスクロールにしない。
 */
function jumpToHeading(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
  // 見出しは本来フォーカス不可。tabindex="-1" を実行時に付ける（SSR の本文 HTML は変えない。
  // 見た目のリングは app.css で消している）
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
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
    // 現在地の項目（アクティブ見出しが畳まれた節の中なら、その節の最上位項目）
    const link = container.querySelector<HTMLElement>('a[aria-current="location"]');
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

/**
 * 目次リスト本体（サイドバー・ドロワー共通）。左の細い縦線の上に、アクティブ項目だけ brand の線を載せる。
 * 最上位の項目ごとに、配下の開閉ボタン（シェブロン）を持つ。既定の開閉は「読んでいる節だけ開く」で、
 * 利用者が手で開閉した節はその操作を優先する（状態は保存しない。親が key で記事ごとに作り直す）。
 * アクティブ項目が畳まれた節の中にあるときは、その節の最上位項目を現在地として強調する。
 */
function TocList({
  items,
  activeId,
  onNavigate,
  touch = false,
  id,
}: {
  items: TocItem[];
  activeId: string | null;
  onNavigate?: (id: string) => void;
  /** true で項目・開閉ボタンの高さを 44px にする（ドロワー用） */
  touch?: boolean;
  id?: string;
}) {
  const t = useT();
  const baseId = useId();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const visible = visibleTocItems(items, activeId, overrides);
  const visibleIds = new Set(visible.map((i) => i.id));
  const displayedActiveId = tocDisplayedActiveId(items, visible, activeId);
  const topLevel = Math.min(...items.map((i) => i.level));

  const renderLink = (item: TocItem) => {
    const isActive = item.id === displayedActiveId;
    return (
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
          // -ml-px で2px の線が親の1px の縦線に重なる。アクティブだけ brand にする。ホバーは文字色のみ
          "-ml-px block min-w-0 flex-1 border-l-2 py-1 pr-2 text-sm leading-snug transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          touch && "flex min-h-11 items-center",
          isActive
            ? "border-brand font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
        style={{ paddingLeft: `${(item.level - topLevel) * 0.875 + 0.75}rem` }}
      >
        {item.text}
      </a>
    );
  };

  // 節ごとにまとめる（先頭の最上位より前の孤立した下位見出しは頭の無い節）
  const sections: { key: string; head: TocItem | null; children: TocItem[] }[] = [];
  items.forEach((item) => {
    if (item.level === topLevel) sections.push({ key: item.id, head: item, children: [] });
    else {
      if (sections.length === 0) sections.push({ key: TOC_LEAD_SECTION, head: null, children: [] });
      sections[sections.length - 1].children.push(item);
    }
  });

  return (
    <ul id={id} className="border-l border-border/60">
      {sections.map((section) => {
        const expanded = section.children.some((c) => visibleIds.has(c.id));
        const subId = `${baseId}-${section.key}`;
        return (
          <li key={section.key || "lead"}>
            {section.head && (
              <div className="flex items-stretch">
                {renderLink(section.head)}
                {section.children.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={subId}
                    aria-label={t("guideToc.sectionToggle", { title: section.head.text })}
                    onClick={() =>
                      setOverrides((prev) => ({ ...prev, [section.key]: !expanded }))
                    }
                    className={cn(
                      "flex shrink-0 items-center justify-center self-start text-muted-foreground transition-colors hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      touch ? "min-h-11 min-w-11" : "size-7",
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 transition-transform motion-reduce:transition-none",
                        expanded && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </button>
                )}
              </div>
            )}
            {section.children.length > 0 && (
              // 畳んでいる間も要素は残す（aria-controls の参照先）。hidden で見えず Tab も届かない
              <ul id={subId} hidden={!expanded}>
                {section.children.map((child) => (
                  <li key={child.id}>
                    <div className="flex items-stretch">{renderLink(child)}</div>
                  </li>
                ))}
              </ul>
            )}
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
  const [open, setOpen] = useState(true);
  const listId = useId();
  if (items.length < 2) return null;

  return (
    // 箱は作らない（欄は箱にしない）。高さは最大で「画面高 - ヘッダー - フッター - マージン」とし
    // sticky 表示（ヘッダー/フッターは可変なので実測して算出）。
    // 「目次」見出しは固定し、リスト部分だけを内部スクロールさせる。
    // スクロールバーは横幅を取らないオーバーレイ（ネイティブは非表示）。
    <nav
      aria-label={t("guideToc.title")}
      style={{ maxHeight }}
      className="sticky top-24 flex flex-col"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex min-h-7 w-full shrink-0 items-center justify-between rounded text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("guideToc.title")}
        <ChevronRight
          className={cn(
            "mr-1.5 h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {/* max-h では percentage 高さ（h-full）が解決しないため、
          入れ子の flex-col + flex-1 でスクローラを高さ制約する */}
      <div className={cn("relative flex min-h-0 flex-1 flex-col", !open && "hidden")}>
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TocList items={items} activeId={activeId} id={listId} />
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
  // ドロワーから選んで閉じる間は true。閉じたあとの Radix のフォーカス復帰（トリガーへ）を止め、見出しへ移す
  const jumpingRef = useRef(false);
  useFollowActiveHeading(scrollRef, activeId);
  const activeItem = items.find((i) => i.id === activeId);
  if (items.length < 2) return null;

  const handleNavigate = (id: string) => {
    jumpingRef.current = true;
    setOpen(false);
    // ドロワーが開いている間は Radix が body のスクロールをロックするため、
    // 開いたまま scrollIntoView しても効かない。閉じアニメーション
    // （duration-300）でロックが解除された後にスクロールする。
    window.setTimeout(() => {
      jumpToHeading(id);
      jumpingRef.current = false;
    }, 320);
  };

  return (
    // xl:hidden はこの sticky バー自身に付ける（ラッパーで包むと sticky の
    // 可動域がバー高さ分しかなくなり、スクロールで流れて操作できなくなる）。
    // -mx-* は親（guides/view.tsx の article）の左右パディングを打ち消して全幅化する。
    // モバイル（base）は article 側が px-0 になったため打ち消し不要（sm 以上は sm:px-6 と対）。
    <div className="xl:hidden sticky top-16 z-30 mb-6 border-y border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={
              activeItem
                ? `${t("guideToc.title")}: ${activeItem.text}`
                : undefined
            }
            className="flex w-full items-center gap-2 px-4 py-3.5 text-sm font-semibold hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
          >
            <List className="h-4 w-4 shrink-0 text-muted-foreground" />
            {/* 現在のセクション名を表示（未確定時は「目次」） */}
            <span className="min-w-0 truncate">
              {activeItem ? activeItem.text : t("guideToc.title")}
            </span>
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
          closeLabel={t("guideToc.close")}
          // 閉じるボタンはモバイルで 44px、sm 以上は既定の大きさ
          closeClassName="top-1.5 right-2 flex min-h-11 min-w-11 items-center justify-center sm:top-5 sm:right-4 sm:min-h-0 sm:min-w-0"
          // 開いたときは Radix 既定（先頭のフォーカス可能要素＝閉じるボタン）にせず、現在の項目へフォーカスする
          // （現在の項目が無ければ最初の項目）。閉じるボタンは Tab で届く
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = scrollRef.current;
            const target =
              root?.querySelector<HTMLElement>('a[aria-current="location"]') ??
              root?.querySelector<HTMLElement>("a");
            target?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            if (jumpingRef.current) e.preventDefault();
          }}
        >
          <SheetTitle className="flex items-center gap-2 border-b border-border py-4 pl-5 pr-14 text-sm font-semibold">
            <List className="h-4 w-4 text-muted-foreground" />
            {t("guideToc.title")}
          </SheetTitle>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-3">
            {/* 項目タップで閉じてからスクロールする（handleNavigate） */}
            <TocList
              items={items}
              activeId={activeId}
              onNavigate={handleNavigate}
              touch
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
