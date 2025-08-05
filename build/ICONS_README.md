# 🎨 **ISLA JOURNAL - CUSTOM ICONS SETUP**

## 📱 **Icon Requirements**

Your app needs **different icon formats** for each platform. Put your logo in these files:

### **🍎 macOS (.icns)**
- **File**: `build/icon.icns`
- **Format**: Apple Icon format (`.icns`)
- **Sizes included**: 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024

### **🪟 Windows (.ico)**  
- **File**: `build/icon.ico`
- **Format**: Windows Icon format (`.ico`)
- **Sizes included**: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256

### **🐧 Linux (PNG files)**
- **Directory**: `build/icons/`
- **Files needed**:
  ```
  build/icons/16x16.png
  build/icons/32x32.png
  build/icons/48x48.png
  build/icons/64x64.png
  build/icons/128x128.png
  build/icons/256x256.png
  build/icons/512x512.png
  build/icons/1024x1024.png
  ```

---

## 🛠️ **How to Create Icon Files**

### **Option 1: Online Converter (Easiest)**
1. Go to **[CloudConvert](https://cloudconvert.com/png-to-icns)** or **[ICO Convert](https://icoconvert.com/)**
2. Upload your **1024x1024 PNG logo**
3. Convert to `.icns` (for Mac) and `.ico` (for Windows)
4. Download and place in `build/` folder

### **Option 2: Using macOS (if you're on Mac)**
```bash
# Create .icns from PNG
mkdir MyIcon.iconset
sips -z 16 16     icon-1024.png --out MyIcon.iconset/icon_16x16.png
sips -z 32 32     icon-1024.png --out MyIcon.iconset/icon_16x16@2x.png
sips -z 32 32     icon-1024.png --out MyIcon.iconset/icon_32x32.png
sips -z 64 64     icon-1024.png --out MyIcon.iconset/icon_32x32@2x.png
sips -z 128 128   icon-1024.png --out MyIcon.iconset/icon_128x128.png
sips -z 256 256   icon-1024.png --out MyIcon.iconset/icon_128x128@2x.png
sips -z 256 256   icon-1024.png --out MyIcon.iconset/icon_256x256.png
sips -z 512 512   icon-1024.png --out MyIcon.iconset/icon_256x256@2x.png
sips -z 512 512   icon-1024.png --out MyIcon.iconset/icon_512x512.png
sips -z 1024 1024 icon-1024.png --out MyIcon.iconset/icon_512x512@2x.png
iconutil -c icns MyIcon.iconset
mv MyIcon.icns build/icon.icns
```

### **Option 3: Using ImageMagick (Cross-platform)**
```bash
# Install ImageMagick first
# macOS: brew install imagemagick
# Ubuntu: sudo apt install imagemagick
# Windows: Download from imagemagick.org

# Create all sizes from your 1024x1024 PNG
magick your-logo-1024.png -resize 16x16 build/icons/16x16.png
magick your-logo-1024.png -resize 32x32 build/icons/32x32.png
magick your-logo-1024.png -resize 48x48 build/icons/48x48.png
magick your-logo-1024.png -resize 64x64 build/icons/64x64.png
magick your-logo-1024.png -resize 128x128 build/icons/128x128.png
magick your-logo-1024.png -resize 256x256 build/icons/256x256.png
magick your-logo-1024.png -resize 512x512 build/icons/512x512.png
magick your-logo-1024.png -resize 1024x1024 build/icons/1024x1024.png

# Create .ico for Windows
magick your-logo-1024.png -resize 256x256 build/icon.ico
```

---

## 🎨 **Logo Design Tips**

### **✅ Best Practices:**
- **Square format** (1:1 ratio)
- **1024x1024 pixels** minimum
- **Simple, clean design** (works at small sizes)
- **High contrast** on both light/dark backgrounds
- **No text** (might be unreadable when small)
- **PNG format** with transparency

### **❌ Avoid:**
- Rectangular logos (will be squashed)
- Complex details (invisible when small)
- Light colors on white (invisible in light mode)
- Very thin lines (disappear when scaled down)

---

## 🚀 **After Adding Your Icons**

1. **Commit the changes:**
   ```bash
   git add build/
   git commit -m "✨ Add custom app icons"
   git push
   ```

2. **Build your app:**
   ```bash
   npm run dist        # Build for current platform
   npm run dist:mac    # macOS only
   npm run dist:win    # Windows only  
   npm run dist:linux  # Linux only
   ```

3. **Find your app:**
   - Built apps will be in the `release/` folder
   - Ready to distribute! 🎉

---

## 🔧 **Current Branding Setup**

- **App Name**: "Isla" (shows in dock/taskbar)
- **Product Name**: "Isla Journal" (shows in installers)
- **Bundle ID**: `com.taylorwall.isla-journal`
- **Author**: Taylor Wall
- **Category**: Productivity (macOS), Office (Linux)

Want to change any of these? Edit `package.json` in the `build` section! 🛠️ 