import { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import {
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";

/** 最初に描画するガイドの件数。残りは「もっと見る」で出す（ローダーは全件を返し、出す件数だけクライアントで絞る） */
export const GUIDE_PAGE_SIZE = 24;

/**
 * ガイド一覧（カード / リスト）を GUIDE_PAGE_SIZE 件ずつ出す。件数が GUIDE_PAGE_SIZE 以下ならボタンは出さない。
 * 追加で出したら、追加分の最初のカードのタイトルリンクへフォーカスを移す
 * （ボタンが押された位置から Tab を続けると、いま足した分の先頭から読める）。
 * 絞り込みや並び順が変わったら出す件数を戻したいので、呼び出し側は検索条件を `key` に渡す。
 */
export function GuidePagedList({
  guides,
  linkFn,
  viewMode,
  titleLevel,
  tagHref,
  linkState,
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
  viewMode: "card" | "list";
  titleLevel?: "h2" | "h3" | "h4";
  /** タグの行き先（GuideCardGrid / GuideListView へそのまま渡す） */
  tagHref?: (tag: string) => string;
  /** 記事へのリンクに載せる location.state（GuideCardGrid / GuideListView へそのまま渡す） */
  linkState?: unknown;
}) {
  const t = useT();
  const [visibleCount, setVisibleCount] = useState(GUIDE_PAGE_SIZE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 「もっと見る」で追加された最初のカードの位置。描画後にそのタイトルリンクへフォーカスする
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const index = focusIndexRef.current;
    if (index === null) return;
    focusIndexRef.current = null;
    rootRef.current?.querySelectorAll<HTMLElement>("a[data-guide-link]")[index]?.focus();
  }, [visibleCount]);

  const shown = guides.slice(0, visibleCount);
  const remaining = guides.length - shown.length;

  return (
    <div ref={rootRef} className="space-y-6">
      {viewMode === "card" ? (
        <GuideCardGrid guides={shown} linkFn={linkFn} titleLevel={titleLevel} tagHref={tagHref} linkState={linkState} />
      ) : (
        <GuideListView guides={shown} linkFn={linkFn} titleLevel={titleLevel} tagHref={tagHref} linkState={linkState} />
      )}
      {remaining > 0 && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              focusIndexRef.current = shown.length;
              setVisibleCount(visibleCount + GUIDE_PAGE_SIZE);
            }}
          >
            {t("guides.loadMore", { count: remaining })}
          </Button>
        </div>
      )}
    </div>
  );
}
