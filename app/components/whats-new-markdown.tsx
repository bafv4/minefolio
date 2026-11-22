import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/** hast の節点から文字だけを取り出す（h3 の突き合わせ用） */
function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: unknown; children?: unknown[] };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  return (n.children ?? []).map(hastText).join("");
}

// What's New ポップオーバー本文の markdown 描画。
// react-markdown 一式を共通チャンクに含めないよう、whats-new.tsx から
// React.lazy で読み込む。
// h3Label: 見出し（### カテゴリ）の表示名の読み替え。元の文字を渡し、変わらなければ元の描画のまま
export function WhatsNewMarkdown({
  markdown,
  h3Label,
}: {
  markdown: string;
  h3Label?: (text: string) => string;
}) {
  return (
    <div className="prose prose-sm prose-tokens max-w-none text-[13px] leading-relaxed [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_ul]:my-1 [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={
          h3Label
            ? {
                h3: ({ node, children, ...props }) => {
                  const raw = hastText(node);
                  const label = h3Label(raw);
                  return <h3 {...props}>{label !== raw ? label : children}</h3>;
                },
              }
            : undefined
        }
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
