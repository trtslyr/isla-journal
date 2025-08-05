const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🎨 Generating Isla Journal icons for all platforms...');

const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'icon.svg');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Check if source SVG exists
if (!fs.existsSync(svgPath)) {
  console.error('❌ Source SVG not found:', svgPath);
  process.exit(1);
}

console.log('✅ Source SVG found:', svgPath);

// Function to check if command exists
function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Function to generate PNG (for Linux)
function generatePNG() {
  console.log('🖼️  Generating PNG for Linux...');
  
  if (commandExists('rsvg-convert')) {
    try {
      execSync(`rsvg-convert -w 512 -h 512 "${svgPath}" -o "${path.join(buildDir, 'icon.png')}"`);
      console.log('✅ PNG generated using rsvg-convert');
    } catch (error) {
      console.error('❌ Failed to generate PNG with rsvg-convert:', error.message);
    }
  } else if (commandExists('inkscape')) {
    try {
      execSync(`inkscape -w 512 -h 512 "${svgPath}" -o "${path.join(buildDir, 'icon.png')}"`);
      console.log('✅ PNG generated using Inkscape');
    } catch (error) {
      console.error('❌ Failed to generate PNG with Inkscape:', error.message);
    }
  } else {
    console.warn('⚠️  No SVG converter found. Please install rsvg-convert or Inkscape');
    console.log('   macOS: brew install librsvg');
    console.log('   Ubuntu: sudo apt-get install librsvg2-bin');
    console.log('   Or download Inkscape from https://inkscape.org/');
  }
}

// Function to generate ICO (for Windows)
function generateICO() {
  console.log('🪟 Generating ICO for Windows...');
  
  if (commandExists('convert')) {
    try {
      // Generate PNG first, then convert to ICO
      const pngPath = path.join(buildDir, 'temp-icon.png');
      execSync(`convert -background none -size 256x256 "${svgPath}" "${pngPath}"`);
      execSync(`convert "${pngPath}" -define icon:auto-resize=256,128,64,48,32,16 "${path.join(buildDir, 'icon.ico')}"`);
      fs.unlinkSync(pngPath);
      console.log('✅ ICO generated using ImageMagick');
    } catch (error) {
      console.error('❌ Failed to generate ICO with ImageMagick:', error.message);
    }
  } else {
    console.warn('⚠️  ImageMagick not found. Please install ImageMagick for ICO generation');
    console.log('   macOS: brew install imagemagick');
    console.log('   Ubuntu: sudo apt-get install imagemagick');
  }
}

// Function to generate ICNS (for macOS)
function generateICNS() {
  console.log('🍎 Generating ICNS for macOS...');
  
  if (commandExists('iconutil')) {
    try {
      // Create iconset directory
      const iconsetDir = path.join(buildDir, 'icon.iconset');
      if (!fs.existsSync(iconsetDir)) {
        fs.mkdirSync(iconsetDir, { recursive: true });
      }
      
      // Generate different sizes
      const sizes = [16, 32, 64, 128, 256, 512];
      sizes.forEach(size => {
        const pngPath = path.join(iconsetDir, `icon_${size}x${size}.png`);
        execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`);
        
        // Also create @2x versions for retina displays
        if (size <= 256) {
          const png2xPath = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);
          execSync(`rsvg-convert -w ${size * 2} -h ${size * 2} "${svgPath}" -o "${png2xPath}"`);
        }
      });
      
      // Convert iconset to ICNS
      execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, 'icon.icns')}"`);
      
      // Clean up iconset directory
      fs.rmSync(iconsetDir, { recursive: true, force: true });
      
      console.log('✅ ICNS generated using iconutil');
    } catch (error) {
      console.error('❌ Failed to generate ICNS:', error.message);
    }
  } else {
    console.warn('⚠️  iconutil not found (macOS only). Please run this on macOS or use alternative tools');
  }
}

// Generate all formats
try {
  generatePNG();
  generateICO();
  generateICNS();
  
  console.log('\n🎉 Icon generation completed!');
  console.log('\n📁 Generated files:');
  console.log('   build/icon.png  - Linux (512x512)');
  console.log('   build/icon.ico  - Windows (256x256)');
  console.log('   build/icon.icns - macOS (512x512)');
  
  console.log('\n🚀 Next steps:');
  console.log('   1. Test the icons by running: npm run start');
  console.log('   2. Build for production: npm run make');
  console.log('   3. The icons will be used automatically for each platform');
  
} catch (error) {
  console.error('❌ Icon generation failed:', error.message);
  process.exit(1);
} 