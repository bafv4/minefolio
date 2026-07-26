// 未マッチパス用のキャッチオール。
//
// ルートが 1 つも一致しないと root ローダーが実行されず、ロケールが未確定のまま
// root の ErrorBoundary が描画される（Cookie が en でも 404 ページだけ日本語になる）。
// ここで一度マッチさせて root ローダーを走らせてから 404 を投げ直すことで、
// 表示・ステータスは従来どおりのまま、文言だけロケールに追従させる。
export async function loader() {
  throw new Response(null, { status: 404 });
}

// loader が必ず throw するため描画されない。UI ルートとして扱わせるために置く
// （リソースルートだと ErrorBoundary ではなく素の 404 レスポンスになる）。
export default function NotFound() {
  return null;
}
