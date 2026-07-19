import { redirect } from "react-router";

// 旧 /live ルート。ライブペースはホームのペースフィードへ統合されたため、
// 既存のリンク・ブックマークからのアクセスはホームへリダイレクトする。
export function loader() {
  return redirect("/");
}
