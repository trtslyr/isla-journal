#!/bin/bash

# Build Windows native modules using Wine and Windows Node.js
set -e

echo "🔧 Building Windows native modules using Wine..."

# Check if Wine is available
if ! command -v wine &> /dev/null; then
    echo "❌ Wine is not installed. Please install Wine to build Windows binaries."
    exit 1
fi

# Create a temporary Windows environment
TEMP_DIR="/tmp/isla-windows-build"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "📦 Copying project to temporary directory..."
rsync -av --exclude=node_modules --exclude=out --exclude=dist "$PWD/" "$TEMP_DIR/"

cd "$TEMP_DIR"

echo "🍷 Setting up Windows Node.js environment..."
# Download Windows Node.js if not already present
NODE_WIN_VERSION="v20.17.0"
NODE_WIN_DIR="$HOME/.wine/drive_c/nodejs"

if [ ! -d "$NODE_WIN_DIR" ]; then
    echo "📥 Downloading Windows Node.js..."
    curl -o node-win.zip "https://nodejs.org/dist/${NODE_WIN_VERSION}/node-${NODE_WIN_VERSION}-win-x64.zip"
    unzip -q node-win.zip
    mkdir -p "$NODE_WIN_DIR"
    cp -r "node-${NODE_WIN_VERSION}-win-x64/"* "$NODE_WIN_DIR/"
    rm -rf node-win.zip "node-${NODE_WIN_VERSION}-win-x64"
fi

echo "📦 Installing dependencies in Wine environment..."
# Set Wine environment variables
export WINEPATH="C:\\nodejs;C:\\nodejs\\node_modules\\npm\\bin"

# Install dependencies
wine "$NODE_WIN_DIR/npm.cmd" install --only=production

echo "🔨 Building native modules for Windows..."
# Rebuild better-sqlite3 for Windows
wine "$NODE_WIN_DIR/npm.cmd" rebuild better-sqlite3 --build-from-source

echo "📋 Verifying Windows binaries..."
find node_modules/better-sqlite3 -name "*.node" -exec file {} \;

echo "📁 Copying Windows binaries back to main project..."
cp -r node_modules/better-sqlite3/build "$PWD/../node_modules/better-sqlite3/" || true

echo "✅ Windows native modules built successfully!"

# Clean up
cd "$PWD"
rm -rf "$TEMP_DIR"

echo "🎉 Windows build complete! You can now package the Windows version."