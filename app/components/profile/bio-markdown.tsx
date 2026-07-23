import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

// プロフィールの自己紹介（bio）の markdown 描画。
// react-markdown 一式を初回ロードの共通チャンクに含めないよう、
// profile.tsx から React.lazy で読み込む（whats-new-markdown.tsx と同じパターン）。
export function BioMarkdown({ bio }: { bio: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-headings:font-bold prose-h1:text-xl prose-h1:mt-0 prose-h2:text-lg prose-p:text-muted-foreground prose-p:my-2">
      <Markdown rehypePlugins={[rehypeSanitize]}>{bio}</Markdown>
    </div>
  );
}
