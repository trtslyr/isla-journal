#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Smart native module rebuilder for cross-platform Electron builds
 * Uses the most reliable method for each platform
 */

function log(message) {
  console.log(`🔧 ${message}`);
}

function getTargetPlatform() {
  // Check if we're targeting a specific platform via environment variables
  const targetPlatform = process.env.npm_config_target_platform || process.platform;
  const targetArch = process.env.npm_config_target_arch || process.arch;
  return { platform: targetPlatform, arch: targetArch };
}

function rebuildForCurrentPlatform() {
  const { platform, arch } = getTargetPlatform();
  
  log(`Rebuilding native modules for ${platform}-${arch}...`);
  
  try {
    // Use @electron/rebuild which is the modern, reliable way
    execSync('npx @electron/rebuild', { 
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_target_platform: platform,
        npm_config_target_arch: arch
      }
    });
    log(`✅ Successfully rebuilt native modules for ${platform}-${arch}`);
    return true;
  } catch (error) {
    log(`❌ Failed to rebuild with @electron/rebuild: ${error.message}`);
    
    // Fallback to npm rebuild
    try {
      log('🔄 Trying fallback: npm rebuild...');
      execSync('npm rebuild', { stdio: 'inherit' });
      log('✅ Successfully rebuilt with npm rebuild');
      return true;
    } catch (fallbackError) {
      log(`❌ Fallback also failed: ${fallbackError.message}`);
      return false;
    }
  }
}

function rebuildForAllPlatforms() {
  log('🚀 Rebuilding for all supported platforms...');
  
  const platforms = [
    { platform: 'win32', arch: 'x64' },
    { platform: 'darwin', arch: 'x64' },
    { platform: 'darwin', arch: 'arm64' },
    { platform: 'linux', arch: 'x64' }
  ];
  
  let successCount = 0;
  
  for (const target of platforms) {
    log(`\n📦 Building for ${target.platform}-${target.arch}...`);
    
    try {
      // Set environment variables for cross-platform build
      const env = {
        ...process.env,
        npm_config_target_platform: target.platform,
        npm_config_target_arch: target.arch,
        npm_config_cache: path.join(__dirname, '..', '.npm-cache', `${target.platform}-${target.arch}`)
      };
      
      execSync('npx @electron/rebuild', { 
        stdio: 'inherit',
        env
      });
      
      log(`✅ ${target.platform}-${target.arch} build successful`);
      successCount++;
      
    } catch (error) {
      log(`⚠️  ${target.platform}-${target.arch} build failed: ${error.message}`);
      
      // For cross-platform builds, this is expected on some platforms
      if (target.platform !== process.platform) {
        log(`   (Cross-platform build failure is normal - this will work in CI)`);
      }
    }
  }
  
  log(`\n🎉 Completed builds for ${successCount}/${platforms.length} platforms`);
  return successCount > 0;
}

function verifyBinaries() {
  log('🔍 Verifying native binaries...');
  
  const modulesToCheck = [
    'better-sqlite3',
    'systeminformation'
  ];
  
  for (const moduleName of modulesToCheck) {
    const binaryPath = path.join(__dirname, '..', 'node_modules', moduleName, 'build', 'Release');
    
    if (fs.existsSync(binaryPath)) {
      const files = fs.readdirSync(binaryPath).filter(f => f.endsWith('.node'));
      if (files.length > 0) {
        log(`✅ ${moduleName}: Found ${files.join(', ')}`);
      } else {
        log(`⚠️  ${moduleName}: No .node files found in build directory`);
      }
    } else {
      log(`⚠️  ${moduleName}: No build directory found`);
    }
  }
}

function cleanBuildCache() {
  log('🧹 Cleaning build cache...');
  
  const pathsToClean = [
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'build'),
    path.join(__dirname, '..', 'node_modules', 'systeminformation', 'build'),
    path.join(__dirname, '..', '.npm-cache')
  ];
  
  for (const cleanPath of pathsToClean) {
    if (fs.existsSync(cleanPath)) {
      try {
        fs.rmSync(cleanPath, { recursive: true, force: true });
        log(`✅ Cleaned: ${cleanPath}`);
      } catch (error) {
        log(`⚠️  Could not clean ${cleanPath}: ${error.message}`);
      }
    }
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  log('🚀 Native Module Build Helper');
  log(`Platform: ${process.platform}-${process.arch}`);
  
  if (args.includes('--clean')) {
    cleanBuildCache();
  }
  
  if (args.includes('--all')) {
    rebuildForAllPlatforms();
  } else if (args.includes('--verify')) {
    verifyBinaries();
  } else {
    // Default: rebuild for current platform
    const success = rebuildForCurrentPlatform();
    if (success) {
      verifyBinaries();
    } else {
      log('❌ Build failed - check the errors above');
      process.exit(1);
    }
  }
}

module.exports = {
  rebuildForCurrentPlatform,
  rebuildForAllPlatforms,
  verifyBinaries,
  cleanBuildCache
};