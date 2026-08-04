---
name: vercel-triage
description: Minefolio が Vercel 上でだけ落ちるとき（FUNCTION_INVOCATION_FAILED / ERR_REQUIRE_ESM / Cannot find module / 全ページ500）の切り分け手順。ローカルでは再現しないデプロイ起因の障害、CJS/ESM 解決の問題、vercelPreset・noExternal・Node ランタイムの調整を扱う。「デプロイしたらエラーになった」「Vercel のログにこれが出ている」などの依頼で使う。
---

# Vercel デプロイ障害の切り分け

ローカルでは動くのに Vercel でだけ落ちる系。**まず環境とコミットを確定させてから**原因を追う。
過去に「コードを疑って半日溶かしたが原因はプラットフォーム側」というケースが複数ある。

## Step 0: 前提を確定する（必ず最初）

1. **どちらの環境か。** 本番 = `main` ブランチ / dev 環境 = `dev` ブランチのプレビュー。
   ユーザーが「デプロイした」と言う場合 dev 環境のことがある。**必ず確認する。**
2. **落ちているデプロイのコミットに、想定の修正が入っているか。**
3. **エラーパスが実際のパッケージレイアウトと一致するか。**
   `/var/task/node_modules/<pkg>` と `node_modules/.pnpm/<pkg>@ver/...` の食い違いなど、
   一致しないならプラットフォーム側（ランタイム/トレース）を疑う。
4. **ローカルで本番ビルドを起動して切り分ける。**

   ```bash
   pnpm build
   node --env-file=.env node_modules/@react-router/serve/dist/cli.js ./build/server/index.js
   ```

   **`NODE_ENV=production` を必ず付ける。** 付けないと react が development・
   react-dom/server が production で混在ロードされ、`dispatcher.getOwner is not a function`
   で全ページ 500 になる（アプリのバグではない）。

## 症状別

### `Cannot find module 'escape-string-regexp'` / `ERR_REQUIRE_ESM`（サーバー起動時）

**まず `react-router.config.ts` の `vercelPreset()` を確認する。**

```ts
import { vercelPreset } from "@vercel/react-router/vite";
export default { ssr: true, serverModuleFormat: "esm", presets: [vercelPreset()] } satisfies Config;
```

未設定だとビルド時に `WARN: The vercelPreset() Preset was not detected` が出て、
Vercel が汎用ビルドを **CJS** で読み込む。純 ESM の推移的依存を `require()` できず落ちる。
Vercel のランタイム（`/opt/rust/nodejs.js`）は `require(esm)` を許可しない。

効いているかの確認: `pnpm build` 後、サーバーバンドルの先頭が `import{` で始まっていればよい。
出力先は `build/server/nodejs_<hash>/index.js`
（`.vercel/react-router-build-result.json` の `buildManifest.serverBundles.*.file`）。

### `ERR_REQUIRE_ESM`（プリセットは効いているのに出る）

CJS パッケージが純 ESM の推移的依存を require しているケース。
`vite.config.ts` でインライン化する。

**`ssr.noExternal` ではなく、トップレベルの `resolve.noExternal` に置く。**
vercelPreset は runtime 別の Vite 環境（`nodejs_<hash>`）を作り、
そこに `ssr.noExternal` は**伝播しない**（"ssr" 環境限定のため）。

**build 時のみ有効にする**（`command === "build"` 限定）。dev サーバーに適用すると
CJS を inline 評価できず `require is not defined` になる。

**依存クロージャは全部入れる。** 1つ足りないと次の依存で順番に落ちる「もぐら叩き」になる。
`node_modules/.pnpm` を辿って `dependencies` + `optionalDependencies` を再帰算出する。
ローカル `pnpm build` と Vercel のフレッシュビルドで tree-shaking 結果が異なるため、
ローカルで不要に見えるものも入れる（noExternal は参照されなければ無害）。

> 実例: `sanitize-html@2.17.6` の完全クロージャは17個あり、`launder`（直接依存）と
> `dayjs`（launder の依存）を見落として2回落ちた。最終的に `xss` + `cssfilter` へ移行して解決。
> **現在 `resolve.noExternal` は空**（`xss`/`cssfilter` は純 CJS で純 ESM の推移的依存を持たない）。

判断基準: **noExternal が要るのは「純 ESM の推移的依存を CJS から require するケース」だけ。**
純 CJS クロージャなら外部参照のまま Vercel の nft トレースに任せてよい。

### `FUNCTION_INVOCATION_FAILED`（全ページ・依存は変えていないのに突然）

**Node ランタイムのバージョンを疑う。** Vercel の新しい Rust ベース Node ランタイム
（スタックに `/opt/rust/nodejs.js` が出る）は dual package の `require` 条件解決に失敗することがある。

- 回避: `package.json` に `engines.node: "22.x"` を追加して旧ランタイムに固定する
  （ローカルが Node 24 だと pnpm が警告を出すが無害）。
- **`engines` 変更後は「Use existing Build Cache」を外して再デプロイする。**
  Vercel は engines 変更時にビルドキャッシュが古いままになる既知問題がある。
- 2026-07-11 のインシデントはこれ（htmlparser2 v10 の dual package）。
  その後 xss 移行で根本解決したため、現在 `engines` は設定していない。
  再発時に立てる選択肢として覚えておく。

### ビルドコマンド

Vercel 側のビルドコマンドは **`pnpm build`**。`npm run build` にすると
pnpm のネストした `node_modules` レイアウトと噛み合わず不安定になる。

## 報告するとき

原因が「プラットフォーム側」と判断した場合は、その根拠（エラーパスとパッケージレイアウトの
不一致、依存が変わっていない事実、ローカル本番ビルドが通ること）を添えて報告する。

## 参照

- `vite.config.ts` — noExternal / optimizeDeps / manualChunks の意図はコメントに記載済み
- `react-router.config.ts` — vercelPreset の理由をコメントに記載済み
- `docs/infrastructure.md`
