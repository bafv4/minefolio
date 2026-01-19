#!/bin/bash

# Script to update environment variable access pattern in all route files
# Changes:
# 1. Add import { getEnv } from "@/lib/env.server";
# 2. Replace const { env } = context; with const env = context.env ?? getEnv();

set -e

# Array of files to update
files=(
  "app/routes/browse.tsx"
  "app/routes/stats.tsx"
  "app/routes/player/profile.tsx"
  "app/routes/api/auth/splat.tsx"
  "app/routes/onboarding.tsx"
  "app/routes/_layout.tsx"
  "app/routes/me/edit.tsx"
  "app/routes/me/search-craft.tsx"
  "app/routes/me/records.tsx"
  "app/routes/me/items.tsx"
  "app/routes/me/devices.tsx"
  "app/routes/me/presets.tsx"
  "app/routes/me/import.tsx"
  "app/routes/me/_layout.tsx"
  "app/routes/me/keybindings.tsx"
  "app/routes/login.tsx"
  "app/routes/keybindings.tsx"
  "app/routes/favorites.tsx"
  "app/routes/compare.tsx"
  "app/routes/api/home-feed.ts"
  "app/routes/me/export.tsx"
)

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Warning: File not found: $file"
    continue
  fi

  echo "Processing $file..."

  # Step 1: Add getEnv import if not already present
  if ! grep -q "import.*getEnv.*from.*@/lib/env.server" "$file"; then
    # Find the line with "getSession" or "getOptionalSession" import
    if grep -q "from \"@/lib/session\"" "$file"; then
      # Add the import after the session import
      sed -i '/from "@\/lib\/session"/a import { getEnv } from "@/lib/env.server";' "$file"
      echo "  ✓ Added getEnv import"
    else
      echo "  ⚠ Could not find appropriate location for import"
    fi
  else
    echo "  - getEnv import already exists"
  fi

  # Step 2: Replace const { env } = context; with const env = context.env ?? getEnv();
  if grep -q "const { env } = context;" "$file"; then
    sed -i 's/const { env } = context;/const env = context.env ?? getEnv();/g' "$file"
    echo "  ✓ Updated env access pattern"
  else
    echo "  - No env pattern to update"
  fi

done

echo ""
echo "✅ All files processed successfully!"
