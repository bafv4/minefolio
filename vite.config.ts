import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    reactRouter(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    // tsconfig の paths（@/* → app/*）を Vite 8 のネイティブ解決で処理する
    // （vite-tsconfig-paths プラグインの後継。プラグイン検出 WARNING の解消）
    tsconfigPaths: true,
    // xss(CJS)/cssfilter は外部参照のままにする（sanitize-html のような noExternal 不要）。
    // 理由: xss/cssfilter は純CJSで純ESMの推移的依存を持たず ERR_REQUIRE_ESM を起こさない。
    // 推移的依存 cssfilter の実行時解決は Vercel のファイルトレース(@vercel/nft)に委ねられ、
    // Vercel プレビューデプロイでガイド表示が正常動作することを確認済み（2026-07-19）。
    // もし将来 Cannot find module 等が出たら resolve.noExternal に ["xss","cssfilter"] を
    // 追加して build 時のみインライン化する（command === "build" 限定。dev は不可）。
  },
  ssr: {
    // nuqs は SSR でインライン化する（dev の 500 対策）。
    // 外部参照のままだと nuqs の react-router import が Node ESM ローダーで
    // dist/production 版に解決され、Vite 側（development 条件）で解決される
    // アプリ本体の react-router と二重インスタンス化する。React コンテキストが
    // 一致せず useNavigate() が「<Router> の外」invariant で落ちる（/keybindings 系）。
    // noExternal で nuqs を Vite のモジュールグラフに入れると、react-router の
    // 解決経路がアプリ本体と同一になり単一インスタンスに戻る。
    // resolve.dedupe では直らない: 物理コピーは1つで、分岐はローダー（Node vs Vite）
    // の exports 条件差によるため。本番ビルドは両者とも外部参照で Node 解決に
    // 揃うため元々影響なし（noExternal 追加後も nuqs 同梱＋react-router 外部で問題なし）。
    noExternal: ["nuqs"],
  },
  build: {
    rollupOptions: {
      // API 専用ルート（loader/action のみ）は空のクライアントチャンクを生成するが
      // 仕様どおりのため、ビルドログを汚す EMPTY_BUNDLE 警告のみ抑制する
      onwarn(warning, warn) {
        if (warning.code === "EMPTY_BUNDLE") return;
        warn(warning);
      },
      ...(isSsrBuild
        ? {}
        : {
            output: {
              // Vite 8（Rolldown）は manualChunks のオブジェクト形式を受け付けないため関数形式で指定。
              // react / react-dom / react-router を安定した vendor チャンクにまとめる。
              manualChunks(id) {
                if (/[\\/]node_modules[\\/](?:react|react-dom|react-router)[\\/]/.test(id)) {
                  return "vendor";
                }
              },
            },
          }),
    },
    sourcemap: false,
    minify: "esbuild",
  },
  server: {
    watch: {
      ignored: ["**/public/mcitems/**"],
    },
  },
}));