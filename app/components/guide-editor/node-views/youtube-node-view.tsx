// YouTube 埋め込みの NodeView。56.25% アスペクト比 + 削除ボタン。
// 旧 index.tsx YoutubeNodeView / getYouTubeEmbedUrl から逐語移植。
import { NodeViewWrapper } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** youtu.be / watch?v= / embed/ いずれの URL からも nocookie 埋め込み URL を生成 */
function getYouTubeEmbedUrl(src: string): string {
  const match = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&#]+)/);
  const id = match?.[1];
  if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
  return src;
}

export function YoutubeNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, string | number> };
  deleteNode: () => void;
}) {
  const embedUrl = getYouTubeEmbedUrl(String(node.attrs.src));

  return (
    <NodeViewWrapper>
      <div className="relative group my-4">
        <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-lg">
          <iframe
            src={embedUrl}
            className="absolute top-0 left-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube video"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                deleteNode();
              }}
              className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>動画を削除</TooltipContent>
        </Tooltip>
      </div>
    </NodeViewWrapper>
  );
}
