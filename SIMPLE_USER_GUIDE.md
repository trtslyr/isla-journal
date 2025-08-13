# Isla Journal - Simple Setup for Users

## What you need:
- **Chromium browser** (Chrome, Edge, Brave, Arc) 
- **Ollama installed** ([download here](https://ollama.ai/download))

## One-time setup:

1. **Download this folder** and unzip it
2. **Start Ollama**: 
   - macOS: `brew services start ollama` OR `ollama serve`
   - Windows: Run "Ollama" from Start menu OR `ollama serve`
   - Linux: `ollama serve`
3. **Install a model**: `ollama pull llama3.2:1b`

## Every time you use the app:

**Option A: One command**
```bash
npm install && npm run serve:build
```
Then open http://localhost:5173

**Option B: Double-click executable** (if provided)
- Just double-click `isla-journal` (macOS/Linux) or `isla-journal.exe` (Windows)
- Browser opens automatically

## What it does:
- ✅ No Electron, just a fast web app
- ✅ Access local files via browser File System API
- ✅ Chat with your notes using local Ollama
- ✅ Works offline once loaded
- ✅ Can be installed as a PWA (click "Install" in address bar)

## Troubleshooting:
- **"No models found"**: Run `ollama pull llama3.2:1b`
- **"Connection failed"**: Make sure Ollama is running (`ollama serve`)
- **File access doesn't work**: Use Chrome/Edge (Safari/Firefox don't support file APIs)

That's it! 🎉
