#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

/**
 * Download Windows prebuilt binaries from npm registry
 */

async function downloadWindowsBinaries() {
  console.log('🔧 Downloading Windows prebuilt binaries...');
  
  const betterSqliteDir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
  const buildDir = path.join(betterSqliteDir, 'build', 'Release');
  
  // Create build directory
  fs.mkdirSync(buildDir, { recursive: true });
  
  try {
    // Use npm to install the Windows prebuilt binary
    console.log('📦 Installing Windows prebuilt binary via npm...');
    
    const env = {
      ...process.env,
      npm_config_target_platform: 'win32',
      npm_config_target_arch: 'x64',
      npm_config_runtime: 'electron'
    };
    
    // Force reinstall better-sqlite3 with Windows platform
    execSync('npm uninstall better-sqlite3', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    execSync('npm install better-sqlite3 --platform=win32 --arch=x64', { 
      stdio: 'inherit', 
      cwd: path.join(__dirname, '..'),
      env 
    });
    
    console.log('✅ Windows binaries installed successfully!');
    
    // Verify the binaries
    const binaryPath = path.join(buildDir, 'better_sqlite3.node');
    if (fs.existsSync(binaryPath)) {
      console.log('✅ Found better_sqlite3.node binary');
      // Check if it's a Windows binary
      try {
        const result = execSync(`file "${binaryPath}"`, { encoding: 'utf8' });
        console.log('🔍 Binary type:', result.trim());
      } catch (error) {
        console.log('⚠️  Could not determine binary type');
      }
    } else {
      console.log('⚠️  better_sqlite3.node not found, checking other locations...');
      
      // Check for prebuilt binaries in bin directory
      const binDir = path.join(betterSqliteDir, 'bin');
      if (fs.existsSync(binDir)) {
        const binFiles = fs.readdirSync(binDir, { recursive: true });
        console.log('📁 Available prebuilt binaries:');
        binFiles.forEach(file => {
          if (file.endsWith('.node')) {
            console.log(`  - ${file}`);
          }
        });
        
        // Look for Windows binary
        const windowsBinary = binFiles.find(file => 
          file.includes('win32') && file.includes('x64') && file.endsWith('.node')
        );
        
        if (windowsBinary) {
          const srcPath = path.join(binDir, windowsBinary);
          const destPath = path.join(buildDir, 'better_sqlite3.node');
          fs.copyFileSync(srcPath, destPath);
          console.log(`✅ Copied Windows binary: ${windowsBinary}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to install Windows binaries:', error.message);
    
    // Fallback: try to download directly from better-sqlite3 releases
    console.log('🔄 Trying fallback method...');
    await downloadFromGithub();
  }
}

async function downloadFromGithub() {
  console.log('📥 Attempting to download from GitHub releases...');
  
  // Get better-sqlite3 version
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'package.json'), 
    'utf8'
  ));
  
  console.log(`📦 better-sqlite3 version: ${packageJson.version}`);
  console.log('⚠️  Manual download not implemented yet.');
  console.log('💡 Suggestion: Use the CI environment for proper Windows builds.');
}

// Main execution
if (require.main === module) {
  downloadWindowsBinaries().catch(console.error);
}

module.exports = { downloadWindowsBinaries };