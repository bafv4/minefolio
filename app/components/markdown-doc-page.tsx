// アイコン + h1 + prose シェルで markdown 本文を表示する静的ドキュメントページ共通部分。
// privacy / terms / developers/changelog / developers/api の4ページで同一だった
// マークアップ（ReactMarkdown + remarkGfm + rehypeSanitize、prose クラス）を集約する。
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface MarkdownDocPageProps {
  icon: LucideIcon;
  heading: ReactNode;
  markdown: string;
  /** changelog / api ページの「戻る」ボタン行。省略時は何も表示しない（privacy / terms と同一出力） */
  backLink?: { to: string; label: ReactNode };
}

export function MarkdownDocPage({ icon: Icon, heading, markdown, backLink }: MarkdownDocPageProps) {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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
            単体閲覧するときのために残しているので、描画時には出力しない（二重表示の防止） */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{ h1: () => null }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
