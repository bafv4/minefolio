import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// What's New ポップオーバー本文の markdown 描画。
// react-markdown 一式を共通チャンクに含めないよう、whats-new.tsx から
// React.lazy で読み込む。
export function WhatsNewMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_ul]:my-1 [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
