const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Isla Journal with custom icon...');

// Set environment variable to force icon usage
process.env.ELECTRON_ICON = path.join(__dirname, '../build/icon.icns');

// Start the electron app
const electron = spawn('npx', ['electron-forge', 'start'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_ICON: process.env.ELECTRON_ICON }
});

electron.on('close', (code) => {
  console.log(`App exited with code ${code}`);
}); 