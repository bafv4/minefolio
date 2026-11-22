// ガイド本文（サニタイズ済みHTML文字列）の画像の汎用 alt を表示時に空にする純粋関数。
// 旧エディタは alt に固定値 "image" を入れていた。これはスクリーンリーダーに無意味な
// 読み上げをさせるため、公開表示では alt="" （装飾扱い）に置き換える。
// 保存データは書き換えない。"image" 以外の値（利用者が入力した説明）は保持する。

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const GENERIC_ALT_RE = /(\salt\s*=\s*)(?:"\s*image\s*"|'\s*image\s*')/i;

/** 旧エディタが自動で入れていた汎用 alt（"image"）か。翻訳対象からも外す（guide-translate-html.server.ts） */
export function isGenericImageAlt(value: string): boolean {
  return value.trim().toLowerCase() === "image";
}

export function blankGenericImageAlt(html: string): string {
  return html.replace(IMG_TAG_RE, (tag) => tag.replace(GENERIC_ALT_RE, '$1""'));
}
