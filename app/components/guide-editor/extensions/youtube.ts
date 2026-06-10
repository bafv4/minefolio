// YouTube 拡張。nocookie 埋め込み + カスタム NodeView。
// 旧 index.tsx の Youtube.configure(...).extend(...) から逐語移植。
import { Youtube } from "@tiptap/extension-youtube";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { YoutubeNodeView } from "../node-views/youtube-node-view";

export const CustomYoutube = Youtube.configure({ nocookie: true }).extend({
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(YoutubeNodeView as any);
  },
});
