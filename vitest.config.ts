import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig の paths（@/* → app/*）を Vite 8 のネイティブ解決で処理する
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "app/**/*.test.ts",
        "app/**/*.test.tsx",
        "build/",
        ".react-router/",
      ],
    },
  },
});
