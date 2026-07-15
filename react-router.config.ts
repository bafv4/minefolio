import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  serverModuleFormat: "esm",
  // Vercel 向けのサーバー出力（ESMのサーバーレス関数・依存トレース）を生成する。
  // 未設定だと汎用ビルドがCJSで読み込まれ、ESMのみの依存（escape-string-regexp 等）を
  // require() できず ERR_REQUIRE_ESM で落ちる。
  presets: [vercelPreset()],
} satisfies Config;
