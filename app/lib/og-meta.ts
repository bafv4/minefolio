// 静的ドキュメント系ページ（privacy / terms / developers/*）で共通の meta 配列ビルダー。
// title・description・OGP画像（appUrl/icon.png）のみの単純なページ向け。
// ページ固有の追加meta（twitter:card 等）が必要になったら、戻り値を呼び出し側で追加で結合する。
import type { MetaDescriptor } from "react-router";

export function buildOgMeta({
  title,
  description,
  appUrl,
  ogType = "article",
}: {
  title: string;
  description: string;
  appUrl: string;
  ogType?: "article" | "website";
}): MetaDescriptor[] {
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: ogType },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
}
