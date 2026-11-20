// アイコン + h1 + prose シェルで markdown 本文を表示する静的ドキュメントページ共通部分。
// privacy / terms / developers/changelog / developers/api の4ページで同一だった
// マークアップ（ReactMarkdown + remarkGfm + rehypeSanitize、prose クラス）を集約する。
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useT } from "@/hooks/use-locale";
import { useHorizontalOverflow } from "@/hooks/use-horizontal-overflow";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, ChevronsRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** 畳んで出す節（更新履歴の古い版など）。`heading` を summary の h2 にし、`markdown` を中身にする */
export interface CollapsedDocSection {
  heading: string;
  markdown: string;
}

interface MarkdownDocPageProps {
  icon: LucideIcon;
  heading: ReactNode;
  markdown: string;
  /** changelog / api ページの「戻る」ボタン行。省略時は何も表示しない（privacy / terms と同一出力） */
  backLink?: { to: string; label: ReactNode };
  /** 本文の前に、h2 の目次（ページ内リンク）を置く（規約・ポリシーなど節の多い長いページ） */
  toc?: boolean;
  /** 本文の後ろに、畳んだ節（details）として並べる物 */
  collapsedSections?: CollapsedDocSection[];
  /** 見出しの直後（本文の前）に置く通知帯など */
  notice?: ReactNode;
}

/** 横スクロールの器のキーボードフォーカス（--ring の 2px） */
const SCROLL_FOCUS_CLASS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * 見出しの文字から、ページ内リンクの id を作る（目次と h2 の両方が同じ関数を通す）。
 * 例: "1. 取得する情報" → "1-取得する情報"
 */
export function docHeadingId(text: string): string {
  return text
    .trim()
    .replace(/[\s.。、,()（）「」『』:：/／#]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** markdown の `## 見出し` を上から順に取り出す（強調・コードの記号は外す） */
function extractH2Headings(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = line.match(/^## (.+?)\s*#*\s*$/);
    if (match) headings.push(match[1].replace(/[*_`]/g, "").trim());
  }
  return headings;
}

/** hast の節点から文字だけを取り出す（h2 の id 用） */
function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: unknown; children?: unknown[] };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  return (n.children ?? []).map(hastText).join("");
}

/** 表は横スクロールの器で包む（器の外へはみ出してページごと横に動かないように）。
    器が表の上下の余白を持ち、表自身の余白は外す（器の中で余白が二重にならないように）。
    本文の行の長さの上限（.doc-content の 42em）は掛けず、幅を使ってよい（doc-wide） */
function ScrollableTable({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  const t = useT();
  const { ref, overflowing, regionProps } = useHorizontalOverflow<HTMLDivElement>(t("common.tableScrollRegion"));
  return (
    <div className="doc-wide my-6">
      {/* 列の多い表は md 未満で最小幅を持ち（app.css）、この器の中で横に動く。動かせることを先に知らせる */}
      {overflowing && (
        <p className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground md:hidden">
          {t("common.scrollHorizontalHint")}
          <ChevronsRight className="h-3 w-3" aria-hidden />
        </p>
      )}
      <div ref={ref} className={cn("overflow-x-auto [&>table]:my-0", SCROLL_FOCUS_CLASS)} {...regionProps}>
        <table {...props} />
      </div>
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

/** h2 にページ内リンク用の id を付ける（目次から飛べるように） */
function HeadingWithId({ node, ...props }: ComponentProps<"h2"> & ExtraProps) {
  return <h2 id={docHeadingId(hastText(node))} {...props} />;
}

/** 本文の markdown（ページタイトルの `# ` は出さない。表・コードは横スクロールの器） */
function DocMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{ h1: () => null, h2: HeadingWithId, table: ScrollableTable, pre: ScrollablePre }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

/** 本文の器。配色はテーマトークン（app/app.css の .doc-content.prose。prose-invert / dark: は使わない） */
const ARTICLE_CLASS = "doc-content prose max-w-none";

export function MarkdownDocPage({
  icon: Icon,
  heading,
  markdown,
  backLink,
  toc = false,
  collapsedSections,
  notice,
}: MarkdownDocPageProps) {
  const t = useT();
  const tocHeadings = toc ? extractH2Headings(markdown) : [];

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
        <Icon className="h-6 w-6" aria-hidden />
        <h1 className="text-2xl font-bold">{heading}</h1>
      </div>

      {notice}

      {tocHeadings.length > 0 && (
        <nav aria-labelledby="doc-toc-title" className="max-w-[42em] border-b border-border/60 pb-4">
          <h2 id="doc-toc-title" className="text-base font-semibold">
            {t("common.tableOfContents")}
          </h2>
          <ol className="mt-2 grid gap-x-6 text-sm sm:grid-cols-2">
            {tocHeadings.map((text) => (
              <li key={text}>
                <a
                  href={`#${docHeadingId(text)}`}
                  className={cn(
                    "inline-flex min-h-11 items-center text-primary underline-offset-2 hover:underline sm:min-h-8",
                    SCROLL_FOCUS_CLASS,
                  )}
                >
                  {text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <article className={ARTICLE_CLASS}>
        {/* ページタイトルは上の h1（アイコン付き）が担う。md 側の `# タイトル` は GitHub 等で
            単体閲覧するときのために残しているので、描画時には出力しない（二重表示の防止）。
            表・コードブロックは横スクロールの器にする（モバイルでページ全体が横に動かないように） */}
        <DocMarkdown markdown={markdown} />
      </article>

      {collapsedSections && collapsedSections.length > 0 && (
        <div className="max-w-[42em] border-t border-foreground/15">
          {collapsedSections.map((section) => (
            <details key={section.heading} className="group border-b border-border/60">
              <summary
                className={cn(
                  "flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden",
                  SCROLL_FOCUS_CLASS,
                )}
              >
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                  aria-hidden
                />
                <h2 id={docHeadingId(section.heading)} className="text-xl font-bold">
                  {section.heading}
                </h2>
              </summary>
              <article className={cn(ARTICLE_CLASS, "pb-4")}>
                <DocMarkdown markdown={section.markdown} />
              </article>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
