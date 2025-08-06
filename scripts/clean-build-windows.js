#!/usr/bin/env node

/**
 * Clean Windows Build Script
 * 
 * This script ensures a completely clean build from source for Windows,
 * avoiding any cross-platform contamination from Mac artifacts.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(message) {
  console.log(`🪟 [Windows Build] ${message}`);
}

function error(message) {
  console.error(`❌ [Windows Build] ${message}`);
}

function success(message) {
  console.log(`✅ [Windows Build] ${message}`);
}

function cleanEnvironment() {
  log('Cleaning build environment...');
  
  const pathsToClean = [
    'dist',
    'out',
    'node_modules/.cache',
    '.npm'
  ];
  
  for (const cleanPath of pathsToClean) {
    if (fs.existsSync(cleanPath)) {
      try {
        fs.rmSync(cleanPath, { recursive: true, force: true });
        log(`Cleaned: ${cleanPath}`);
      } catch (err) {
        console.warn(`⚠️ Could not clean ${cleanPath}: ${err.message}`);
      }
    }
  }
  
  success('Environment cleaned');
}

function verifyPlatform() {
  log('Verifying platform...');
  
  if (process.platform !== 'win32') {
    error('This script must be run on Windows!');
    process.exit(1);
  }
  
  log(`Platform: ${process.platform}`);
  log(`Architecture: ${process.arch}`);
  log(`Node version: ${process.version}`);
  
  success('Platform verified');
}

function rebuildNativeModules() {
  log('Rebuilding native modules from source...');
  
  try {
    // Build better-sqlite3 from source
    log('Building better-sqlite3 from source...');
    execSync('npm rebuild better-sqlite3 --build-from-source --verbose', { 
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_build_from_source: 'true'
      }
    });
    
    // Build systeminformation
    log('Building systeminformation...');
    execSync('npm rebuild systeminformation --verbose', { stdio: 'inherit' });
    
    // Use @electron/rebuild for all native modules
    log('Running @electron/rebuild...');
    execSync('npx @electron/rebuild --verbose --force', { stdio: 'inherit' });
    
    success('Native modules rebuilt successfully');
    
  } catch (err) {
    error(`Failed to rebuild native modules: ${err.message}`);
    throw err;
  }
}

function verifyNativeModules() {
  log('Verifying native modules...');
  
  // Check better-sqlite3
  const sqliteBinary = path.join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(sqliteBinary)) {
    const stats = fs.statSync(sqliteBinary);
    success(`better-sqlite3 binary exists (${stats.size} bytes)`);
  } else {
    error('better-sqlite3 binary missing!');
    throw new Error('better-sqlite3 binary not found');
  }
  
  // Test loading modules
  try {
    log('Testing module loading...');
    require('better-sqlite3');
    success('better-sqlite3 loads successfully');
    
    require('systeminformation');
    success('systeminformation loads successfully');
    
  } catch (err) {
    error(`Module loading failed: ${err.message}`);
    throw err;
  }
}

function buildApplication() {
  log('Building application from source...');
  
  try {
    // Build frontend
    log('Building Vite frontend...');
    execSync('npm run build:vite', { stdio: 'inherit' });
    
    // Build main process
    log('Building main process...');
    execSync('npm run build:main', { stdio: 'inherit' });
    
    // Build preload
    log('Building preload script...');
    execSync('npm run build:preload', { stdio: 'inherit' });
    
    success('Application built successfully');
    
  } catch (err) {
    error(`Application build failed: ${err.message}`);
    throw err;
  }
}

function verifyBuildOutput() {
  log('Verifying build output...');
  
  const requiredFiles = [
    'dist/main/index.js',
    'dist/preload/index.js',
    'dist/renderer'
  ];
  
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      if (fs.statSync(file).isDirectory()) {
        success(`Directory exists: ${file}`);
      } else {
        const stats = fs.statSync(file);
        success(`File exists: ${file} (${stats.size} bytes)`);
      }
    } else {
      error(`Missing required file/directory: ${file}`);
      throw new Error(`Build verification failed: ${file} not found`);
    }
  }
}

function packageApplication() {
  log('Packaging Windows application...');
  
  try {
    execSync('npm run make', { stdio: 'inherit' });
    success('Application packaged successfully');
  } catch (err) {
    error(`Packaging failed: ${err.message}`);
    throw err;
  }
}

// Main execution
if (require.main === module) {
  try {
    log('Starting clean Windows build process...');
    
    verifyPlatform();
    cleanEnvironment();
    rebuildNativeModules();
    verifyNativeModules();
    buildApplication();
    verifyBuildOutput();
    packageApplication();
    
    success('🎉 Clean Windows build completed successfully!');
    
  } catch (err) {
    error(`Build process failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  cleanEnvironment,
  verifyPlatform,
  rebuildNativeModules,
  verifyNativeModules,
  buildApplication,
  verifyBuildOutput,
  packageApplication
};