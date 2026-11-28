// 明らかなボットの探り（存在しないパスへの総当たり）を、DB にも SSR にも行かずに素の 404 で返すための判定。
// 誤判定で正規のページを壊さないことを最優先にし、`app/routes.ts` の実在ルート（拡張子なし・先頭ドットなし）、
// `public/` の静的ファイル、`/.well-known/*`、`/api/*`、`.data`（React Router の single fetch）、`/__manifest` と
// 衝突しうるパターンは入れない。人の打ち間違い（/playerz/foo 等）は対象外で、従来どおりロケール付きの 404 ページに行く。

// サーバー側スクリプト・設定・バックアップ・VCS を指す拡張子（末尾）
const PROBE_EXTENSION = /\.(?:php\d?|phtml|asp|aspx|jsp|jspx|cgi|env|ini|sql|bak|old|orig|swp|git|svn|htaccess|htpasswd)$/;

// 先頭セグメントが次で始まるパス（CMS・管理ツール・周辺製品の定番の探り先）
const PROBE_PREFIXES = [
  "wp-",
  "wordpress",
  "wp",
  "xmlrpc",
  "cgi-bin",
  "phpmyadmin",
  "phpunit",
  "vendor",
  "node_modules",
  "actuator",
  "boaform",
  "autodiscover",
];

export function isBotProbePath(pathname: string): boolean {
  let path = pathname.toLowerCase();
  // single fetch の `.data` は、元のパスで判定する
  if (path.endsWith(".data")) path = path.slice(0, -".data".length);
  // API は別の基準（認証・各ハンドラ）で扱う
  if (path === "/api" || path.startsWith("/api/")) return false;

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return false;

  // ドット始まりのセグメント（/.env /.git/config /.aws/credentials 等）。`.well-known` は正規なので除く
  if (segments.some((s) => s.startsWith(".") && s !== ".well-known")) return true;

  const last = segments[segments.length - 1];
  if (PROBE_EXTENSION.test(last)) return true;

  const first = segments[0];
  return PROBE_PREFIXES.some((p) => (p === "wp-" ? first.startsWith(p) : first === p || first.startsWith(`${p}-`) || first.startsWith(`${p}.`)));
}

export const BOT_PROBE_RESPONSE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
} as const;

export function botProbeResponse(): Response {
  return new Response("Not Found", { status: 404, headers: BOT_PROBE_RESPONSE_HEADERS });
}
