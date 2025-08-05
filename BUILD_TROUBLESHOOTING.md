# 🔧 Build Troubleshooting Guide

## The Problem: "dist/main/index.js NOT FOUND!"

This error occurs when native dependencies (specifically `better-sqlite3` and `systeminformation`) fail to compile properly in CI environments.

## Root Causes

1. **Native Dependencies**: `better-sqlite3` requires platform-specific compilation
2. **Electron vs Node.js**: Native modules need to be rebuilt for Electron's runtime
3. **CI Environment**: Fresh environments lack prebuilt binaries

## The Solution

### ✅ Fixed in this project:

1. **Added `@electron/rebuild`** to devDependencies
2. **Updated GitHub Actions workflow** to properly rebuild native modules
3. **Added fallback mechanisms** for build failures
4. **Added better diagnostics** for debugging build issues

### 🔧 Key Changes Made:

#### 1. package.json
```json
{
  "devDependencies": {
    "@electron/rebuild": "^3.6.0"
  },
  "scripts": {
    "rebuild": "electron-rebuild",
    "rebuild:electron": "electron-rebuild"
  }
}
```

#### 2. GitHub Actions (.github/workflows/build.yml)
- Added native module caching
- Added `@electron/rebuild` step
- Added build tools installation
- Added fallback build from source
- Added comprehensive diagnostics

## Manual Fixes (if needed)

### Local Development Issues:
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Rebuild native modules
npx @electron/rebuild

# If that fails, build from source
cd node_modules/better-sqlite3
npm run build-release
cd ../..
```

### Python/distutils Issues (macOS/Linux):
```bash
# Install required Python tools
pip install setuptools wheel

# Or use conda
conda install setuptools wheel
```

### Windows Build Issues:
```bash
# Install Visual Studio Build Tools
npm install --global windows-build-tools

# Or install Visual Studio Community with C++ tools
```

## Prevention

1. **Always use `@electron/rebuild`** instead of deprecated `electron-rebuild`
2. **Test builds locally** before pushing to CI
3. **Keep Node.js versions consistent** between local and CI
4. **Monitor native dependency updates** for breaking changes

## Debugging Commands

```bash
# Check if native modules built correctly
ls -la node_modules/better-sqlite3/build/Release/

# Test the built app
npm run build
ls -la dist/main/index.js

# Debug native module loading
node -e "console.log(require('better-sqlite3'))"
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `dist/main/index.js NOT FOUND!` | TypeScript compilation failed | Check imports and syntax |
| `gyp ERR! build error` | Native compilation failed | Install build tools, rebuild |
| `Could not locate the bindings file` | Native module not built | Run `@electron/rebuild` |
| `No prebuilt binaries found` | Missing prebuilt binaries | Build from source |

## When to Update This Guide

- Native dependency versions change
- Node.js/Electron versions change  
- New CI platforms added
- Build tools change

---

**Last Updated**: August 2025
**Status**: ✅ All build issues resolved 