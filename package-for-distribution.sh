#!/bin/bash
set -e

VERSION="1.0.0"
DIST_DIR="vocal-ai-$VERSION"

echo "Packaging VocalAI $VERSION for distribution..."

# Create distribution directories
mkdir -p "$DIST_DIR-linux"
mkdir -p "$DIST_DIR-windows"

# Copy Linux binary and files
echo "Packaging Linux distribution..."
cp binaries/vocal-ai-linux "$DIST_DIR-linux/vocal-ai" 2>/dev/null || echo "Warning: Linux binary not found"
cp -r database "$DIST_DIR-linux/"
cp DISTRIBUTION.md "$DIST_DIR-linux/README.md" 2>/dev/null || cp README.md "$DIST_DIR-linux/README.md"
cp .env.example "$DIST_DIR-linux/.env.example" 2>/dev/null || cat > "$DIST_DIR-linux/.env.example" << 'EOF'
# Required: OpenAI API Key
OPENAI_API_KEY=sk-your-key-here

# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=vocal_ai_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password

# Optional: Hume AI for voice features
# HUME_API_KEY=your-hume-api-key

# Optional: Whisper provider (openai or local)
# WHISPER_PROVIDER=openai
EOF

# Copy Windows binary and files
echo "Packaging Windows distribution..."
cp binaries/vocal-ai-win.exe "$DIST_DIR-windows/vocal-ai.exe" 2>/dev/null || echo "Warning: Windows binary not found"
cp -r database "$DIST_DIR-windows/"
cp DISTRIBUTION.md "$DIST_DIR-windows/README.md" 2>/dev/null || cp README.md "$DIST_DIR-windows/README.md"
cp "$DIST_DIR-linux/.env.example" "$DIST_DIR-windows/.env.example"

# Create archives
echo "Creating archives..."
tar -czf "$DIST_DIR-linux.tar.gz" "$DIST_DIR-linux"
tar -czf "$DIST_DIR-windows.tar.gz" "$DIST_DIR-windows"

# Calculate sizes and checksums
echo ""
echo "=== Distribution Packages Created ==="
echo ""
echo "Linux:"
ls -lh "$DIST_DIR-linux.tar.gz"
sha256sum "$DIST_DIR-linux.tar.gz"
echo ""
echo "Windows:"
ls -lh "$DIST_DIR-windows.tar.gz"
sha256sum "$DIST_DIR-windows.tar.gz"
echo ""
echo "Users should extract and follow README.md for setup instructions."
echo "Windows users can extract .tar.gz with 7-Zip or Windows 11 native support."
echo ""

# Cleanup temporary directories
rm -rf "$DIST_DIR-linux" "$DIST_DIR-windows"

echo "Done! Distribution packages ready for release."
