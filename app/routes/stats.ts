import { redirect } from "react-router";

// 旧 /stats ルート（プラットフォーム全体統計）。内容は /keybindings/stats へ統合されたため、
// 既存のリンク・ブックマークからのアクセスは 301 でそちらへリダイレクトする。
export function loader() {
  return redirect("/keybindings/stats", 301);
}
