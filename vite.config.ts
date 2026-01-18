import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflareDevProxy(),
    reactRouter(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    watch: {
      // publicフォルダ内のmcitemsを監視対象から除外
      ignored: ["**/public/mcitems/**"],
    },
  },
  build: {
    // 本番ビルドの最適化設定
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        // チャンクサイズの最適化
        manualChunks(id) {
          // node_modulesを個別のチャンクに分割
          if (id.includes("node_modules")) {
            // Radix UIコンポーネントを1つのチャンクに
            if (id.includes("@radix-ui")) {
              return "radix-ui";
            }
            // lucide-reactを個別チャンクに
            if (id.includes("lucide-react")) {
              return "lucide-icons";
            }
            // react-hook-formとバリデーションライブラリ
            if (id.includes("react-hook-form") || id.includes("@hookform")) {
              return "forms";
            }
            // その他のvendorライブラリ
            return "vendor";
          }
        },
      },
    },
    // 大きなチャンクの警告を500kbに設定
    chunkSizeWarningLimit: 500,
  },
});