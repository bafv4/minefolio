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

    // Browse & Rankings
    route("browse", "routes/browse.tsx"),
    route("keybindings", "routes/keybindings.tsx"),
    route("rankings", "routes/rankings.tsx"),
    route("stats", "routes/stats.tsx"),
    route("compare", "routes/compare.tsx"),
    route("favorites", "routes/favorites.tsx"),

    // Player profile (public)
    route("player/:mcid", "routes/player/profile.tsx"),

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
  ]),

  // API routes (outside of layout)
  route("api/auth/*", "routes/api/auth/splat.tsx"),
  route("api/skin", "routes/api/skin.ts"),
  route("api/favorites", "routes/api/favorites.ts"),
] satisfies RouteConfig;
