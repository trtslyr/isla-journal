# 🪟 Windows Build Guide - Clean Source Build

This guide explains how to build the Windows version of Isla Journal from completely clean source code, avoiding any cross-platform contamination.

## 🚨 The Problem We Solved

Your previous Windows builds were failing because:

1. **Mixed Artifacts**: GitHub Actions were downloading precompiled Mac binaries and trying to use them on Windows
2. **Cross-compilation Issues**: Attempting to build Windows binaries from Mac/Linux environments
3. **Postinstall Script**: The `postinstall` script was automatically downloading wrong-platform binaries
4. **Node.js Version Mismatch**: Different workflows used different Node.js versions

## ✅ The Solution: Clean Source Build

### New GitHub Actions Workflow

We created `.github/workflows/build-windows-clean.yml` that:

- ✅ Runs **only on Windows runners**
- ✅ Completely cleans the environment first
- ✅ Installs dependencies **without postinstall scripts**
- ✅ Builds **all native modules from source**
- ✅ Uses consistent Node.js version (20)
- ✅ Verifies every step with comprehensive checks

### Key Changes Made

#### 1. Updated `package.json`

```diff
- "postinstall": "electron-builder install-app-deps && node scripts/download-precompiled-binaries.js",
+ "postinstall": "electron-builder install-app-deps",
+ "postinstall:legacy": "electron-builder install-app-deps && node scripts/download-precompiled-binaries.js",
+ "rebuild": "npx @electron/rebuild",
+ "rebuild:clean": "npm run clean:modules && npm install --ignore-scripts && npm run rebuild",
+ "clean:modules": "rimraf node_modules package-lock.json",
```

#### 2. Created Clean Build Script

`scripts/clean-build-windows.js` - A comprehensive Windows build script that:
- Verifies platform (must be Windows)
- Cleans all build artifacts
- Rebuilds native modules from source
- Verifies binary compatibility
- Builds application from source
- Packages the final installer

#### 3. New GitHub Actions Workflow

The new workflow (`build-windows-clean.yml`) ensures:
- Fresh Windows environment
- No cached artifacts from other platforms
- Native module compilation from source
- Comprehensive verification at each step

## 🚀 How to Use

### Option 1: GitHub Actions (Recommended)

1. **Push to main branch** or **create a tag**:
   ```bash
   git push origin main
   # or
   git tag v1.0.0 && git push origin v1.0.0
   ```

2. **Monitor the workflow**:
   - Go to GitHub Actions tab
   - Look for "Build Windows from Source (Clean)"
   - Download the artifact when complete

### Option 2: Manual Local Build (Windows only)

If you're on a Windows machine:

```bash
# Clean everything first
npm run clean:modules

# Fresh install without scripts
npm install --ignore-scripts

# Run the clean build script
node scripts/clean-build-windows.js
```

### Option 3: Step-by-Step Manual Build

```bash
# 1. Clean environment
rmdir /s dist out node_modules
del package-lock.json

# 2. Install dependencies without postinstall
npm install --ignore-scripts

# 3. Rebuild native modules from source
npm rebuild better-sqlite3 --build-from-source --verbose
npm rebuild systeminformation --verbose
npx @electron/rebuild --verbose --force

# 4. Build application
npm run build:vite
npm run build:main
npm run build:preload

# 5. Package
npm run make
```

## 🔍 Verification Steps

The new process includes comprehensive verification:

1. **Platform Check**: Ensures running on Windows
2. **Native Module Verification**: Checks `.node` binaries exist and are correct architecture
3. **Module Loading Test**: Tests that modules can actually be loaded
4. **Build Output Verification**: Confirms all required files are generated
5. **Installer Verification**: Checks final `.exe` installer is created

## 🛠️ Troubleshooting

### If Native Module Build Fails

```bash
# Install Windows build tools
npm install --global windows-build-tools

# Or install Visual Studio Build Tools manually
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

### If SQLite Binary Issues Persist

```bash
# Force rebuild better-sqlite3 from source
cd node_modules/better-sqlite3
npm run build-release
cd ../..
```

### If Electron Rebuild Fails

```bash
# Try with specific Electron version
npx @electron/rebuild --electron-version=27.0.0 --force
```

## 📊 What's Different Now

| Before | After |
|--------|-------|
| ❌ Mixed Mac/Windows artifacts | ✅ Pure Windows build from source |
| ❌ Cross-platform compilation | ✅ Native Windows compilation only |
| ❌ Automatic precompiled downloads | ✅ Manual source compilation |
| ❌ Node.js version inconsistency | ✅ Consistent Node.js 20 |
| ❌ No build verification | ✅ Comprehensive verification |

## 🎯 Expected Results

After following this process, you should get:

- ✅ **Working Windows `.exe` installer**
- ✅ **Native modules compiled for Windows**
- ✅ **No "Bad EXE format" errors**
- ✅ **Full database functionality**
- ✅ **Proper system information detection**

## 🔄 Migrating Existing Workflows

### Disable Old Workflows

You may want to disable or rename your existing workflows:
- `.github/workflows/build-release.yml` → `build-release.yml.disabled`
- `.github/workflows/build-all-platforms.yml` → `build-all-platforms.yml.disabled`

### Use New Workflow

The new `build-windows-clean.yml` should be your primary Windows build process.

## 📞 Support

If you still encounter issues:

1. Check the GitHub Actions logs for specific error messages
2. Ensure you're using the new workflow, not the old ones
3. Verify Node.js version consistency
4. Check that Windows build tools are properly installed

The new process is designed to be bulletproof and provide clear error messages at each step.

---

**Last Updated**: December 2024  
**Status**: ✅ Clean source build implemented