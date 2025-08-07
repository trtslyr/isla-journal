#!/usr/bin/env node

/**
 * Windows Build Configuration
 * 
 * This script configures the build environment specifically for Windows,
 * ensuring proper native module compilation and platform-specific settings.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(message) {
  console.log(`🪟 [Windows Config] ${message}`);
}

function error(message) {
  console.error(`❌ [Windows Config] ${message}`);
}

function success(message) {
  console.log(`✅ [Windows Config] ${message}`);
}

function verifyWindowsEnvironment() {
  log('Verifying Windows build environment...');
  
  if (process.platform !== 'win32') {
    error('This script must be run on Windows!');
    process.exit(1);
  }
  
  // Check for required build tools
  try {
    const pythonVersion = execSync('python --version', { encoding: 'utf8' }).trim();
    log(`Python: ${pythonVersion}`);
  } catch (err) {
    error('Python not found - required for native module compilation');
    log('Install Python from https://python.org or run: npm install --global windows-build-tools');
    process.exit(1);
  }
  
  // Check for Visual Studio Build Tools
  try {
    const clVersion = execSync('cl', { encoding: 'utf8' }).split('\n')[0];
    log(`Visual Studio: ${clVersion}`);
  } catch (err) {
    log('Visual Studio Build Tools not found in PATH');
    log('Consider installing: npm install --global windows-build-tools');
  }
  
  success('Windows environment verified');
}

function configureEnvironment() {
  log('Configuring Windows build environment...');
  
  // Set Windows-specific environment variables
  process.env.npm_config_target_platform = 'win32';
  process.env.npm_config_target_arch = 'x64';
  process.env.npm_config_build_from_source = 'true';
  process.env.npm_config_electron_cache = '';
  process.env.npm_config_cache = '';
  
  // Set Python path for node-gyp
  try {
    const pythonPath = execSync('where python', { encoding: 'utf8' }).trim().split('\n')[0];
    process.env.PYTHON = pythonPath;
    log(`Python path: ${pythonPath}`);
  } catch (err) {
    log('Could not determine Python path automatically');
  }
  
  success('Environment configured for Windows');
}

function cleanNativeModules() {
  log('Cleaning existing native modules...');
  
  const nativeModulePaths = [
    'node_modules/better-sqlite3/build/Release',
    'node_modules/systeminformation/build/Release'
  ];
  
  for (const modulePath of nativeModulePaths) {
    if (fs.existsSync(modulePath)) {
      try {
        fs.rmSync(modulePath, { recursive: true, force: true });
        log(`Cleaned: ${modulePath}`);
      } catch (err) {
        log(`Warning: Could not clean ${modulePath}: ${err.message}`);
      }
    }
  }
  
  success('Native modules cleaned');
}

function rebuildNativeModules() {
  log('Rebuilding native modules for Windows...');
  
  try {
    // Rebuild better-sqlite3 from source
    log('Building better-sqlite3...');
    execSync('npm rebuild better-sqlite3 --build-from-source --verbose', { 
      stdio: 'inherit',
      env: process.env
    });
    
    // Rebuild systeminformation
    log('Building systeminformation...');
    execSync('npm rebuild systeminformation --verbose', { 
      stdio: 'inherit',
      env: process.env
    });
    
    // Use @electron/rebuild for all modules
    log('Running @electron/rebuild...');
    execSync('npx @electron/rebuild --verbose --force --arch=x64', { 
      stdio: 'inherit',
      env: process.env
    });
    
    success('Native modules rebuilt successfully');
    
  } catch (err) {
    error(`Failed to rebuild native modules: ${err.message}`);
    throw err;
  }
}

function verifyNativeModules() {
  log('Verifying native modules...');
  
  const modules = [
    {
      name: 'better-sqlite3',
      path: 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    },
    {
      name: 'systeminformation',
      path: 'node_modules/systeminformation/build/Release/systeminformation.node'
    }
  ];
  
  for (const module of modules) {
    if (fs.existsSync(module.path)) {
      const stats = fs.statSync(module.path);
      success(`${module.name}: ${stats.size} bytes`);
      
      // Test loading
      try {
        require(module.name);
        success(`${module.name} loads successfully`);
      } catch (err) {
        error(`${module.name} failed to load: ${err.message}`);
        throw err;
      }
    } else {
      error(`${module.name} binary not found`);
      throw new Error(`${module.name} binary missing`);
    }
  }
}

// Main execution
if (require.main === module) {
  try {
    log('Starting Windows build configuration...');
    
    verifyWindowsEnvironment();
    configureEnvironment();
    cleanNativeModules();
    rebuildNativeModules();
    verifyNativeModules();
    
    success('🎉 Windows build configuration completed successfully!');
    
  } catch (err) {
    error(`Configuration failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  verifyWindowsEnvironment,
  configureEnvironment,
  cleanNativeModules,
  rebuildNativeModules,
  verifyNativeModules
}; 