// 運営者（bfmkn）が公開している公式のガイドへのパス。エディタ・マイガイドなどクライアントから使うので非 .server。
// 公開ガイドの URL（/guides/:authorSlug/:guideSlug）をそのまま持つ。ガイドが無い環境（ローカル DB など）では
// リンク先が 404 になるだけで、リンクを置く側は壊れない。

/** ガイドの書き方の手引き（「ガイドのガイド — Minefolioでガイドを書く」） */
export const GUIDE_WRITING_GUIDE_PATH = "/guides/bfmkn/guide-writing-guide";
