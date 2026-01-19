import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  serverModuleFormat: "esm",
  server: "./server/index.ts",
} satisfies Config;
