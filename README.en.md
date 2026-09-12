# Minefolio

[日本語](./README.md)

A portfolio / settings-sharing app for Minecraft speedrunners.

- License: [Apache License 2.0](./LICENSE) (excluded assets etc. are listed in the [License](#license) section)
- [Privacy Policy](./app/content/privacy.md) / [Terms of Service](./app/content/terms.md) (published on the site at `/privacy` `/terms`)

## Overview

Minefolio is a site where Minecraft speedrunners organize their profile and play settings and share them with other runners.
It aims to make "what environment, what keybindings, what actions" easy to visualize, for learning, comparison, and self-introduction.

Main use cases:

- Publish your profile page and share it on social media
- Reference other runners' keybindings and device information
- Record search-craft and remap settings so they can be reproduced
- Save settings as presets and switch between them by purpose

## Core Features (Overview)

### 1. Profile Publishing

- You can create a public profile page (`/player/:slug`)
- Example displayed fields:
  - Display name / MCID / pronouns
  - Role (e.g. runner)
  - A short bio or a full introduction
  - Badges for edition, input method, platform, etc.
- Visibility settings (`public` / `unlisted` / `private`, see "Permissions and Visibility" below) control exposure on listing pages and who can view the profile

### 2. Keybinding Management

- Edit the action assigned to each key
- The key-edit modal lets you edit action assignment, remaps, and custom actions together
- Edits in the modal are not applied immediately — they are committed when you press `Save`
- Bulk save (`save-all`) updates all settings together

### 3. Remap Feature

- You can register multiple remaps
- Source keys support modifier-key combinations (Ctrl/Shift/Alt/Meta)
- Remap targets are handled as one of 3 types:
  - Key (determined via the Web `KeyboardEvent.code`)
  - Character
  - Disabled
- Placeholder strings (e.g. `__character__`) are protected so they are turned into "disabled" on save

### 4. Custom Actions

- You can create actions with an arbitrary name, description, and category
- Triggers support regular keys and modifier-key combinations
- Can be added/edited both from a dedicated tab and from the key-edit modal

### 5. Search-craft Display

- Maps search strings to the keys typed to produce them
- Supports display that accounts for remaps
- Modifier keys are shown with marks (e.g. `◆` `⇧` `⌥` `◇`) for readability

### 6. Listing & Search

- `browse`:
  - Runner listing, filters, sort, pagination
  - Search executes when the search button is pressed
  - Loading state is shown only in the results area
- `keybindings`:
  - Compare runners' keybindings / mouse settings
  - Search executes when the search button is pressed
  - Loading state is shown only in the results table area

### 7. Presets

- Save your current settings as a preset
- Supports preset duplication and switching (restore)
- A preset bundles all setting types (keybindings, remaps, finger assignments, item layouts, search-craft, custom actions, etc.) as a single unit for save/restore (partial copy per type is not supported)

## Screens (Representative)

- `/` : Home (feed)
- `/browse` : Runner listing
- `/keybindings` : Keybinding listing
- `/player/:slug` : Public profile
- `/guides` : Guide articles listing
- `/rankings` : Rankings
- `/stats` : Stats
- `/privacy` `/terms` : Privacy Policy / Terms of Service
- `/me/*` : Your own settings management (edit, keybindings, presets, etc.)
- `/my-guides/*` : Manage and write your own guide articles

The full list of routes is defined in [`app/routes.ts`](./app/routes.ts) (manually maintained).

## Permissions and Visibility (Spec)

- Authenticated users can edit their own settings
- A profile's visibility (`profileVisibility`) has 3 levels:
  - `public` : Viewable by anyone, included in listings/search
  - `unlisted` : Viewable if you know the URL, excluded from listings/search
  - `private` : Viewable only by the owner
- Listings and rankings only include `public` profiles

## Tech Stack

- React 19 + React Router 8 (SSR, Vite)
- TypeScript
- Tailwind CSS 4 + shadcn/ui (Radix UI)
- Drizzle ORM + libSQL (Turso) / `@libsql/client`
- better-auth (Discord OAuth)
- TipTap (guide editor)
- Deployment: Vercel (Cron, Blob Storage, OG image generation)

See [`docs/tech-stack.md`](./docs/tech-stack.md) for details.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the values.

```bash
cp .env.example .env
```

Required:

- `TURSO_DATABASE_URL` (falls back to `file:local.db` if unset)
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `APP_URL`
- `BETTER_AUTH_SECRET`

Optional (enables features individually; the app starts without them):

- `TURSO_AUTH_TOKEN` — for connecting to production Turso (remote)
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — Twitch integration
- `YOUTUBE_API_KEY` — YouTube integration
- `ANTHROPIC_API_KEY` — automatic translation of guides and bios; the feature is disabled entirely if unset
- `RESEND_API_KEY` / `FEEDBACK_EMAIL` — sending feedback emails
- `GITHUB_FEEDBACK_TOKEN` / `GITHUB_FEEDBACK_REPO` — automatic GitHub Issue creation for feedback (opt-in feature; disabled entirely if unset)
- `CRON_SECRET` — authenticates Vercel Cron (required when deploying to Vercel)
- `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — page view aggregation via Vercel Web Analytics
- `VERCEL_WEBHOOK_SECRET` / `DISCORD_RELEASE_WEBHOOK_URL` — release notifications on production deploys
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (skin and guide image uploads); provided automatically on Vercel
- `LEGACY_API_URL` — import from the legacy service (MCSRer Hotkeys)
- `DEV_AUTH=1` — enables the local-only simplified login (`/dev/login`). See [`docs/local-development.md`](./docs/local-development.md) for details

See [`docs/infrastructure.md`](./docs/infrastructure.md#環境変数) for the complete list of environment variables.

### 3. Start the dev server

```bash
pnpm dev
```

Default: `http://localhost:5173`

## Available Scripts

```bash
# Development
pnpm dev
pnpm dev:remote       # Dev server connected to remote Turso (requires .env.remote)

# Build / run
pnpm build
pnpm start

# Type checking / tests
pnpm typecheck
pnpm test
pnpm test:ui
pnpm test:coverage

# DB (Drizzle)
pnpm db:generate
pnpm db:migrate
pnpm db:push          # Apply schema to the local DB (.env = file:local.db)
pnpm db:push:remote   # Apply schema to remote Turso (.env.remote)
pnpm db:studio
pnpm db:studio:remote
```

## Privacy Policy / Terms of Service

- [Privacy Policy](./app/content/privacy.md) — data collected, purposes of use, external destinations data is sent to, cookies, account deletion, etc. Includes disclosure of information sent from the user's device to outside parties (analytics, embedded video), required under Japan's Telecommunications Business Act
- [Terms of Service](./app/content/terms.md) — account and posted-content rights, prohibited actions, disclaimers, etc.

Both are published on the site at `/privacy` `/terms` with identical content (the markdown files in this repository are the source of truth). They apply independently of the source code license (below).

## License

The source code of this repository is published under the [Apache License 2.0](./LICENSE) (Copyright 2026 bfmkn (bafv4). See also [NOTICE](./NOTICE)).

The following are **excluded** from the license:

- `public/mcitems/` — Minecraft item textures. These are Mojang / Microsoft assets, used within the scope of the [Minecraft Usage Guidelines](https://www.minecraft.net/usage-guidelines). Follow those guidelines if you reuse them
- `public/fonts/` — Zen Kaku Gothic New (SIL Open Font License 1.1; see the bundled [`OFL.txt`](./public/fonts/OFL.txt))
- The "Minefolio" name, icon, and other brand elements (per Section 6 of the Apache License 2.0, trademark use is not granted)

Minefolio is an unofficial fan site and is not affiliated with Mojang or Microsoft. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
