#!/bin/bash
set -e

echo "Building for pkg..."

# Build TypeScript to dist/
echo "Compiling TypeScript..."
npm run build

# Build with pkg
echo "Building binaries with pkg..."
pkg dist/cli-terminal-kit-document.js \
  --targets node18-linux-x64,node18-win-x64 \
  --output binaries/niimi \
  --compress Brotli

echo "Build complete! Binaries in ./binaries/"
ls -lh binaries/
