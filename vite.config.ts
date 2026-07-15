import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild, command }) => ({
  plugins: [
    reactRouter(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    // tsconfig の paths（@/* → app/*）を Vite 8 のネイティブ解決で処理する
    // （vite-tsconfig-paths プラグインの後継。プラグイン検出 WARNING の解消）
    tsconfigPaths: true,
    // sanitize-html は CJS で htmlparser2（純ESM）を require するが、Vercel の Node
    // ランタイムは require(esm) を許可せず ERR_REQUIRE_ESM でクラッシュする。ビルド時は
    // サーバーバンドルへ取り込み（Vite が require を import に変換する）実行時の解決を無くす。
    // トップレベル resolve.noExternal は全環境共通の既定なので、Vercelプリセットが
    // serverBundles で作る runtime 別環境（nodejs_<hash>）にも適用される
    // （ssr.noExternal は "ssr" 環境限定で当該環境に伝播しない）。
    // dev では対象外（Vite dev の SSR は CJS を inline 評価できず "require is not defined"）。
    noExternal: command === "build" ? ["sanitize-html", "htmlparser2"] : [],
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