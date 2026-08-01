// ログイン前にいたページへ戻る（returnTo）ための共通ユーティリティ（クライアント/サーバー共用）。
//
// returnTo はクエリ文字列など外部入力から来る値なので、ここを通さずに redirect() /
// <Link to> に流さない。オープンリダイレクト対策として同一オリジンの相対パスのみ許可し、
// ループ・無意味な遷移になる /login・/dev/login・/onboarding・/api/* は既定へフォールバックさせる。

const BLOCKED_PREFIXES = ["/login", "/dev/login", "/onboarding", "/api/"];

// 改行・タブ等の制御文字（コードポイント 0x1f 以下）を含むか。
// ヘッダインジェクション対策も兼ねる。正規表現の制御文字エスケープは編集ツール経由で
// 文字化けしやすいため、charCodeAt による走査で判定する。
function containsControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 0x1f) {
      return true;
    }
  }
  return false;
}

/**
 * returnTo 値を検証し、redirect() / <Link to> にそのまま渡せる同一オリジンの相対パス
 * （pathname + search + hash）を返す。不正・欠落時は null（呼び出し側は既定の遷移先へ
 * フォールバックする）。
 */
export function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (containsControlChar(value)) {
    return null;
  }

  // "/" 単独始まりのみ許可。"//evil.com"（プロトコル相対）・"/\evil.com"
  // （バックスラッシュ経由でブラウザがプロトコル相対として解釈しうる）は他オリジンへ
  // 飛ぶ可能性があるため拒否
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }

  // ダミーオリジンを基準に相対URLとしてパースし、オリジンが変わっていないか最終確認する
  let path: string;
  try {
    const url = new URL(value, "http://minefolio.invalid");
    if (url.origin !== "http://minefolio.invalid") {
      return null;
    }
    path = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }

  const lowerPath = path.toLowerCase();
  const isBlocked = BLOCKED_PREFIXES.some((prefix) => {
    // "/api/" のように末尾が "/" のプレフィックスは配下すべてを丸ごとブロックする
    if (prefix.endsWith("/")) {
      return lowerPath.startsWith(prefix);
    }
    return (
      lowerPath === prefix ||
      lowerPath.startsWith(`${prefix}/`) ||
      lowerPath.startsWith(`${prefix}?`) ||
      lowerPath.startsWith(`${prefix}#`)
    );
  });
  if (isBlocked) {
    return null;
  }

  return path;
}

// better-auth はソーシャルログインの callbackURL（相対パス）を
// `^/(?!/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$` で検証する
// （node_modules/better-auth/dist/auth/trusted-origins.mjs）。
// encodeURIComponent は「! ~ * ' ( )」をエスケープせずに残すため、そのままでは
// 上記の許可文字集合からはみ出しうる。callbackURL に埋め込む場合のみ、この6文字を
// 追加でパーセントエンコードする。
const CALLBACK_UNSAFE_CHARS = ["!", "'", "(", ")", "*", "~"];

/**
 * signIn.social({ callbackURL }) に埋め込むための returnTo エンコード。
 * 通常の redirect() / <Link to> のクエリ組み立てには使わず、単純に encodeURIComponent を使う。
 */
export function encodeReturnToForCallback(returnTo: string): string {
  let encoded = encodeURIComponent(returnTo);
  for (const char of CALLBACK_UNSAFE_CHARS) {
    encoded = encoded.split(char).join(`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  return encoded;
}
