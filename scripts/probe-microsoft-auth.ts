// Phase 0 実測スクリプト: Microsoft アカウント連携による MCID 所有確認の成立可否を手元で確かめる。
//
// 目的（docs/research/microsoft-account-linking.md §10 Phase 0）:
//   1. 新規登録した Azure アプリ（consumers テナント）で `XboxLive.signin` の同意画面が通るか
//   2. Xbox Live user token → XSTS（RelyingParty http://xboxlive.com）が 200 を返し、
//      DisplayClaims に gtg / umg（Name#1234）/ xid（XUID）が含まれるか  → Bedrock 検証の成立条件
//   3. （--java 指定時）XSTS（rp://api.minecraftservices.com/）→ login_with_xbox → minecraft/profile が通るか。
//      Mojang の承認が無ければ 403 "Invalid app registration" になるはず       → Java 検証の成立条件
//
// 本番と同じ authorization code + PKCE（S256）の Web フローを使う。device code フローは使わない。
// トークン類はメモリ上でのみ扱い、ファイルにもログにも保存しない（表示は先頭数文字＋長さのみ）。
//
// 事前準備（Azure ポータル）:
//   - アプリの登録 → 「サポートされるアカウントの種類」= Personal Microsoft accounts only（consumers）
//   - 認証 → プラットフォーム「Web」→ リダイレクト URI に `http://localhost:5180/callback` を追加
//     （ポートは --port で変更可。localhost に限り http が許可される）
//   - Web プラットフォームで登録した場合はクライアントシークレットも発行して渡す
//
// 実行:
//   pnpm exec tsx scripts/probe-microsoft-auth.ts --client-id <APP_ID> [--client-secret <SECRET>]
//   pnpm exec tsx scripts/probe-microsoft-auth.ts --java            # Java（Minecraft services）まで試す
//   pnpm exec tsx scripts/probe-microsoft-auth.ts --no-open --port 5181 --verbose
//
//   client ID / secret は環境変数 MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET でも渡せる
//   （.env は dotenv で読み込むが、.env.example には追加していない。アプリ本体はまだこの変数を使わない）。
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { exec } from "node:child_process";
import { config } from "dotenv";

config();

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}
const hasFlag = (name: string) => argv.includes(name);

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`使い方: pnpm exec tsx scripts/probe-microsoft-auth.ts [options]
  --client-id <id>        Azure アプリの Application (client) ID（省略時 MICROSOFT_CLIENT_ID）
  --client-secret <s>     クライアントシークレット（省略時 MICROSOFT_CLIENT_SECRET。public client なら不要）
  --port <n>              コールバックを受ける localhost のポート（既定 5180）
  --java                  XSTS(rp://api.minecraftservices.com/) → Minecraft services まで試す
  --no-open               ブラウザを自動で開かない（URL を表示するだけ）
  --verbose               各ステップのレスポンス JSON をトークンをマスクして表示
  --timeout <sec>         コールバック待ちのタイムアウト秒（既定 300）`);
  process.exit(0);
}

const CLIENT_ID = argValue("--client-id") ?? process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = argValue("--client-secret") ?? process.env.MICROSOFT_CLIENT_SECRET;
const PORT = Number(argValue("--port") ?? 5180);
const TRY_JAVA = hasFlag("--java");
const OPEN_BROWSER = !hasFlag("--no-open");
const VERBOSE = hasFlag("--verbose");
const TIMEOUT_MS = Number(argValue("--timeout") ?? 300) * 1000;

if (!CLIENT_ID) {
  console.error("❌ client ID がありません。--client-id か MICROSOFT_CLIENT_ID を指定してください。");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 定数（docs/research/microsoft-account-linking.md §4）
// ---------------------------------------------------------------------------

const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_USER_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
const MC_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";

// Graph 系スコープ（User.Read 等）とは同居できないので XboxLive.signin 単独
const SCOPE = "XboxLive.signin";

const XERR_MESSAGES: Record<string, string> = {
  "2148916227": "アカウントが Xbox の規約違反で BAN されている",
  "2148916229": "保護者によりオンラインプレイが制限されている",
  "2148916233": "Xbox プロフィール未作成（https://signup.live.com/signup で作成が必要）",
  "2148916234": "Xbox の利用規約に未同意",
  "2148916235": "Xbox Live が許可されていない地域のアカウント",
  "2148916236": "年齢証明が必要（韓国等）",
  "2148916237": "プレイ時間の上限に到達",
  "2148916238": "18歳未満で、大人のファミリーに追加されていない",
};

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

const base64url = (buf: Buffer) => buf.toString("base64url");
const mask = (s: unknown) =>
  typeof s === "string" && s.length > 16 ? `${s.slice(0, 8)}…(${s.length} chars)` : s;

/** トークンらしきキーの値をマスクした JSON 文字列 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        /token|ticket|secret|code|uhs/i.test(k) ? [k, mask(v)] : [k, redact(v)]
      )
    );
  }
  return value;
}
const dump = (label: string, value: unknown) => {
  if (VERBOSE) console.log(`   ${label}:`, JSON.stringify(redact(value), null, 2).replace(/\n/g, "\n   "));
};

interface StepResult {
  ok: boolean;
  status: number;
  ms: number;
  body: unknown;
  text: string;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<StepResult> {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), body: parsed, text };
}

async function getJson(url: string, headers: Record<string, string>): Promise<StepResult> {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), body: parsed, text };
}

function openInBrowser(url: string) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url.replace(/&/g, "^&")}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log("   （ブラウザの自動起動に失敗。上の URL を手で開いてください）");
  });
}

function explainXsts(result: StepResult): string {
  const body = result.body as { XErr?: number; Message?: string; Redirect?: string } | null;
  if (body?.XErr !== undefined) {
    const known = XERR_MESSAGES[String(body.XErr)] ?? "未知の XErr";
    return `XErr ${body.XErr}: ${known}${body.Redirect ? `（Redirect: ${body.Redirect}）` : ""}`;
  }
  return `HTTP ${result.status}${result.text ? ` / ${result.text.slice(0, 200)}` : "（本文なし。RelyingParty 不正等）"}`;
}

const summary: Array<[string, string]> = [];
const record = (item: string, verdict: string) => {
  summary.push([item, verdict]);
  console.log(`   → ${verdict}`);
};

// ---------------------------------------------------------------------------
// Step 1: Microsoft OAuth（authorization code + PKCE）
// ---------------------------------------------------------------------------

async function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error) {
        const desc = url.searchParams.get("error_description") ?? "";
        res.end(`<p>認可に失敗しました: ${error}</p><p>${desc}</p><p>ターミナルに戻ってください。</p>`);
        finish(() => reject(new Error(`authorize エラー: ${error} ${desc}`)));
        return;
      }
      if (!code || state !== expectedState) {
        res.end("<p>state が一致しないか code がありません。ターミナルに戻ってください。</p>");
        finish(() => reject(new Error("state 不一致または code 欠落（CSRF 対策の照合に失敗）")));
        return;
      }
      res.end("<p>認可コードを受け取りました。このタブは閉じて、ターミナルに戻ってください。</p>");
      finish(() => resolve(code));
    });
    const timer = setTimeout(() => finish(() => reject(new Error("コールバック待ちがタイムアウトしました"))), TIMEOUT_MS);
    const finish = (cb: () => void) => {
      clearTimeout(timer);
      server.close();
      cb();
    };
    server.on("error", (err) => finish(() => reject(err)));
    server.listen(PORT, "127.0.0.1");
  });
}

async function run() {
  console.log("=== Phase 0: Microsoft アカウント連携の実測 ===");
  console.log(`client_id: ${CLIENT_ID}  secret: ${CLIENT_SECRET ? "あり" : "なし（public client として交換）"}`);
  console.log(`redirect_uri: ${REDIRECT_URI}  scope: ${SCOPE}  java: ${TRY_JAVA ? "試す" : "試さない"}\n`);

  // PKCE + state
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  console.log("① 同意画面（XboxLive.signin）");
  console.log(`   ブラウザで次の URL を開いてサインインしてください:\n   ${authorizeUrl.toString()}\n`);
  if (OPEN_BROWSER) openInBrowser(authorizeUrl.toString());

  let code: string;
  try {
    code = await waitForCallback(state);
  } catch (err) {
    record("① XboxLive.signin の同意", `❌ ${(err as Error).message}`);
    return;
  }
  record("① XboxLive.signin の同意", "✅ 同意画面を通過し、認可コードを受信");

  // トークン交換
  console.log("\n② 認可コード → Microsoft access token");
  const tokenParams = new URLSearchParams({
    client_id: CLIENT_ID!,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
    scope: SCOPE,
  });
  if (CLIENT_SECRET) tokenParams.set("client_secret", CLIENT_SECRET);
  const t0 = performance.now();
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });
  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  dump("token response", tokenBody);
  if (!tokenRes.ok || !tokenBody.access_token) {
    record(
      "② access token 取得",
      `❌ HTTP ${tokenRes.status} ${tokenBody.error ?? ""}: ${(tokenBody.error_description ?? "").split("\n")[0]}`
    );
    console.log("   ヒント: invalid_client → secret の要否/不一致、AADSTS70011 → scope 不正、redirect_uri mismatch → Azure 側の登録漏れ");
    return;
  }
  record(
    "② access token 取得",
    `✅ ${Math.round(performance.now() - t0)}ms / expires_in=${tokenBody.expires_in}s / scope="${tokenBody.scope ?? "(なし)"}"`
  );

  // ---------------------------------------------------------------------------
  // Step 2: Xbox Live user token（カスタム Azure アプリなので RpsTicket は d= 固定）
  // ---------------------------------------------------------------------------
  console.log("\n③ Xbox Live user token（user.auth.xboxlive.com）");
  const xbl = await postJson(XBL_USER_AUTH_URL, {
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
    Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${tokenBody.access_token}` },
  });
  dump("XBL response", xbl.body);
  const xblBody = xbl.body as { Token?: string; NotAfter?: string; DisplayClaims?: { xui?: Array<{ uhs?: string }> } } | null;
  if (!xbl.ok || !xblBody?.Token) {
    record("③ Xbox Live user token", `❌ ${explainXsts(xbl)}`);
    console.log("   ヒント: 本文なしの 400 は RpsTicket の形（d= プレフィックス）や access token の audience を疑う");
    return;
  }
  record("③ Xbox Live user token", `✅ ${xbl.ms}ms / NotAfter=${xblBody.NotAfter}`);
  const userHash = xblBody.DisplayClaims?.xui?.[0]?.uhs;

  // ---------------------------------------------------------------------------
  // Step 3: XSTS（RelyingParty http://xboxlive.com）→ Bedrock 検証に必要なクレーム
  // ---------------------------------------------------------------------------
  console.log("\n④ XSTS（RelyingParty http://xboxlive.com）→ gtg / umg / xid");
  const xsts = await postJson(XSTS_URL, {
    RelyingParty: "http://xboxlive.com",
    TokenType: "JWT",
    Properties: {
      SandboxId: "RETAIL",
      UserTokens: [xblBody.Token],
      OptionalDisplayClaims: ["gtg", "xid", "mgt", "umg", "mgs"],
    },
  });
  dump("XSTS response", xsts.body);
  const xstsBody = xsts.body as
    | { Token?: string; NotAfter?: string; DisplayClaims?: { xui?: Array<Record<string, string>> } }
    | null;
  if (!xsts.ok || !xstsBody?.Token) {
    record("④ XSTS (xboxlive.com)", `❌ ${explainXsts(xsts)}`);
    return;
  }
  const claims = xstsBody.DisplayClaims?.xui?.[0] ?? {};
  console.log("   DisplayClaims.xui[0]:");
  for (const key of ["gtg", "mgt", "umg", "mgs", "xid", "agg", "uhs"]) {
    console.log(`     ${key.padEnd(4)} = ${key === "uhs" ? mask(claims[key]) : (claims[key] ?? "(なし)")}`);
  }
  const bedrockOk = Boolean(claims.xid && (claims.gtg || claims.umg));
  record(
    "④ XSTS (xboxlive.com)",
    bedrockOk
      ? `✅ ${xsts.ms}ms / XUID と ゲーマータグを取得（umg ${claims.umg ? "あり" : "なし"}）→ Bedrock 検証は成立`
      : `⚠️ ${xsts.ms}ms / 200 だが xid かゲーマータグが欠けている`
  );

  // ---------------------------------------------------------------------------
  // Step 4（任意）: Java — XSTS(rp://api.minecraftservices.com/) → Minecraft services
  // ---------------------------------------------------------------------------
  if (!TRY_JAVA) {
    console.log("\n⑤ Java（Minecraft services）は --java 未指定のためスキップ");
  } else {
    console.log("\n⑤ XSTS（RelyingParty rp://api.minecraftservices.com/）");
    const xstsMc = await postJson(XSTS_URL, {
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
      Properties: { SandboxId: "RETAIL", UserTokens: [xblBody.Token] },
    });
    dump("XSTS(mc) response", xstsMc.body);
    const xstsMcBody = xstsMc.body as { Token?: string; DisplayClaims?: { xui?: Array<{ uhs?: string }> } } | null;
    if (!xstsMc.ok || !xstsMcBody?.Token) {
      record("⑤ XSTS (minecraftservices)", `❌ ${explainXsts(xstsMc)}`);
    } else {
      record("⑤ XSTS (minecraftservices)", `✅ ${xstsMc.ms}ms`);
      const uhs = xstsMcBody.DisplayClaims?.xui?.[0]?.uhs ?? userHash;

      console.log("\n⑥ login_with_xbox（api.minecraftservices.com）");
      const login = await postJson(MC_LOGIN_URL, { identityToken: `XBL3.0 x=${uhs};${xstsMcBody.Token}` });
      dump("login_with_xbox response", login.body);
      const loginBody = login.body as { access_token?: string; expires_in?: number; error?: string; errorMessage?: string } | null;
      if (login.status === 403) {
        record(
          "⑥ login_with_xbox",
          `❌ 403 — Mojang のアプリ承認が未取得と判断（${login.text.slice(0, 120) || "Invalid app registration"}）。aka.ms/mce-reviewappid で申請`
        );
      } else if (!login.ok || !loginBody?.access_token) {
        record("⑥ login_with_xbox", `❌ HTTP ${login.status} ${login.text.slice(0, 200)}`);
      } else {
        record("⑥ login_with_xbox", `✅ ${login.ms}ms / expires_in=${loginBody.expires_in}s → 承認済みアプリとして動作`);
        const auth = { Authorization: `Bearer ${loginBody.access_token}` };

        console.log("\n⑦ minecraft/profile");
        const profile = await getJson(MC_PROFILE_URL, auth);
        dump("profile response", profile.body);
        const profileBody = profile.body as { id?: string; name?: string; error?: string } | null;
        if (profile.ok && profileBody?.id) {
          record("⑦ minecraft/profile", `✅ ${profile.ms}ms / name=${profileBody.name} uuid=${profileBody.id}`);
        } else if (profile.status === 404) {
          record("⑦ minecraft/profile", "⚠️ 404 NOT_FOUND — Java 未所有、または Game Pass でプロフィール未作成（下の entitlements を参照）");
        } else {
          record("⑦ minecraft/profile", `❌ HTTP ${profile.status} ${profile.text.slice(0, 200)}`);
        }

        console.log("\n⑧ entitlements/mcstore（参考: Game Pass 判定用）");
        const ent = await getJson(MC_ENTITLEMENTS_URL, auth);
        dump("entitlements response", ent.body);
        const items = (ent.body as { items?: Array<{ name?: string }> } | null)?.items ?? [];
        record(
          "⑧ entitlements/mcstore",
          ent.ok ? `✅ ${ent.ms}ms / items=[${items.map((i) => i.name).join(", ") || "なし"}]` : `❌ HTTP ${ent.status}`
        );
      }
    }
  }

}

// ---------------------------------------------------------------------------
// まとめ（途中で打ち切った場合もここまでの判定を表示する）
// ---------------------------------------------------------------------------
function printSummary() {
  console.log("\n=== 結果 ===");
  for (const [item, verdict] of summary) console.log(`${item.padEnd(28)} ${verdict}`);
  console.log(
    "\n判定の読み方: ①〜④ がすべて ✅ なら Bedrock 検証（Phase 1）は着手可能。⑥ が 403 なら Java（Phase 2）は承認待ち。"
  );
  console.log("トークンはこのプロセスのメモリ上にしか存在せず、どこにも保存していません。");
}

run()
  .catch((err) => {
    console.error("❌ 予期しないエラー:", err);
    process.exitCode = 1;
  })
  .finally(printSummary);
