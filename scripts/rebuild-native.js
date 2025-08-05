const { execSync } = require('child_process');
const path = require('path');

console.log('🔧 Rebuilding native dependencies...');

try {
  const rootDir = path.join(__dirname, '..');
  
  // First, ensure electron-rebuild is available
  console.log('📦 Installing electron-rebuild...');
  execSync('npm install electron-rebuild --no-save', { 
    cwd: rootDir,
    stdio: 'inherit' 
  });
  
  // Rebuild native modules for Electron
  console.log('🔨 Rebuilding native modules...');
  execSync('npx electron-rebuild', { 
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: path.join(__dirname, '..', '.npm-cache') }
  });
  
  console.log('✅ Native dependencies rebuilt successfully');
} catch (error) {
  console.warn('⚠️  Native rebuild failed, continuing anyway:', error.message);
  // Don't fail the build if rebuild fails - electron-builder will handle it
} 