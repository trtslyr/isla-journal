# Isla Journal - Tech Stack & Construction Plan

> **Vision**: A fully offline, VS Code-style journal app with AI integration, local directory access, and cross-platform support.

## 🎯 Core Requirements

- **Fully Offline** - Works without internet after initial setup
- **VS Code Layout** - 3-panel interface (File Tree | Editor | AI Chat)
- **Local Directory Access** - Native file system integration
- **AI Integration** - Local LLM with RAG for journal insights
- **🌍 CROSS-PLATFORM FIRST** - **Mac, Windows, Linux** with identical experience
- **Simple Distribution** - Single installer per platform, no complex setup

## 🛠 Complete Tech Stack

### Core Framework
```json
{
  "electron": "^27.0.0",
  "react": "^18.2.0",
  "typescript": "^5.2.0",
  "vite": "^4.5.0",
  "@vitejs/plugin-react": "^4.1.0",
  "electron-vite": "^1.0.29"
}
```

### UI & Layout (VS Code Style)
```json
{
  "@monaco-editor/react": "^4.6.0",
  "monaco-editor": "^0.44.0",
  "react-split-pane": "^0.1.92",
  "tailwindcss": "^3.3.5",
  "@headlessui/react": "^1.7.17",
  "@heroicons/react": "^2.0.18",
  "clsx": "^2.0.0"
}
```

### Local Storage & File System
```json
{
  "better-sqlite3": "^9.0.0",
  "chokidar": "^3.5.3",
  "dexie": "^3.2.4",
  "fs-extra": "^11.1.1",
  "path-browserify": "^1.0.1"
}
```

### Offline LLM Stack (Cross-Platform)
```json
{
  "@xenova/transformers": "^2.6.0",
  "onnxruntime-node": "^1.16.0",
  "ollama": "^0.4.0",
  "node-llama-cpp": "^2.7.0"
}
```
**Note**: Prioritize `@xenova/transformers` + `onnxruntime-node` for maximum cross-platform compatibility

### RAG & Vector Search (Offline)
```json
{
  "hnswlib-node": "^1.4.2",
  "faiss-node": "^0.5.1",
  "@tensorflow/tfjs-node": "^4.10.0"
}
```

### Text Processing & Search
```json
{
  "fuse.js": "^7.0.0",
  "lunr": "^2.3.9",
  "natural": "^6.7.0",
  "compromise": "^14.10.0",
  "markdown-it": "^13.0.2",
  "gray-matter": "^4.0.3",
  "rehype-highlight": "^7.0.0"
}
```

### Development Tools
```json
{
  "concurrently": "^8.2.2",
  "electron-builder": "^24.6.4",
  "eslint": "^8.52.0",
  "prettier": "^3.0.3",
  "husky": "^8.0.3",
  "@types/node": "^20.8.6"
}
```

### 🌍 Cross-Platform Essentials
```json
{
  "cross-env": "^7.0.3",
  "electron-rebuild": "^3.2.9",
  "@electron/rebuild": "^3.3.0",
  "node-gyp": "^9.4.0",
  "prebuild-install": "^7.1.1"
}
```
**Platform-Specific Build Tools**:
- **Windows**: `npm install --global windows-build-tools` (automated)
- **Linux**: Native build tools via package manager
- **macOS**: Xcode Command Line Tools (automated)

## 🏗 Architecture Overview

### Directory Structure
```
isla/
├── src/
│   ├── main/                    # Electron Main Process
│   │   ├── index.ts            # Main entry point
│   │   ├── file-manager.ts     # File system operations
│   │   ├── llm-manager.ts      # LLM lifecycle management
│   │   ├── ipc-handlers.ts     # Inter-process communication
│   │   └── setup/
│   │       └── offline-setup.ts # First-time model downloads
│   ├── renderer/               # React Renderer Process
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── FileTree/   # Left panel - File explorer
│   │   │   │   ├── Editor/     # Center panel - Monaco editor
│   │   │   │   ├── AIChat/     # Right panel - AI assistant
│   │   │   │   └── Layout/     # 3-panel layout components
│   │   │   ├── services/
│   │   │   │   ├── embedding.ts    # Local embeddings
│   │   │   │   ├── rag.ts          # RAG pipeline
│   │   │   │   ├── search.ts       # Full-text search
│   │   │   │   └── file-watcher.ts # File change detection
│   │   │   ├── stores/         # State management (Zustand)
│   │   │   │   ├── file-store.ts
│   │   │   │   ├── editor-store.ts
│   │   │   │   └── ai-store.ts
│   │   │   ├── types/          # TypeScript definitions
│   │   │   └── utils/          # Helper functions
│   │   ├── index.html
│   │   └── main.tsx
│   └── shared/                 # Shared between main/renderer
│       ├── types.ts           # Common type definitions
│       └── constants.ts       # App constants
├── resources/                  # Static assets
├── dist/                      # Build output
└── user-data/                 # Local app data
    ├── models/               # Downloaded LLM models
    ├── embeddings/           # Vector embeddings
    ├── database/            # SQLite databases
    └── journals/            # User's journal files
```

## 🎨 UI Layout (VS Code Style)

### 3-Panel Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Menu Bar                                                    │
├─────────────┬─────────────────────────┬─────────────────────┤
│             │                         │                     │
│ File Tree   │      Monaco Editor      │    AI Chat Panel    │
│             │                         │                     │
│ - journals/ │  # Today's Thoughts     │ 💬 Ask about your   │
│   - 2024/   │                         │    journal...       │
│     - jan/  │  Today I learned about  │                     │
│     - feb/  │  React state management │ 🔍 Search entries   │
│   - ideas/  │  and how useEffect...   │                     │
│   - work/   │                         │ 📊 Generate insights│
│             │  ## Key Insights        │                     │
│ 📁 Open Dir │                         │ [Send] [Clear]      │
│ ➕ New File │  - State updates are... │                     │
│             │                         │                     │
├─────────────┼─────────────────────────┼─────────────────────┤
│ Status Bar  │ word count, cursor pos  │ AI Status: Ready    │
└─────────────┴─────────────────────────┴─────────────────────┘
```

### Design System
- **Font**: JetBrains Mono throughout
- **Theme**: VS Code Dark/Light themes
- **Colors**: Professional, minimal palette
- **Panels**: Resizable with persist state
- **Icons**: Heroicons for consistency

## 🌍 Cross-Platform Strategy

### Platform Compatibility Matrix
| Component | Windows | macOS | Linux | Notes |
|-----------|---------|--------|-------|-------|
| Electron | ✅ | ✅ | ✅ | Native platform APIs |
| Monaco Editor | ✅ | ✅ | ✅ | Web-based, fully compatible |
| SQLite | ✅ | ✅ | ✅ | Native binaries via better-sqlite3 |
| ONNX Runtime | ✅ | ✅ | ✅ | Pre-built binaries available |
| File System | ✅ | ✅ | ✅ | Node.js fs with cross-env |
| Vector Search | ✅ | ✅ | ✅ | HNSWLIB has all platform builds |

### Build & Distribution Strategy
```yaml
# electron-builder.yml
platforms:
  - name: Windows
    target: nsis
    arch: [x64, arm64]
    
  - name: macOS  
    target: dmg
    arch: [x64, arm64]  # Intel + Apple Silicon
    
  - name: Linux
    target: [AppImage, deb, rpm]
    arch: [x64, arm64]
```

### Cross-Platform File Handling
```typescript
// src/shared/platform-utils.ts
import { join, resolve, sep } from 'path';
import { homedir, platform } from 'os';

export const getPlatformPaths = () => {
  const userHome = homedir();
  const platformName = platform();
  
  return {
    userData: {
      win32: join(userHome, 'AppData', 'Roaming', 'IslaJournal'),
      darwin: join(userHome, 'Library', 'Application Support', 'IslaJournal'),
      linux: join(userHome, '.config', 'isla-journal')
    }[platformName] || join(userHome, '.isla-journal'),
    
    models: join(this.userData, 'models'),
    journals: join(this.userData, 'journals'),
    database: join(this.userData, 'database')
  };
};
```

### Native Dependencies Strategy
**Priority 1 - Pure JavaScript (Best Compatibility)**:
- `@xenova/transformers` - Pure JS/WASM, works everywhere
- `onnxruntime-web` - WASM backend for consistency

**Priority 2 - Pre-built Binaries**:
- `better-sqlite3` - Reliable native builds for all platforms
- `onnxruntime-node` - Official pre-built binaries

**Priority 3 - Compile if Needed**:
- `node-llama-cpp` - Fallback option, requires compilation

### Platform-Specific Optimizations
```typescript
// src/main/platform-manager.ts
export class PlatformManager {
  static getOptimalSettings() {
    const platform = process.platform;
    
    return {
      win32: {
        llmThreads: Math.max(2, os.cpus().length - 1),
        memoryLimit: '4GB',
        useHardwareAcceleration: true
      },
      darwin: {
        llmThreads: os.cpus().length, // M1/M2 handle threading well
        memoryLimit: '6GB',
        useMetalAcceleration: true // Apple Silicon
      },
      linux: {
        llmThreads: Math.max(2, os.cpus().length - 1),
        memoryLimit: '4GB',
        useOpenCLAcceleration: true
      }
    }[platform];
  }
}

## 🔧 Construction Plan

### Phase 1: Core Foundation (Week 1-2)
**Goal**: Basic 3-panel layout with file operations

```typescript
// Key Components to Build:
- Electron app setup with Vite
- Basic 3-panel layout (File Tree | Editor | Chat)
- File system operations (open, save, create, delete)
- Monaco Editor integration
- Basic file tree navigation
- Local SQLite database setup
```

**Deliverables**:
- ✅ App launches with 3-panel layout
- ✅ Can browse and open local directories
- ✅ Monaco editor loads and edits markdown files
- ✅ Files save automatically
- ✅ Basic file tree with create/delete operations

### Phase 2: Offline LLM Integration (Week 3-4)
**Goal**: Local AI chat functionality

```typescript
// Key Components:
- Ollama/llama.cpp integration
- Model download and management
- Basic chat interface in right panel
- Simple prompt/response cycle
- Model loading indicators
```

**Deliverables**:
- ✅ Downloads LLM model on first run
- ✅ Chat interface responds to prompts
- ✅ AI answers questions about general topics
- ✅ Proper loading states and error handling

### Phase 3: RAG & Journal Intelligence (Week 5-6)
**Goal**: AI that understands your journal content

```typescript
// Key Components:
- Local embedding generation (@xenova/transformers)
- Vector database setup (HNSW)
- RAG pipeline (retrieve + generate)
- Journal content indexing
- Semantic search capabilities
```

**Deliverables**:
- ✅ AI can answer questions about journal entries
- ✅ Semantic search finds relevant past entries
- ✅ AI provides insights based on journal patterns
- ✅ Auto-indexing of new/modified journal entries

### Phase 4: Advanced Features (Week 7-8)
**Goal**: Professional journal experience

```typescript
// Key Components:
- Advanced search (tags, dates, full-text)
- Journal templates and snippets
- Export capabilities (PDF, markdown)
- Backup and sync options
- Performance optimizations
```

**Deliverables**:
- ✅ Fast full-text search across all journals
- ✅ Tag system for organizing entries
- ✅ Export journals in multiple formats
- ✅ Backup/restore functionality
- ✅ App feels responsive with large journal collections

### Phase 5: Cross-Platform Polish & Distribution (Week 9-10)
**Goal**: Production-ready application for **Mac, Windows & Linux**

```typescript
// Key Components:
- 🌍 Cross-platform app packaging (Windows, macOS, Linux)
- 🔄 Platform-specific installers (NSIS, DMG, AppImage/DEB/RPM)
- 🚀 Auto-updater with platform detection
- 🛡️ Code signing for all platforms (security)
- 🧪 Cross-platform automated testing
- 📖 Platform-specific user onboarding
- 📊 Universal error handling & logging
```

**Cross-Platform Deliverables**:
- ✅ **Windows**: `.exe` installer (NSIS) + portable version
- ✅ **macOS**: `.dmg` installer (Intel + Apple Silicon)
- ✅ **Linux**: AppImage (universal) + `.deb` + `.rpm` packages
- ✅ Identical user experience across all platforms
- ✅ Platform-specific optimizations (Metal, DirectX, OpenCL)
- ✅ Automated cross-platform CI/CD pipeline
- ✅ Comprehensive platform testing (VM-based)
- ✅ Ready for multi-platform distribution

## 🚀 Getting Started (Cross-Platform)

### 1. Initialize Project
```bash
npm create electron-vite@latest isla-journal
cd isla-journal
npm install
```

### 2. Install Cross-Platform Dependencies
```bash
# Core dependencies (cross-platform compatible)
npm install @monaco-editor/react react-split-pane tailwindcss
npm install better-sqlite3 chokidar dexie fs-extra
npm install @xenova/transformers onnxruntime-node
npm install fuse.js lunr natural markdown-it gray-matter

# Cross-platform tools
npm install cross-env prebuild-install
npm install -D @electron/rebuild electron-rebuild

# Development dependencies
npm install -D @types/better-sqlite3 @types/fs-extra
npm install -D electron-builder concurrently
```

### 3. Configure Cross-Platform Build
```json
// package.json scripts
{
  "scripts": {
    "build": "cross-env NODE_ENV=production vite build",
    "build:win": "electron-builder --win",
    "build:mac": "electron-builder --mac", 
    "build:linux": "electron-builder --linux",
    "build:all": "electron-builder --win --mac --linux",
    "postinstall": "electron-rebuild"
  }
}
```

### 4. Platform-Specific Setup (Automated)
```bash
# Windows (automated via electron-rebuild)
# - Visual Studio Build Tools
# - Python 3.x

# macOS (automated via electron-rebuild)  
# - Xcode Command Line Tools

# Linux (manual - one-time setup)
sudo apt-get install build-essential python3-dev
# or
sudo yum groupinstall "Development Tools"
```

### 5. Test Cross-Platform Compatibility
```bash
# Test on current platform
npm run dev

# Build for all platforms (requires platform-specific CI/CD)
npm run build:all
```

## 🎯 Success Metrics

### Performance Targets
- **Startup Time**: < 3 seconds cold start
- **File Loading**: < 500ms for large markdown files
- **AI Response**: < 5 seconds for journal queries
- **Search**: < 100ms for full-text search
- **Memory Usage**: < 500MB with models loaded

### User Experience Goals
- **Intuitive**: No learning curve for VS Code users
- **Fast**: Feels instant for all operations
- **Reliable**: Works 100% offline after setup
- **Private**: All data stays on local machine
- **Extensible**: Easy to add new AI capabilities
- **🌍 Universal**: Identical experience on Mac, Windows, Linux

## 🧪 Cross-Platform Testing Strategy

### Local Testing
```bash
# Test on current platform
npm run dev

# Build and test locally
npm run build:current && npm run test:e2e

# Test native dependencies
npm run test:native-deps
```

### CI/CD Pipeline (GitHub Actions)
```yaml
# .github/workflows/cross-platform-build.yml
name: Cross-Platform Build & Test

on: [push, pull_request]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20]
    
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm run test:cross-platform
      
      - name: Build for platform
        run: npm run build:${{ runner.os }}
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: isla-journal-${{ runner.os }}
          path: dist/
```

### Platform-Specific Testing
- **Windows**: Test on Windows 10/11, both x64 and ARM64
- **macOS**: Test on Intel and Apple Silicon (M1/M2/M3)
- **Linux**: Test on Ubuntu, Fedora, Arch Linux (major distros)
- **Automated**: VM-based testing in CI/CD
- **Manual**: Real hardware testing before releases

## 📦 Distribution Strategy

### Release Artifacts (Per Platform)
```
Releases/
├── Windows/
│   ├── isla-journal-setup-1.0.0.exe          # NSIS installer
│   ├── isla-journal-1.0.0-win-portable.zip   # Portable version
│   └── isla-journal-1.0.0-win-arm64.exe      # ARM64 support
├── macOS/
│   ├── isla-journal-1.0.0.dmg                # Universal binary
│   ├── isla-journal-1.0.0-mac-intel.dmg      # Intel-specific
│   └── isla-journal-1.0.0-mac-arm64.dmg      # Apple Silicon
└── Linux/
    ├── isla-journal-1.0.0.AppImage           # Universal Linux
    ├── isla-journal-1.0.0.deb                # Debian/Ubuntu
    ├── isla-journal-1.0.0.rpm                # RedHat/Fedora
    └── isla-journal-1.0.0.tar.gz             # Generic tarball
```

### Auto-Update Strategy
```typescript
// Cross-platform update detection
const updateConfig = {
  provider: 'github',
  repo: 'your-org/isla-journal',
  releaseType: 'release',
  
  // Platform-specific update mechanisms
  updaterOptions: {
    win32: { 
      provider: 'github',
      publisherName: 'Your Name'
    },
    darwin: { 
      provider: 'github',
      publisherName: 'Your Name'
    },
    linux: { 
      provider: 'generic',  // AppImage auto-update
      url: 'https://releases.example.com'
    }
  }
};
```

### Distribution Channels
- **Direct Download**: GitHub Releases (primary)
- **Windows**: Microsoft Store (future), Chocolatey, Winget
- **macOS**: Mac App Store (future), Homebrew Cask
- **Linux**: Snap Store, Flathub, AUR (Arch User Repository)
- **Enterprise**: Direct distribution with custom installers

## 🔮 Future Enhancements

### Mobile Phase (React Native)
- Sync journals via local network
- Mobile-optimized UI
- Voice-to-text journal entries
- Camera integration for visual journals

### Advanced AI Features
- Automatic journal summarization
- Mood tracking and insights
- Writing style analysis
- Custom AI personas for different journal types

---

**🌍 Ready to build the future of cross-platform journaling!**  
**One codebase → Mac + Windows + Linux → Seamless offline experience → 🚀** 