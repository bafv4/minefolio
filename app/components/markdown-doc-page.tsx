// アイコン + h1 + prose シェルで markdown 本文を表示する静的ドキュメントページ共通部分。
// privacy / terms / developers/changelog / developers/api の4ページで同一だった
// マークアップ（ReactMarkdown + remarkGfm + rehypeSanitize、prose クラス）を集約する。
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MarkdownDocPageProps {
  icon: LucideIcon;
  heading: ReactNode;
  markdown: string;
  /** changelog / api ページの「戻る」ボタン行。省略時は何も表示しない（privacy / terms と同一出力） */
  backLink?: { to: string; label: ReactNode };
}

/** 横スクロールの器のキーボードフォーカス（--ring の 2px） */
const SCROLL_FOCUS_CLASS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * 要素が横にはみ出しているか（中身の幅 > 器の幅）を ResizeObserver で追う。
 * はみ出しているときだけ器を Tab で止まれる名前付きの領域にするため（収まっている表・コードに停止点を増やさない）。
 * JS 前（SSR）は false＝停止点なしのまま
 */
function useHorizontalOverflow<T extends HTMLElement>(label: string) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setOverflowing(el.scrollWidth - el.clientWidth > 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  const regionProps = overflowing
    ? { tabIndex: 0, role: "region" as const, "aria-label": label }
    : {};
  return { ref, regionProps };
}

/** 表は横スクロールの器で包む（器の外へはみ出してページごと横に動かないように）。
    器が表の上下の余白（prose-sm の 2em ≒ 24px）を持ち、表自身の余白は外す（器の中で余白が二重にならないように） */
function ScrollableTable({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  const t = useT();
  const { ref, regionProps } = useHorizontalOverflow<HTMLDivElement>(t("common.tableScrollRegion"));
  return (
    <div ref={ref} className={cn("my-6 overflow-x-auto [&>table]:my-0", SCROLL_FOCUS_CLASS)} {...regionProps}>
      <table {...props} />
    </div>
  );
}

/** コードブロックは prose の overflow-x: auto で既にスクロールの器なので、pre 自身をキーボードで動かせるようにする */
function ScrollablePre({ node: _node, className, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const t = useT();
  const { ref, regionProps } = useHorizontalOverflow<HTMLPreElement>(t("common.codeScrollRegion"));
  return (
    <pre
      ref={ref}
      className={cn(className, SCROLL_FOCUS_CLASS)}
      {...props}
      {...regionProps}
    />
  );
}

export function MarkdownDocPage({ icon: Icon, heading, markdown, backLink }: MarkdownDocPageProps) {
  return (
    // w-full: 親の main は flex-col で、mx-auto の子は中身の幅（表の最小幅）まで広がりページごと横に動くため、
    // 幅を親に合わせて固定する（max-w-4xl と mx-auto で従来どおり中央寄せ）
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      {backLink && (
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to={backLink.to}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {backLink.label}
            </Link>
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Icon className="h-6 w-6" />
        <h1 className="text-2xl font-bold">{heading}</h1>
      </div>

      <article className="prose prose-sm dark:prose-invert max-w-none">
        {/* ページタイトルは上の h1（アイコン付き）が担う。md 側の `# タイトル` は GitHub 等で
            単体閲覧するときのために残しているので、描画時には出力しない（二重表示の防止）。
            表・コードブロックは横スクロールの器にする（モバイルでページ全体が横に動かないように） */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{ h1: () => null, table: ScrollableTable, pre: ScrollablePre }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
