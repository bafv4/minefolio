import { redirect } from "react-router";

// 旧 /live ルート。ライブペースはホームのペースフィードへ統合されたため、
// 既存のリンク・ブックマークからのアクセスはホームのライブ欄（#home-live）へリダイレクトする。
export function loader() {
  return redirect("/#home-live");
}
