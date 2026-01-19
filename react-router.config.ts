import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  serverModuleFormat: "esm",
  presets: [
    // Vercel deployment preset
    async () => {
      const { vercelPreset } = await import("@vercel/remix");
      return vercelPreset();
    },
  ],
} satisfies Config;
