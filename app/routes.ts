import {
  type RouteConfig,
  index,
  layout,
  prefix,
  route,
} from "@react-router/dev/routes";

export default [
  // Public layout with header/footer
  layout("routes/_layout.tsx", [
    // Home
    index("routes/home.tsx"),

    // Auth
    route("login", "routes/login.tsx"),
    route("onboarding", "routes/onboarding.tsx"),
    // ローカル開発専用の簡易ログイン（DEV_AUTH=1 のときのみ有効。それ以外は404）
    route("dev/login", "routes/dev-login.tsx"),

    // Live（廃止。ライブペースはホームのペースフィードへ統合。旧URLはホームへリダイレクト）
    route("live", "routes/live-redirect.ts"),

    // Paces (最近のペース全件一覧)
    route("paces", "routes/paces.tsx"),

    // Browse & Rankings
    route("browse", "routes/browse.tsx"),
    route("random-player", "routes/random-player.ts"),
    route("secret-grid", "routes/secret-grid.tsx"),
    route("keybindings", "routes/keybindings.tsx"),
    route("keybindings/visual", "routes/keybindings-visual.tsx"),
    route("keybindings/stats", "routes/keybindings-stats.tsx"),
    route("rankings", "routes/rankings.tsx"),
    route("stats", "routes/stats.tsx"),
    route("compare", "routes/compare.tsx"),
    route("playground", "routes/playground.tsx"),
    route("favorites", "routes/favorites.tsx"),
    route("feedback", "routes/feedback.tsx"),
    route("developers", "routes/developers/index.tsx"),
    route("developers/api", "routes/developers/api.tsx"),
    route("developers/changelog", "routes/developers/changelog.tsx"),
    route("developers/export", "routes/developers/export.tsx"),

    // Player profile (public) - slugはMCIDまたは@{内部ID}形式
    route("player/:slug", "routes/player/profile.tsx"),
    route("player/:slug/stats", "routes/player/stats.tsx"),

    // Protected routes - user settings
    ...prefix("me", [
      layout("routes/me/_layout.tsx", [
        index("routes/me/index.tsx"),
        route("edit", "routes/me/edit.tsx"),
        route("records", "routes/me/records.tsx"),
        route("keybindings", "routes/me/keybindings.tsx"),
        route("devices", "routes/me/devices.tsx"),
        route("presets", "routes/me/presets.tsx"),
        route("import", "routes/me/import.tsx"),
        route("items", "routes/me/items.tsx"),
        route("search-craft", "routes/me/search-craft.tsx"),
      ]),
    ]),

    // My guides (separated from /me, no sidebar)
    route("my-guides", "routes/my-guides/index.tsx"),
    route("my-guides/new", "routes/my-guides/new.tsx"),
    route("my-guides/templates", "routes/my-guides/templates.tsx"),
    route("my-guides/templates/new", "routes/my-guides/template-new.tsx"),
    route("my-guides/templates/:templateId/edit", "routes/my-guides/template-edit.tsx"),
    route("my-guides/:guideSlug/edit", "routes/my-guides/edit.tsx"),

    // Public guides & searchcraft templates
    route("guides", "routes/guides/index.tsx"),
    route("guides/templates", "routes/guides/templates/index.tsx"),
    route("guides/templates/:templateId", "routes/guides/templates/view.tsx"),
    route("guides/:authorSlug", "routes/guides/user.tsx"),
    route("guides/:authorSlug/:guideSlug", "routes/guides/view.tsx"),
  ]),

  // API routes (outside of layout)
  route("api/auth/*", "routes/api/auth/splat.tsx"),
  route("api/skin", "routes/api/skin.ts"),
  route("api/me/skin", "routes/api/me/skin.ts"),
  route("api/me/skin/upload-token", "routes/api/me/skin/upload-token.ts"),
  route("api/me/guides/upload-image", "routes/api/me/guides/upload-image.ts"),
  route("api/guides/search", "routes/api/guides/search.ts"),
  route("api/favorites", "routes/api/favorites.ts"),
  route("api/users/by-slugs", "routes/api/users/by-slugs.ts"),
  route("api/home-feed", "routes/api/home-feed.ts"),
  route("api/social-stats", "routes/api/social-stats.ts"),
  route("api/paces", "routes/api/paces.ts"),
  route("api/keybindings-csv", "routes/api/keybindings-csv.ts"),
  route("api/browse", "routes/api/browse.ts"),

  // Webhook routes
  route("api/webhooks/vercel", "routes/api/webhooks/vercel.ts"),

  // Cron routes (for Vercel Cron)
  route("api/cron/youtube-update", "routes/api/cron/youtube-update.ts"),
  route("api/cron/update-paceman-cache", "routes/api/cron/update-paceman-cache.ts"),
  route("api/cron/update-rankings", "routes/api/cron/update-rankings.ts"),

  // OGP image generation (outside of layout)
  route("og-image", "routes/og-image.tsx"),
] satisfies RouteConfig;
