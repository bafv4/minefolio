#!/bin/bash
set -e  # Exit on error

# Build the React Router app
echo "Building React Router app..."
npx react-router build

# Check if build was successful
if [ ! -f "build/server/index.js" ]; then
  echo "Error: build/server/index.js not found. Build may have failed."
  exit 1
fi

# Copy server bundle to _worker.js for Cloudflare Pages
echo "Creating Cloudflare Pages worker..."
cp build/server/index.js build/client/_worker.js

# Create _routes.json for Cloudflare Pages routing
echo "Creating _routes.json..."
cat > build/client/_routes.json << 'EOF'
{
  "version": 1,
  "include": [
    "/*"
  ],
  "exclude": [
    "/assets/*",
    "/favicon.ico",
    "/favicon.svg",
    "/icon.png",
    "/mcitems/*"
  ]
}
EOF

echo "Build complete! Ready to deploy to Cloudflare Pages."
