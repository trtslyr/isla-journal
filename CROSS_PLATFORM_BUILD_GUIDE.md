# 🌍 Cross-Platform Electron Build Guide

## 🎯 **The Problem We Solved**

Cross-platform Electron builds often fail due to:
- **Platform Contamination** - Mac binaries in Windows builds 
- **Path Resolution Issues** - Windows vs Unix path handling
- **Native Module Conflicts** - Architecture mismatches
- **Build Environment Inconsistencies** - Different tools per platform

## ✅ **Our Solution: Zero-Contamination Builds**

This codebase implements **bulletproof cross-platform builds** using:

### **1. Platform Isolation Strategy**
```yaml
# Single workflow, separate jobs per platform
strategy:
  fail-fast: false
  matrix:
    include:
      - os: windows-latest, platform: win32, arch: x64
      - os: macos-latest, platform: darwin, arch: x64  
      - os: macos-latest, platform: darwin, arch: arm64
```

### **2. Clean Build Environment**
```bash
# Fresh install every time
rm -rf node_modules package-lock.json dist
npm ci --no-optional
npx @electron/rebuild --force --arch=${{ matrix.arch }}
```

### **3. Cross-Platform Path Resolution**
```typescript
// vite.config.ts - Uses __dirname instead of process.cwd()
const resolveAbsolute = (...paths: string[]) => resolve(__dirname, ...paths)
```

### **4. Universal Clean Scripts**
```javascript
// package.json - Node.js-based cleaning (works everywhere)
"clean:dist": "node -e \"const fs=require('fs'); if(fs.existsSync('dist')) fs.rmSync('dist',{recursive:true,force:true})\""
```

## 🔧 **Implementation Details**

### **Native Module Strategy**
```bash
# Force build from source (no precompiled binaries)
export npm_config_build_from_source=true
export npm_config_target_platform="${{ matrix.platform }}"
export npm_config_target_arch="${{ matrix.arch }}"
npx @electron/rebuild --verbose --force --arch=${{ matrix.arch }}
```

### **Verification Steps**
```bash
# Test binary exists and loads
test -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
node -e "require('better-sqlite3'); console.log('✓ Loads successfully')"
```

### **Build Process**
```bash
1. Clean everything (dist, node_modules)
2. Fresh npm install  
3. Rebuild native modules for target platform
4. Verify native modules work
5. Build application (Vite + TypeScript)
6. Test application startup
7. Package for platform
8. Verify installer exists
9. Upload platform-specific artifacts
```

## 📋 **Best Practices Checklist**

### ✅ **Do This:**
- [ ] Use separate GitHub Actions jobs per platform
- [ ] Always clean build environment (`rm -rf node_modules dist`)
- [ ] Force rebuild native modules (`@electron/rebuild --force`)
- [ ] Use `__dirname` for path resolution (not `process.cwd()`)
- [ ] Test native modules before building app
- [ ] Verify build output before packaging
- [ ] Use platform-specific artifact names

### ❌ **Don't Do This:**
- [ ] ~~Cross-compile (build Windows on Mac)~~
- [ ] ~~Reuse node_modules between platforms~~
- [ ] ~~Use precompiled binaries in CI~~
- [ ] ~~Skip native module verification~~
- [ ] ~~Use platform-specific scripts in package.json~~

## 🚀 **Results You'll Get**

With this setup, you'll have:

### **Windows Build**
- ✅ `IslaJournalSetup.exe` (Squirrel installer)
- ✅ Windows PE binaries only
- ✅ No Mac artifacts (`.dylib`, `.framework`)
- ✅ Architecture: `win32-x64`

### **macOS Intel Build**  
- ✅ `Isla Journal.dmg` (DMG installer)
- ✅ macOS Mach-O binaries only
- ✅ No Windows artifacts (`.exe`, `.dll`)  
- ✅ Architecture: `darwin-x64`

### **macOS Apple Silicon Build**
- ✅ `Isla Journal.dmg` (Apple Silicon optimized)
- ✅ ARM64 native performance
- ✅ No x64 compatibility layer needed
- ✅ Architecture: `darwin-arm64`

## 🛠️ **Troubleshooting**

### **"Vite build failed"**
```bash
# Check Vite config paths
npm run build:vite 2>&1 | grep -E "(error|Error|ERROR)"
```

### **"better-sqlite3 missing"**
```bash
# Verify native module
ls -la node_modules/better-sqlite3/build/Release/
npx @electron/rebuild --force better-sqlite3
```

### **"Installer not found"**
```bash  
# Check platform-specific output
ls -la out/make/
# Windows: out/make/squirrel.windows/
# macOS: out/make/
```

### **"Path resolution errors"**
```typescript
// Use absolute paths in configs
import { resolve } from 'path'
const resolveAbsolute = (...paths: string[]) => resolve(__dirname, ...paths)
```

## 📊 **Build Matrix Overview**

| Platform | OS | Architecture | Output | Artifact Name |
|----------|----|--------------| -------|---------------|
| Windows | `windows-latest` | `x64` | `.exe` installer | `windows-installer` |
| macOS Intel | `macos-latest` | `x64` | `.dmg` installer | `macos-intel-installer` |
| macOS Apple Silicon | `macos-latest` | `arm64` | `.dmg` installer | `macos-arm64-installer` |

## 🎉 **Success Indicators**

Your build is **working correctly** when you see:

```bash
✓ Dependencies installed successfully
✓ Native modules rebuilt successfully  
✓ better-sqlite3 binary exists
✓ better-sqlite3 loads successfully
✓ Frontend build successful
✓ Main process build successful
✓ Preload build successful
✓ Main process structure valid
✓ Database operations work correctly
✓ Application tests passed
✓ Packaging completed
✓ Windows installer(s) created: IslaJournalSetup.exe (45.2 MB)
✓ Artifacts uploaded as windows-installer
```

## 🔄 **Local Development**

For local cross-platform development:

```bash
# Clean everything
npm run clean:all

# Fresh install  
npm install

# Build and test
npm run build
npm start
```

This guide ensures **zero platform contamination** and **reliable cross-platform builds** every time! 🚀