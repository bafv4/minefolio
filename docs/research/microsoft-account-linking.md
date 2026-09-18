# 調査: Microsoft アカウント連携による MCID 所有確認

- 調査日: 2026-09-18
- 対象リポジトリ状態: `dev` ブランチ / `better-auth 1.6.27` / `@better-auth/core 1.6.27`（`package.json`）
- 種別: **調査メモ（実装前の判断材料）**。仕様確定ドキュメントではない。

---

## 1. 結論サマリ

| 項目 | 判定 |
|---|---|
| Bedrock（Xbox ゲーマータグ + XUID）の所有確認 | **技術的に成立する見込みが高い。** `api.minecraftservices.com` を一切使わず、Microsoft OAuth → Xbox Live → XSTS の3段だけで `gtg` / `mgt` / `umg`（`Name#1234`）/ `xid` が取れる。**Mojang のアプリ承認は不要** |
| Java（Mojang UUID）の所有確認 | **成立するが、Mojang/Microsoft のアプリ承認が必須で、承認取得の見通しが立たない。** 2026-08〜09 の公開報告では承認ルートが機能していない疑いがある（後述 §3） |
| 最大の障壁 | **Azure アプリに `XboxLive.signin` を使わせてもらえるか**。承認なしだと Minecraft 側が 403（`Invalid app registration`）。さらに 2026 年時点では「Xbox Developer Program / ID@Xbox 登録が前提」とする回答もあり、**個人運営の非公式ファンサイトが承認を得られるかは未確認** |
| 工数感（承認が取れた前提） | 実装そのものは中規模。サーバー側トークン交換 ~250行 + ルート2本 + スキーマ3〜4列 + `/me/edit` UI + 文言。**難所はコード量ではなく、(a) 承認取得、(b) 既存 `set_mcid` の横取り／本人優先ロジックの再設計、(c) ポリシー改定** |
| better-auth を使うか | **使わず自前ルートを推奨**（§6）。better-auth 経由だと `accountLinking.allowDifferentEmails: true` というグローバル設定が必要になり、Discord ログイン全体のセキュリティ姿勢に影響する |

**先に出せる範囲**: Bedrock 検証のみを先行リリースし、Java は承認が下りたら同じトークン交換の末尾2ステップを足すだけで切り替えられる（§10）。

---

## 2. Azure アプリ登録

### 2.1 サポートされるアカウント種別（consumers 必須）

`XboxLive.signin` は **consumers（Personal Microsoft accounts only）テナントでしか通らない**。`common` や AAD テナント ID を使うとエラーになり、AAD テナント内のユーザーではサインインできない。

- 根拠: [Microsoft authentication – Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication) — 「You **must** use the `consumers` AAD tenant to sign in with the `XboxLive.signin` scope」
- 実装上の裏付け: PrismarineJS/prismarine-auth の MSAL 設定が `authority: 'https://login.microsoftonline.com/consumers'` 固定（[Constants.js](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/common/Constants.js)）

Azure ポータルでの「サポートされるアカウントの種類」は **"Personal Microsoft accounts only"** を選ぶ（[XboxReplay/xboxlive-auth 02-Custom_Azure_Application.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/02-Custom_Azure_Application.md)）。

### 2.2 リダイレクト URI

同ドキュメントより（プラットフォーム種別「Web」）:

- 本番 Web アプリ: 自分の **HTTPS** コールバック URL（例 `https://yourdomain.com/auth/callback`）
- デスクトップ/Electron: `https://login.live.com/oauth20_desktop.srf`
- 開発時: `http://localhost:3000/callback` は **localhost に限り HTTP 可**

→ Minefolio では `https://<APP_URL>/api/link/microsoft/callback` と、ローカル用に `http://localhost:5173/api/link/microsoft/callback` を両方登録する構成になる。

### 2.3 スコープ

- **必須**: `XboxLive.signin`
- **`offline_access`**: refresh token が要る場合のみ。login.live.com（v1）系のサンプルでは `XboxLive.offline_access` という表記も使われる
- Minefolio の用途（連携のたびにユーザー操作で再認証、トークンは保存しない）なら **`offline_access` は不要**。データ最小化の観点でも外すべき（§8）

**重要な制約**: `XboxLive.signin` と Microsoft Graph 系スコープ（`User.Read` 等）は **同一トークンリクエストに混在できない**。Microsoft の公式回答いわく、Xbox Live と Graph は audience が異なるリソースで、identity platform は1リクエストにつき1 audience のトークンしか発行しない。認可コードは1回の交換で無効化されるため、2つ目の audience を後から取ることもできない。

- 根拠: [OAuth2 workflow with XboxLive and OpenID – Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1112356/oauth2-workflow-with-xboxlive-and-openid)
- 関連: [Azure AD Scope "User.Read" not compatible "XboxLive.Signin" – Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1462791/azure-ad-scope-user-read-not-compatible-xboxlive-s)

> `openid` / `profile` / `email` は「リソーススコープ」ではなく OIDC スコープなので、`openid XboxLive.signin` の同時要求で **id_token + Xbox audience の access_token** が返る、という報告はある（上記 Q&A の質問者自身の観測）。ただし Microsoft は「id_token のフォーマットに依存するな」と回答している。**Minefolio は Microsoft 側の氏名・メールを必要としないので、`XboxLive.signin` 単独にするのが最も安全かつ最小**。

### 2.4 クライアントシークレット・PKCE

- minecraft.wiki は「You will _not_ need to obtain a client secret」と明記（public client 前提）
- 一方、Web プラットフォーム（confidential client）で登録してサーバー側でコード交換するなら **client secret を使える**。実例: [groundsgg/keycloak-minecraft-idp](https://github.com/groundsgg/keycloak-minecraft-idp) は Web リダイレクト URI + client secret（`client_secret_post`）で運用している
- **シークレットの有効期限**: Azure ポータルのクライアントシークレットは最大 24 か月。→ **失効時の再発行を運用手順に含める必要がある**（※一般的な Azure の仕様として記述。今回一次情報で再確認していない — **未確認**）
- **PKCE**: confidential client でも付けるべき。`login.microsoftonline.com/consumers/oauth2/v2.0/authorize` は `code_challenge` / `code_challenge_method=S256` に対応（[v2 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)）。better-auth の実装も `codeVerifier` があれば S256 を自動付与する（`@better-auth/core/src/oauth2/create-authorization-url.ts` L63-66）

---

## 3. Mojang の利用承認（最重要・最大の不確実性）

### 3.1 現状

- **2022 年以降、`api.minecraftservices.com` を叩く Azure アプリは個別承認が必要**。未承認だと 403。それ以前に作られたアプリは動き続ける（[Microsoft authentication – Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication)）
- 申請フォーム: **`https://aka.ms/mce-reviewappid`**
  - 2026-09-18 時点で **リンクは生きている**（`301 → https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=v4j5cvGGr0GRqy180BHbR-ajEQ1td1ROpz00KtS8Gd5UNVpPTkVLNFVROVQxNkdRMEtXVjNQQjdXVC4u`、最終 200 OK。curl で確認）
  - 記入項目は Microsoft Forms の JS レンダリングのため今回は取得できなかった（**未確認**）。二次情報では「Client ID と Tenant ID を提出」「承認後の反映に最大 24 時間」「所要は数日」との記述がある
- 403 のエラー文言: **`Invalid app registration`** ＋ 参照先 `https://aka.ms/AppRegInfo`
  - `aka.ms/AppRegInfo` は 2026-09-18 時点で `https://help.minecraft.net/hc/en-us/articles/16254801392141` へ 301（本文はクライアント描画のため取得できず。**未確認**）

### 3.2 2023〜2026 の時系列（公開情報ベース）

| 時期 | 事象 | 出典 |
|---|---|---|
| 2022〜 | 新規 Azure アプリは Minecraft API 利用に個別承認が必要になる。旧アプリは継続動作 | [Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication) |
| 〜2025 | `aka.ms/mce-reviewappid` に Client ID を出せば「数日」で承認、という報告が多い | 各種ランチャープロジェクトの README（二次情報） |
| 2026-02-09 | 個人ランチャー開発者が 403 `Invalid app registration` を報告。回答は「**Xbox Developer Program（小規模は ID@Xbox）への登録が必要**。趣味プロジェクト向けのセルフサービス承認は無い」 | [How to get XboxLive.signin permission for Azure App Registration – Microsoft Q&A](https://learn.microsoft.com/en-gb/answers/questions/5768276/how-to-get-xboxlive-signin-permission-for-azure-ap) ※回答者は Microsoft Student Ambassador で、公式見解とは限らない |
| 2026-08-30 | 別の開発者が同じ 403 を報告し「どのチームが管轄か / `aka.ms/AppRegInfo` はまだ有効か / Client ID はどこに出せばいいか」を質問。**2026-09-05 時点で未回答**、同症状の第三者コメントのみ | [Minecraft Services returns HTTP 403 "Invalid app registration" – Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5989335/minecraft-services-returns-http-403-invalid-app-re) |

### 3.3 評価

**「承認は現在も必要」は確実。「承認が取れるか」は現在きわめて不透明。**
フォーム URL 自体は生きているので申請は可能だが、2026 年に入ってからの公開事例で「承認された」という報告は今回の調査では見つからなかった。**Java 側の機能はこの承認に完全依存するため、申請を先に出し、結果が出るまで実装をブロックしない設計（Bedrock 先行）にすべき**。

### 3.4 承認が不要になる／緩和される条件

- **Xbox Live（`user.auth.xboxlive.com` / `xsts.auth.xboxlive.com`）だけを使い、`api.minecraftservices.com` に触れなければ Mojang 承認は不要**。これが Bedrock 先行案の根拠（§5）
- よく見かける回避策として、Microsoft 自身の既承認クライアント ID を借用する手法がある（例: prismarine-auth の既定 `389b1b32-b5d5-43b2-bddc-84ce938d6737`、公式ランチャーの `000000004C12AE6F`）。**Minefolio では採用すべきでない** — 他社アプリへの成りすましであり、利用規約 §6「NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT」を掲げる非公式サイトの立場と矛盾する。XboxReplay のドキュメント自身も「この認証プロセスは技術的には承認済み Microsoft パートナー向けであり、ユーザーのプライバシーを損なう可能性がある」と警告している（[02-Custom_Azure_Application.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/02-Custom_Azure_Application.md)）

---

## 4. トークン交換の詳細

### Step 1. Microsoft OAuth（認可コード → access token）

**どちらのエンドポイントを使うか**

| | login.live.com（v1） | login.microsoftonline.com/consumers（v2） |
|---|---|---|
| authorize | `https://login.live.com/oauth20_authorize.srf` | `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` |
| token | `https://login.live.com/oauth20_token.srf` | `https://login.microsoftonline.com/consumers/oauth2/v2.0/token` |
| PKCE | 非推奨/不安定 | 対応 |
| 採用例 | [xboxlive-auth live/config.ts](https://github.com/XboxReplay/xboxlive-auth/blob/master/src/shared/libs/live/config.ts)、minecraft.wiki のサンプル | [prismarine-auth msalConfig](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/common/Constants.js)、better-auth の microsoft プロバイダ |

**推奨: v2（`login.microsoftonline.com/consumers/oauth2/v2.0/*`）**。PKCE・標準 OAuth パラメータ・エラーレスポンスが整っており、better-auth の microsoft プロバイダもこの形で URL を組む（`@better-auth/core/src/social-providers/microsoft-entra-id.ts` L163-164）。

authorize リクエスト例:

```
GET https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize
  ?client_id=<APP_ID>
  &response_type=code
  &redirect_uri=https%3A%2F%2Fminefolio.example%2Fapi%2Flink%2Fmicrosoft%2Fcallback
  &scope=XboxLive.signin
  &state=<HMAC付き state>
  &code_challenge=<S256>
  &code_challenge_method=S256
  &prompt=select_account
```

token レスポンス（v1 の例。v2 も同形）:

```json
{
  "token_type": "bearer",
  "expires_in": 3600,
  "access_token": "EwAIA+pvBAAUK...",
  "refresh_token": "M.R3_BAY...",
  "scope": "service::user.auth.xboxlive.com::MBI_SSL XboxLive.signin XboxLive.offline_access",
  "user_id": "123abc..."
}
```

出典: [xboxlive-auth 02-Custom_Azure_Application.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/02-Custom_Azure_Application.md)

代表的なエラー: `AADSTS70011`（scope 不正 — Graph と混在させた場合など）、`invalid_client`（client_id / secret 不一致）、`redirect_uri mismatch`。

### Step 2. Xbox Live user token

```
POST https://user.auth.xboxlive.com/user/authenticate
Content-Type: application/json
Accept: application/json

{
  "RelyingParty": "http://auth.xboxlive.com",
  "TokenType": "JWT",
  "Properties": {
    "AuthMethod": "RPS",
    "SiteName": "user.auth.xboxlive.com",
    "RpsTicket": "d=<access token>"
  }
}
```

レスポンス:

```json
{
  "IssueInstant": "2025-01-14T18:55:20.0082007Z",
  "NotAfter": "2025-01-15T10:55:20.0082007Z",
  "Token": "eyJ...",
  "DisplayClaims": { "xui": [ { "uhs": "3218841136841218711" } ] }
}
```

**`d=` プレフィックスのルール（確定）** — prismarine-auth の実装が最も明確:

```js
// src/TokenManagers/XboxTokenManager.js L63-73
async getUserToken (accessToken, azure) {
  const preamble = azure ? 'd=' : 't='
  ...  RpsTicket: `${preamble}${accessToken}`
```

- `d=` … **カスタム Azure アプリ**の OAuth access token
- `t=` … 旧来の資格情報フロー（`service::user.auth.xboxlive.com::MBI_SSL`）で得た RPS チケット

出典: [prismarine-auth XboxTokenManager.js](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/TokenManagers/XboxTokenManager.js)、[xboxlive-auth 02-Custom_Azure_Application.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/02-Custom_Azure_Application.md)（`exchangeRpsTicketForUserToken(token, 'd')` — "Required for custom Azure applications"）。

→ **Minefolio はカスタム Azure アプリなので `d=` 固定**。

### Step 3. XSTS

```
POST https://xsts.auth.xboxlive.com/xsts/authorize
Content-Type: application/json
Accept: application/json

{
  "RelyingParty": "http://xboxlive.com",
  "TokenType": "JWT",
  "Properties": {
    "SandboxId": "RETAIL",
    "UserTokens": ["<Step2 の Token>"],
    "OptionalDisplayClaims": ["gtg", "xid", "mgt", "umg", "mgs"]
  }
}
```

出典（リクエスト形・`OptionalDisplayClaims` の位置）: [xboxlive-auth requests/index.ts](https://github.com/XboxReplay/xboxlive-auth/blob/master/src/shared/libs/xbox-network/modules/requests/index.ts)

**RelyingParty による DisplayClaims の違い（重要）**

| RelyingParty | 返る `DisplayClaims.xui[0]` | 用途 |
|---|---|---|
| `http://auth.xboxlive.com`（Step2） | `uhs` のみ | — |
| **`http://xboxlive.com`** | `gtg`, `xid`, `uhs`, `agg`, `usr`, `utr`, `prv`（+ optional で `mgt`, `umg`, `mgs`） | **Bedrock 検証はこれだけで足りる** |
| `rp://api.minecraftservices.com/` | `uhs` のみ | Java（Minecraft services 用） |
| `http://accounts.xboxlive.com` | `agg`（年齢グループ）。`xid` は null になりうる | 年齢判定 |

クレームの意味（[xboxlive-auth 04-RelyingParty.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/04-RelyingParty.md)）:

| Claim | 内容 | 例 |
|---|---|---|
| `gtg` | Gamertag（レガシー表記） | `"Zeny IC"` |
| `mgt` | Modern Gamertag | `"ZenyIC"` |
| **`umg`** | **Unique Modern Gamertag（新形式）** | **`"ZenyIC#1234"`** |
| `mgs` | Modern Gamertag Suffix | `"1234"` |
| `xid` | **XUID（Xbox User ID、恒久 ID）** | `"2584878536129841"` |
| `uhs` | User Hash（`XBL3.0 x=<uhs>;<token>` 用） | `"3218841136841218711"` |
| `agg` | Age Group | `"Adult"` / `"Teen"` / `"Child"` |

**XErr コード（401 時）** — prismarine-auth `Constants.js` の `xboxLiveErrors` が最も網羅的:

| XErr | 意味 |
|---|---|
| 2148916227 | アカウントが Xbox の規約違反で BAN |
| 2148916229 | 保護者によりオンラインプレイが制限されている |
| **2148916233** | **Xbox プロフィール未作成**（`https://signup.live.com/signup` で作成が必要） |
| 2148916234 | Xbox の利用規約に未同意 |
| **2148916235** | **Xbox Live が許可されていない地域**のアカウント |
| 2148916236 / 2148916237 | 年齢証明が必要（韓国等）／プレイ時間上限に到達 |
| **2148916238** | **18歳未満**。大人のファミリーに追加されていないと進めない |
| 2148916262 | 稀。詳細不明（minecraft.wiki 記載） |

エラーレスポンスは `{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}` の形（minecraft.wiki）。一方 RelyingParty 不正などは **本文が空の 400** で返ることがある（[xboxlive-auth 09-Errors.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/09-Errors.md) のスタックトレース例）。

### Step 4. Minecraft services（Java のみ。承認必須）

```
POST https://api.minecraftservices.com/authentication/login_with_xbox
{ "identityToken": "XBL3.0 x=<uhs>;<xsts_token>" }
→ { "access_token": "<MC JWT>", "expires_in": 86400, "token_type": "Bearer" }

GET https://api.minecraftservices.com/minecraft/profile
Authorization: Bearer <MC access token>
→ { "id": "<UUID(ハイフンなし)>", "name": "<MCID>", "skins": [...], "capes": [...] }
```

- **`entitlements/mcstore` は Java 所有判定に必須ではない**。`minecraft/profile` が 200 を返した時点で Java プロフィール（UUID + 名前）が存在する＝所有している。未所有だと `{"path":"/minecraft/profile","error":"NOT_FOUND",...}`
- ただし **Game Pass ユーザーは例外**: 「Game Pass 有効化後に一度公式ランチャーでログインしないとプロフィールが作られない」。この場合 `entitlements/mcstore` には `product_game_pass_pc` / `product_game_pass_ultimate` が入るが `minecraft/profile` は 404 → **「所有はしているがプロフィール未作成」という専用エラー文言が要る**
- keycloak-minecraft-idp も同じ分岐を持ち、`/entitlements/license` で所有を見てから `/minecraft/profile` を取る（[README](https://github.com/groundsgg/keycloak-minecraft-idp)）

出典: [Microsoft authentication – Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication)

### トークン有効期限とレート制限

| トークン | 有効期限 | 出典 |
|---|---|---|
| Microsoft access token | 3600 秒（1時間） | xboxlive-auth のレスポンス例 |
| Xbox Live user token | レスポンス例は約16時間（`IssueInstant`→`NotAfter`）。[gapple](https://mojang-api-docs.gapple.pw/authentication/msa) は「約14日」と記載し**食い違う** → **実装では常に `NotAfter` を読む** |
| XSTS token | `NotAfter` 参照 | xboxlive-auth レスポンス例 |
| Minecraft access token | 86400 秒（24時間） | minecraft.wiki |

**レート制限は公開ドキュメントに明記がない（未確認）**。

**refresh token を保存しなくてよいか → 保存しなくてよい。**
Minefolio の用途は「連携ボタンを押した瞬間に1回だけ所有を確認し、結果（UUID / XUID / ゲーマータグ + 検証日時）を DB に書く」もの。継続的に Minecraft API を叩く必要がないため、`offline_access` を要求せず、refresh token も access token も**一切保存しない**設計が成立する。データ最小化（`general.md` のポリシー準拠節）にも合致する。再検証が必要になったらユーザーに再度ボタンを押してもらえばよい。

---

## 5. Bedrock 側の所有確認

### 5.1 Mojang 承認なしで成立するか → **成立する見込みが高い**

- ゲーマータグ（`gtg` / 新形式は `umg` = `Name#1234`）と XUID（`xid`）は **XSTS（RelyingParty `http://xboxlive.com`）の `DisplayClaims` だけで取得できる**（§4 Step 3）。`api.minecraftservices.com` には一切アクセスしない＝**Mojang のアプリ承認は関係しない**
- 「Bedrock を所有しているか」までは XSTS では判定できない（`entitlements/mcstore` の `product_minecraft_bedrock` が必要で、これは承認が要る）。ただし **Minefolio が確認したいのは「そのゲーマータグが本人のものか」であって「Bedrock を買っているか」ではない**ため、XSTS だけで目的を達する
- 残る不確実性: **`XboxLive.signin` の同意が Azure 側で通るか**（§3.2 の 2026-02 の回答が「Xbox Developer Program 登録が前提」としている）。実際に Azure アプリを作って試すまで確定できない。**最初にやるべき検証はこれ**

### 5.2 Bedrock 専用のプロフィール API は不要

`profile.xboxlive.com` 等の XSAPI を叩けばアバター等も取れるが、ゲーマータグと XUID だけなら XSTS の DisplayClaims で十分。**追加の外部送信先を増やさない**意味でも叩かないほうがよい。

### 5.3 恒久 ID は XUID を保存すべき

- ゲーマータグは**変更可能**。表示用の文字列だけ保存すると改名で追従できなくなる
- **`xid`（XUID）を恒久 ID として保存し、`bedrockMcid` は表示用のスナップショットとして扱う**のが正しい
- keycloak-minecraft-idp はさらに進んで「`uhs` は将来のトークンで安定する保証がない」ため、パートナー RelyingParty から得られる **`ptx`（Partner XUID / pXUID）** をアカウント紐付けの推奨識別子としている（[README](https://github.com/groundsgg/keycloak-minecraft-idp)）。`ptx` はパートナー RelyingParty が必要で一般の Azure アプリでは使えない見込み。**Minefolio は `xid` で十分**（`uhs` は保存しない）

---

## 6. better-auth での実装方式

### 6.1 組み込み `microsoft` プロバイダの実態（1.6.27 の実ソースを確認）

`@better-auth/core/src/social-providers/microsoft-entra-id.ts` を実際に読んだ結果:

- **`tenantId: "consumers"` は明示的にサポートされている**。`verifyIdToken` に consumer テナント固定 ID `9188040d-6c67-4c5b-b112-36a304b66dad` との照合ロジックが入っており、`tenant === "consumers"` なら `tid` がそれと一致しない ID トークンを弾く（L21, L272-274）
- エンドポイントは `${authority}/${tenant}/oauth2/v2.0/{authorize,token}`（L163-164）＝ v2/consumers を組める
- **既定スコープが問題**: `["openid", "profile", "email", "User.Read", "offline_access"]`（L180）。**`User.Read` は Graph audience なので `XboxLive.signin` と混在できない**（§2.3）→ **`disableDefaultScope: true` が必須**で、そのうえで `scope: ["XboxLive.signin"]` を指定する
- `disableDefaultScope` / `scope` / `prompt` / `getUserInfo` / `mapProfileToUser` はいずれも `ProviderOptions` に存在（`oauth2/oauth-provider.ts` L99/L124/L214/L237）
- `getUserInfo` は **`token.idToken` が無いと `null` を返す**（L286-288）→ `openid` を外すとリンクが `unable_to_get_user_info` で失敗する。回避には `getUserInfo` を独自実装で差し替えるか `openid` を残す必要がある
- `getUserInfo` は既定で `https://graph.microsoft.com/v1.0/me/photos/...` を叩く（L291-296）。Xbox audience のトークンでは必ず失敗する（`response.ok` チェックで握り潰されるが**無駄な外部送信**）→ `disableProfilePhoto: true` が必要

### 6.2 `linkSocial` で既存 Discord ユーザーに追加連携できるか

`better-auth/dist/api/routes/account.d.mts` に `linkSocialAccount`（`POST /link-social`）があり、`provider` / `callbackURL` / `scopes` / `idToken` / `errorCallbackURL` / `disableRedirect` / `requestSignUp` を受ける。

ただし `better-auth/dist/api/routes/callback.mjs` の実装（L97-105）に**2つのゲート**がある:

```js
if (link) {
  if (!c.context.trustedProviders.includes(provider.id) && !userInfo.emailVerified
      || c.context.options.account?.accountLinking?.enabled === false) {
    redirectOnError(c, resolvedErrorURL, "unable_to_link_account");
  }
  if (userInfo.email?.toLowerCase() !== link.email.toLowerCase()
      && c.context.options.account?.accountLinking?.allowDifferentEmails !== true)
    redirectOnError(c, resolvedErrorURL, "email_doesn't_match");
```

→ Microsoft を Discord ユーザーにリンクするには、

1. `accountLinking.trustedProviders: ["microsoft"]`（microsoft プロバイダは `email_verified` オプショナルクレームを Azure 側で設定しない限り `emailVerified: false` を返すため、実質必須）
2. **`accountLinking.allowDifferentEmails: true`**（Discord のメールと Microsoft のメールは通常一致しない）

が必要。**(2) はプロバイダ単位ではなくグローバル設定**であり、Discord の暗黙リンクにも効く。現状 Minefolio（`app/lib/auth.ts`）はこの緩和を入れていないので、**導入するとログイン全体のセキュリティ姿勢が変わる**。

### 6.3 access token をサーバー側で取り出す方法（3通り）

| 方法 | 内容 | 評価 |
|---|---|---|
| `auth.api.getAccessToken({ body: { accountId }, headers })` | 公式 API。期限切れは自動リフレッシュ（[docs](https://www.better-auth.com/docs/concepts/oauth)） | `accountId` を先に `listAccounts` か DB から引く必要。リフレッシュ時に `options.scope` を含む scope を再送する（provider L342-361） |
| `databaseHooks.account.create.after` / `update.after` | 1.6.27 に存在（`types/init-options.ts` L1417-1466、`(account, context) => Promise<void>`）。リンク直後に生トークンで Xbox 交換を走らせる | 「1回だけ使って捨てる」用途に最も素直。ただしリダイレクト前に4段の外部呼び出しをすることになる |
| `auth_accounts` を Drizzle で直読み | `providerId = "microsoft"` の行の `accessToken` | `account.encryptOAuthTokens` が有効だと復号が必要（既定 off。`oauth2/utils.mjs` L21-28） |

### 6.4 自前ルート（`/api/link/microsoft/{start,callback}`）との比較

| 観点 | better-auth `linkSocial` | 自前ルート |
|---|---|---|
| state 検証 | 組み込み | 自前。`BETTER_AUTH_SECRET` で HMAC 署名した state を短命 Cookie に入れる（~40行） |
| PKCE | 組み込み | 自前（`crypto.subtle` で S256、~15行） |
| セッション紐付け | 組み込み（`link.userId`） | `getCurrentUser(request, auth, db)` を呼ぶだけ。**既存パターンそのまま** |
| グローバル設定の副作用 | **`allowDifferentEmails: true` / `trustedProviders` が Discord にも効く** | **なし** |
| `auth_accounts` に行ができるか | できる（Microsoft が better-auth の管理下に入り、unlink・退会・`cleanup-auth` cron との整合を考える必要が出る） | **できない**（望ましい。Minefolio は Microsoft をログイン手段として使わない） |
| トークンを保存するか | **する**（`accessToken` / `refreshToken` が DB に入る） | **しない設計にできる**（データ最小化） |
| 既定スコープの回避 | `disableDefaultScope` + `disableProfilePhoto` + `getUserInfo` 差し替えが必要 | 不要 |

**推奨: 自前ルート。**
理由: (a) グローバル設定の副作用を避けられる、(b) トークンを保存しない＝プライバシーポリシー上の記述が最小で済む、(c) `microsoft` プロバイダの既定挙動（Graph スコープ・Graph 写真取得・id_token 必須）をすべて潰すより素直、(d) 既存の `app/lib/session.ts` の `getCurrentUser()` と `app/routes/api/*.ts` のパターンにそのまま乗る。

better-auth を使う利点（state/PKCE の組み込み）は、`app/lib/return-to.ts` と同様の小さなサーバーユーティリティで代替でき、規模も小さい。

---

## 7. データモデル案

### 7.1 追加列（`app/lib/schema.ts` — **`platform-worker` 管轄**）

```ts
// users テーブル末尾（ALTER ADD は末尾に付くので定義も末尾に置く。既存コメントの慣例どおり）
mcidVerifiedAt: integer("mcid_verified_at", { mode: "timestamp" }),                 // Java: Microsoft 連携で所有確認した日時
bedrockMcidVerifiedAt: integer("bedrock_mcid_verified_at", { mode: "timestamp" }),  // Bedrock: 同上
xuid: text("xuid").unique(),                                                        // Xbox User ID（恒久。ゲーマータグの改名追従に使う）
```

- **Microsoft の `sub` / `oid` は保存しない**。Java 側は既存の `uuid`、Bedrock 側は `xuid` で同一性判定は足りる（データ最小化）
- `bedrockMcid` の UNIQUE: 現状は「他人のタグを先に登録して本人を締め出す」のを避けるため意図的に付けていない（`schema.ts` L18-21 のコメント）。検証導入後は **部分ユニーク（`WHERE bedrock_mcid_verified_at IS NOT NULL`）** にすれば「検証済みの値だけ一意」にできる。Drizzle SQLite の `uniqueIndex(...).on(...).where(sql...)` で表現可能。**実 DB への反映は `db-apply` スキルに従う（`db:push` の TRUNCATE 回避に注意）**

### 7.2 「本人優先」の横取り対策（既存 `set_mcid` との整合）

現行 `app/routes/me/edit.tsx` の `set_mcid`（L323-389）は **先着 + Mojang 存在確認のみ**:

```ts
const existingUser = await db.query.users.findFirst({ where: eq(users.mcid, mcid) });
if (existingUser && existingUser.id !== user.id) return { error: t("meEdit.mcidTaken"), action: "mcid" };
```

検証機能を入れると、次の2方向のルールが必要になる。

1. **検証済み MCID は未検証の申告で上書きできない** — `set_mcid` で他人が同じ MCID を要求してきたら従来どおり `mcidTaken` で拒否（**現状のままで満たされる**）
2. **未検証の他人が先に登録している MCID を、検証済み本人が奪えるようにする（本人優先）** — **これが新規に必要なロジック**。Microsoft 検証を通ったユーザーの UUID が他ユーザーの `users.uuid` と一致した場合:
   - 相手が `mcidVerifiedAt = null`（自己申告）なら、相手の `mcid` / `uuid` を null にし、slug を `@{discordId}` 形式へ戻して `recordSlugChange` + `retargetFavoritesOnSlugChange` を回す（`remove_mcid` と同じ後処理）
   - 相手も検証済みなら理論上ありえない（同じ Microsoft アカウント）。防御的に拒否してログ
   - **この自動剥奪は利用規約 §2-3「運営者が確認のうえ、当該登録の削除等の措置を行います」を自動化するものなので、規約側の文言更新が要る**（§8）

> 実装時は `recordSlugChange` / `retargetFavoritesOnSlugChange` を必ず同一トランザクションで呼ぶ（`set_mcid` / `remove_mcid` と同じ）。`docs/profiles.md`「スラッグ解決とフォールバックリダイレクト」参照。

### 7.3 改名への追従

- **Java**: 検証時に `uuid` を保存済み。Mojang 側で改名されても **`uuid` は不変**なので UUID → 現在名の逆引きで追従できる。既存の `slug_history` + Mojang フォールバック（`app/lib/player-slug-fallback.server.ts`、`docs/profiles.md` L102-168）がすでに「Mojang 側で改名済み・Minefolio 側 slug 未更新」を救済している。検証済みユーザーについては定期ジョブで UUID → 名前を引き直して `mcid`/`slug` を更新する選択肢もある（新規 cron が必要。今回は範囲外）
- **改名で `mcidVerifiedAt` を無効化する必要はない**。UUID が同じなら同一アカウントなので検証は有効なまま
- **Bedrock**: `xuid` が不変。ゲーマータグ変更の追従は再連携（ユーザーがもう一度ボタンを押す）でよい。自動追従するには XSAPI を叩く必要があり外部送信先が増えるため非推奨

---

## 8. プライバシー・規約への影響

### 8.1 現行ポリシーに記載が無いもの（= 改定が必要）

`app/content/privacy.md` を読んだ結果、**以下はすべて現行ポリシーに記載が無い**。

| 追加されるもの | 現行 privacy.md の該当箇所 | 必要な改定 |
|---|---|---|
| **Microsoft ID platform（`login.microsoftonline.com`）への送信** | 「4. 外部サービスへの情報送信・処理の委託」の表に **無い** | 表に行を追加（提供者: Microsoft Corporation、用途: MCID の所有確認、送信情報: OAuth 認証情報） |
| **Xbox Live（`user.auth.xboxlive.com` / `xsts.auth.xboxlive.com`）への送信** | 無い | 同上。Mojang API の行（用途は「MCID・UUID の確認、スキンの取得」）とは別物 |
| **`api.minecraftservices.com`（Java 検証時）** | Mojang API の行はあるが用途が異なる | Mojang API 行の用途に「アカウント所有確認」を追記 |
| **XUID の取得・保存** | 「1.(2) ユーザーが任意に登録する情報」に無い | 追記（Xbox User ID） |
| **ゲーマータグの自動取得** | `bedrockMcid` は「ユーザーが任意に登録する情報」。**Xbox から自動取得**は記載なし | 「(1) アカウント連携により取得する情報」に準じた節が要る |
| **Microsoft アカウント識別子** | 無い | **保存しない設計にすれば記載不要**（推奨） |
| **「MCID の登録は自己申告制であり、Microsoft アカウント認証等による本人確認は行っていません」** | **privacy.md L31 に明記されている** | **この記述が虚偽になる。必ず改定** |

`app/content/terms.md` 側:

| 箇所 | 内容 | 必要な改定 |
|---|---|---|
| §2-3 | 「本サイトの MCID 登録は自己申告制であり、Microsoft アカウント認証等による本人確認は行っていません」 | **改定必須**（privacy.md L31 と同文脈） |
| §2-3 後段 | 「運営者が確認のうえ、当該登録の削除等の措置を行います」 | §7.2 の自動剥奪を入れるなら「所有確認により本人が判明した場合、当該登録を自動的に解除することがあります」旨を追記 |
| §7 | 外部サービスのデータ | Microsoft / Xbox Live を明示するか検討 |

> なお、これは**ユーザーの端末から外部へ送信させる仕組み**ではなく（OAuth のリダイレクトは利用者自身の操作による遷移、トークン交換はすべてサーバー間）、privacy.md 「5. 外部送信規律に基づく公表」への追記は**不要と考えられる**。ただし「5.(4) 上記にあたらないもの」に一言足すのが親切（**判断が必要。最終判断はユーザー**）。
>
> ポリシー本文は**このタイミングでは改定しない**（`general.md` の指示）。実装コミット時に `Policy-Revision:` トレーラーでフラグを立て、リリース時に `release` スキルでまとめて改定する。

### 8.2 Microsoft / Xbox 側の開発者向け要件

- Xbox Live 認証を第三者アプリから使うことについて、XboxReplay は「技術的には承認済み Microsoft パートナー向け。プライバシーを損なう可能性があるため慎重に、Microsoft の ToS と適用される privacy 規制に従うこと」と警告している（[02-Custom_Azure_Application.md](https://github.com/XboxReplay/xboxlive-auth/blob/master/docs/02-Custom_Azure_Application.md)）
- **表示義務・ブランディング要件（"Sign in with Microsoft" ボタンのデザイン規定等）の有無は今回確認できていない（未確認）**。Microsoft のブランドガイドラインに沿うのが無難

### 8.3 スコープから外すべきもの・保存しなくてよいもの

- **スコープから外す**: `email` / `profile` / `User.Read`（Graph）／ `offline_access`
- **保存しない**: Microsoft access / refresh / id token、メールアドレス、Microsoft 表示名、`uhs`（User Hash）、`agg`（年齢グループ。XErr 分岐に使うだけでログにも残さない）
- **保存する**: `uuid`（既存）/ `mcid`（既存）/ `xuid`（新規）/ `bedrockMcid`（既存）/ 各 `*VerifiedAt`（新規）

---

## 9. 推奨アーキテクチャ

### 9.1 ルート構成

```
app/routes.ts に追加（レイアウト外・API ルート）
  route("api/link/microsoft/start",    "routes/api/link/microsoft/start.ts")
  route("api/link/microsoft/callback", "routes/api/link/microsoft/callback.ts")
```

- **`start`**: `getCurrentUser()` でログイン必須を担保 → PKCE verifier + state を生成 → `BETTER_AUTH_SECRET` で HMAC 署名した短命（10分）の HttpOnly / SameSite=Lax Cookie に `{ state, codeVerifier, mode: "java" | "bedrock", returnTo }` を格納 → authorize へ 302
- **`callback`**: state 照合 → コード交換 → Xbox → XSTS（→ Minecraft）→ DB 更新 → `/me/edit` へ 302（成否は `?linked=...` / `?error=...` で渡し、トーストは既存パターンで表示）
- ロジック本体は `app/lib/microsoft-auth.server.ts`（トークン交換）と `app/lib/microsoft-link.server.ts`（state/PKCE）に分離。`app/lib/mojang.ts` / `paceman.ts` と同じ「外部 API クライアント」の位置づけ
- 環境変数: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` を `app/lib/env.server.ts` の `getEnv()` に追加（**任意扱い**。未設定なら UI を出さない＝ローカル開発とデプロイを壊さない。Discord の既存パターンと同じ）

### 9.2 シーケンス

```mermaid
sequenceDiagram
    autonumber
    participant U as ユーザー
    participant MF as Minefolio (Vercel Fn)
    participant MS as login.microsoftonline.com/consumers
    participant XBL as user.auth.xboxlive.com
    participant XSTS as xsts.auth.xboxlive.com
    participant MC as api.minecraftservices.com
    participant DB as Turso

    U->>MF: /me/edit で「Microsoft で所有確認」
    MF->>MF: getCurrentUser() / PKCE + state 生成 → 署名Cookie
    MF-->>U: 302 authorize?scope=XboxLive.signin&code_challenge=...
    U->>MS: サインイン・同意
    MS-->>MF: 302 /api/link/microsoft/callback?code&state

    MF->>MF: state 照合（Cookie の HMAC 検証）
    MF->>MS: POST /oauth2/v2.0/token (code + code_verifier + secret)
    MS-->>MF: access_token (audience: XboxLive)

    MF->>XBL: POST /user/authenticate  RpsTicket = d= + access_token
    XBL-->>MF: Token(xbl) + uhs

    alt Bedrock 検証（Mojang 承認 不要）
        MF->>XSTS: RelyingParty=http://xboxlive.com / OptionalDisplayClaims=[gtg,xid,mgt,umg,mgs]
        XSTS-->>MF: gtg / umg / xid / uhs
        MF->>DB: bedrockMcid, xuid, bedrockMcidVerifiedAt=now
    else Java 検証（Mojang 承認 必要）
        MF->>XSTS: RelyingParty=rp://api.minecraftservices.com/
        XSTS-->>MF: Token(xsts) + uhs
        MF->>MC: POST /authentication/login_with_xbox (XBL3.0 x=uhs;xsts)
        MC-->>MF: MC access_token (24h)
        MF->>MC: GET /minecraft/profile
        MC-->>MF: id(UUID) / name(MCID)
        MF->>DB: mcid/uuid/slug 更新 + mcidVerifiedAt=now（+ 未検証の先行登録者から剥奪 / slug_history / favorites 追従）
    end

    MF->>MF: 取得したトークンはすべて破棄（保存しない）
    MF-->>U: 302 /me/edit?linked=bedrock|java
```

### 9.3 タイムアウト・Vercel 適合性

- 4段（Bedrock は3段）の HTTP 往復は通常合計 1〜3 秒程度。**Vercel の関数上限（Fluid Compute 既定 300 秒。Hobby も 300 秒、Pro は最大 800 秒）に対して余裕がある**（[Vercel Functions Limits](https://vercel.com/docs/functions/limitations) / [Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)）
- ただし Xbox 系エンドポイントは不安定なことがあるため、**各 fetch に 8〜10 秒の `AbortSignal.timeout` を付け、リトライはしない**（認可コードは1回しか使えないため、途中失敗は最初からやり直させる）
- OAuth コールバックは SSR ルートなので `runAfterResponse` 的な遅延処理は使わず同期的に完了させる

---

## 10. 段階的リリース案

| フェーズ | 内容 | 前提 |
|---|---|---|
| **Phase 0（今すぐ）** | Azure アプリを consumers テナントで登録し、`XboxLive.signin` の同意が通るか・XSTS（`http://xboxlive.com`）が 200 を返して `umg`/`xid` が入るかを**手元のスクリプトで検証**する。同時に `aka.ms/mce-reviewappid` に Java 用の承認申請を出す | なし。**この結果が出るまで実装に入らない** |
| **Phase 1（Bedrock 先行）** | `/api/link/microsoft/{start,callback}` + `mode=bedrock`。`xuid` / `bedrockMcidVerifiedAt` を追加し、`/me/edit` の Bedrock MCID 欄に「Microsoft で確認」ボタンと検証済みバッジ。プロフィールにも検証済み表示 | Phase 0 で XSTS が通ること。**Mojang 承認は不要** |
| **Phase 2（Java 切替）** | 同じルートに `mode=java` を足し、XSTS の RelyingParty を `rp://api.minecraftservices.com/` に変え、`login_with_xbox` → `minecraft/profile` を追加。`set_mcid` の本人優先ロジック（§7.2）とセットで入れる | **Mojang 承認が下りていること** |
| **Phase 3（任意）** | 検証済みユーザーの UUID → 現在名の定期追従 cron、検証済みのみを対象にした部分ユニーク制約の強化 | Phase 2 後 |

Phase 1 → 2 の差分はトークン交換の末尾2ステップと DB 更新先だけなので、**`verifyOwnership(accessToken, mode)` の内部分岐として最初から設計しておけば切り替えコストは小さい**。

### 担当の割り当て（`.claude/rules/README.md` のルーティング表より）

| 作業 | ワーカー |
|---|---|
| `app/lib/schema.ts` の列追加（`xuid` / `*VerifiedAt`、部分ユニーク） | **`platform-worker`**（DB スキーマは全機能共有のため集約） |
| `/api/link/microsoft/*` ルート・`app/lib/microsoft-auth.server.ts`・`env.server.ts` | **`platform-worker`**（`api/*`（cron 以外）担当） |
| `/me/edit` の UI・`set_mcid` の本人優先ロジック・プロフィールの検証済み表示 | **`profiles-worker`** |
| `docs/auth.md` / `docs/profiles.md` / `docs/database.md` の更新、翻訳キー（ja/en 両方必須） | **`chores-worker`**（実装ワーカーが自分の範囲で書くなら不要） |
| ポリシー改定 | リリース時に `release` スキル（実装コミットでは `Policy-Revision:` トレーラーのみ） |

---

## 11. 既知の落とし穴

1. **`d=` プレフィックス** — カスタム Azure アプリのトークンは必ず `d=` + token。`t=` は旧資格情報フロー用。間違えると `user/authenticate` が失敗する（[prismarine-auth](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/TokenManagers/XboxTokenManager.js)）
2. **consumers 以外のテナント** — `common` / AAD テナント ID では `XboxLive.signin` が通らない
3. **Graph スコープとの混在** — `User.Read` を残すと `AADSTS70011` 系で落ちる。better-auth の microsoft プロバイダを使うなら `disableDefaultScope: true` 必須
4. **Xbox プロフィール未作成ユーザー** — XErr `2148916233`。「Xbox プロフィールを作ってから再試行」という文言が要る（Java 版 PC プレイヤーでも起こりうる）
5. **子どもアカウント** — XErr `2148916238`。ファミリーに追加されていないと通らない。**Minecraft のユーザー層では実際に起きる**ため専用文言が必須
6. **地域制限** — XErr `2148916235`（Xbox Live 非対応地域）。韓国は `2148916236`（年齢証明）が出ることがある
7. **Game Pass ユーザー** — 所有しているのに `minecraft/profile` が 404（一度も公式ランチャーでログインしていない）。`entitlements/mcstore` に `product_game_pass_pc` / `product_game_pass_ultimate` が入る。**「所有していない」と誤案内しないこと**
8. **XSTS の失敗は形が2種類** — 401 は `XErr` 入りの JSON、RelyingParty 不正などは**本文が空の 400**。エラーハンドリングを `XErr` の有無で分岐させる
9. **`uhs` の安定性** — 将来のトークンで同一である保証がないとされる（keycloak-minecraft-idp の記述）。**恒久 ID として使わない**（`xid` を使う）
10. **`/entitlements/mcstore` の署名検証** — レスポンスの JWT 署名は Mojang の公開鍵で検証できる。所有偽装対策として有効だが、トークン交換全体がサーバー側で完結する Minefolio の構成では必須ではない
11. **公式クライアント ID の借用** — §3.4 のとおり採用しない
12. **better-auth 経由を選ぶ場合の副作用** — `accountLinking.allowDifferentEmails: true` は Discord にも効くグローバル設定
13. **翻訳キー** — 新規キーは `pages-ja.ts` / `pages-en.ts` 両方に入れる（カバレッジテストが一致を強制する）。XErr ごとのエラー文言は数が多いので最初からまとめて設計する

---

## 12. 未確認事項（要追加調査 / 実測）

1. **`XboxLive.signin` を新規 Azure アプリ（consumers）で同意できるか**。2026-02 の Microsoft Q&A 回答は「Xbox Developer Program 登録が前提」としているが、回答者は Microsoft Student Ambassador で公式見解ではない。**実際にアプリを作って authorize を叩くのが唯一の確認手段**（Phase 0）
2. **`aka.ms/mce-reviewappid` フォームの現在の記入項目と、2026 年に承認された実例**。リンクは生存確認済み（2026-09-18、curl）だが、フォーム本体は JS レンダリングのため内容未取得。2026-08 の 403 報告は 2026-09 時点で**未回答**（[Q&A 5989335](https://learn.microsoft.com/en-us/answers/questions/5989335/minecraft-services-returns-http-403-invalid-app-re)）
3. **`aka.ms/AppRegInfo` の遷移先記事（`help.minecraft.net/hc/en-us/articles/16254801392141`）の本文**。クライアント描画のため取得できず。**承認の可否判断に直結するので人力で読むべき**
4. **`scope=XboxLive.signin` 単独（`openid` なし）で v2/consumers の token エンドポイントが正常に access_token を返すか**。理屈上は返るはずだが実測していない
5. **Xbox Live / XSTS のレート制限**。公開ドキュメントに記載なし
6. **Xbox Live user token の有効期限**。gapple は「約14日」、xboxlive-auth のレスポンス例は約16時間で食い違う → **実装では常に `NotAfter` を読む**
7. **Microsoft のブランディング／表示義務**（"Sign in with Microsoft" のボタン規定等）
8. **Azure クライアントシークレットの最長有効期限（24か月）** — 一般的な Azure 仕様として記述したが、今回一次情報で再確認していない
9. **`http://xboxlive.com` RP で `umg`（`Name#1234`）が実際に返るか**。`OptionalDisplayClaims` に含めれば返るはずだが実測が必要
10. **`wiki.vg` は現在アクセス不能**（`ECONNREFUSED`）。同内容は minecraft.wiki に移行済みと思われるが、wiki.vg 側にしかない記述の有無は確認できていない

---

## 参照した主な出典

- [Microsoft authentication – Minecraft Wiki](https://minecraft.wiki/w/Microsoft_authentication)
- [Authenticating a Microsoft account – Mojang API Documentation (gapple)](https://mojang-api-docs.gapple.pw/authentication/msa)
- [PrismarineJS/prismarine-auth `Constants.js`](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/common/Constants.js) / [`XboxTokenManager.js`](https://github.com/PrismarineJS/prismarine-auth/blob/master/src/TokenManagers/XboxTokenManager.js)
- [XboxReplay/xboxlive-auth docs](https://github.com/XboxReplay/xboxlive-auth/tree/master/docs)（01-Authenticate / 02-Custom_Azure_Application / 04-RelyingParty / 06-Known_Issues / 09-Errors）および [`src/shared/libs/xbox-network/config.ts`](https://github.com/XboxReplay/xboxlive-auth/blob/master/src/shared/libs/xbox-network/config.ts)
- [groundsgg/keycloak-minecraft-idp](https://github.com/groundsgg/keycloak-minecraft-idp)
- [OAuth2 workflow with XboxLive and OpenID – Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1112356/oauth2-workflow-with-xboxlive-and-openid)
- [Azure AD Scope "User.Read" not compatible "XboxLive.Signin" – Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1462791/azure-ad-scope-user-read-not-compatible-xboxlive-s)
- [How to get XboxLive.signin permission for Azure App Registration – Microsoft Q&A (2026-02)](https://learn.microsoft.com/en-gb/answers/questions/5768276/how-to-get-xboxlive-signin-permission-for-azure-ap)
- [Minecraft Services returns HTTP 403 "Invalid app registration" – Microsoft Q&A (2026-08)](https://learn.microsoft.com/en-us/answers/questions/5989335/minecraft-services-returns-http-403-invalid-app-re)
- [Microsoft identity platform and OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- better-auth: [OAuth](https://www.better-auth.com/docs/concepts/oauth) / [Users & Accounts](https://www.better-auth.com/docs/concepts/users-accounts) / [Microsoft provider](https://www.better-auth.com/docs/authentication/microsoft)
- ローカル実ソース: `node_modules/.pnpm/@better-auth+core@1.6.27_*/node_modules/@better-auth/core/src/social-providers/microsoft-entra-id.ts`、`.../src/oauth2/{create-authorization-url,oauth-provider}.ts`、`.../src/types/init-options.ts`、`node_modules/better-auth/dist/api/routes/callback.mjs`、`.../oauth2/utils.mjs`
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) / [Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration)
- リポジトリ内: `app/lib/auth.ts`, `app/lib/session.ts`, `app/lib/schema.ts`, `app/lib/env.server.ts`, `app/routes/me/edit.tsx`, `app/routes.ts`, `app/content/privacy.md`, `app/content/terms.md`, `docs/profiles.md`, `docs/auth.md`
