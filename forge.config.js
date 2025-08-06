const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Isla Journal',
    executableName: 'isla-journal',
    appBundleId: 'com.taylorwall.isla-journal',
    appVersion: '0.1.0',
    buildVersion: '1',
    appCopyright: 'Copyright © 2025 Taylor Wall',
    // Icon configuration for all platforms
    icon: './build/icon', // Will use icon.ico, icon.icns, icon.png automatically
    // Force icon usage
    overwrite: true,
    // ASAR unpacking for native modules and renderer assets
    asarUnpack: [
      '**/node_modules/better-sqlite3/**/*',
      '**/node_modules/systeminformation/**/*'
    ]
  },
  rebuildConfig: {
    // Force rebuild of native modules for target platform
    force: true,
    // Use release builds for better performance and compatibility
    debug: false,
    // Ensure proper cross-platform rebuilding
    onlyModules: ['better-sqlite3', 'systeminformation']
  },
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, electronVersion, platform, arch) => {
      console.log(`🔧 PackageAfterCopy hook: Rebuilding for ${platform}-${arch}`);
      console.log(`🔧 Build path: ${buildPath}`);
      
      const { execSync } = require('child_process');
      const path = require('path');
      const fs = require('fs');
      
      // Clean better-sqlite3 build directory in the copied app
      const betterSqliteBuildPath = path.join(buildPath, 'node_modules', 'better-sqlite3', 'build');
      if (fs.existsSync(betterSqliteBuildPath)) {
        fs.rmSync(betterSqliteBuildPath, { recursive: true, force: true });
        console.log('🧹 Cleaned better-sqlite3 build directory in copied app');
      }
      
      // Also clean the bin directory with wrong platform binaries
      const betterSqliteBinPath = path.join(buildPath, 'node_modules', 'better-sqlite3', 'bin');
      if (fs.existsSync(betterSqliteBinPath)) {
        fs.rmSync(betterSqliteBinPath, { recursive: true, force: true });
        console.log('🧹 Cleaned better-sqlite3 bin directory');
      }
      
      // Rebuild for target platform in the copied app directory
      try {
        const env = {
          ...process.env,
          npm_config_target_platform: platform,
          npm_config_target_arch: arch,
          npm_config_runtime: 'electron',
          npm_config_build_from_source: 'true',
          npm_config_electron_version: electronVersion
        };
        
        console.log(`🔨 Rebuilding native modules for ${platform}-${arch} in copied app...`);
        execSync(`npx @electron/rebuild --version=${electronVersion} --platform=${platform} --arch=${arch}`, { 
          stdio: 'inherit',
          cwd: buildPath,
          env
        });
        console.log(`✅ Successfully rebuilt for ${platform}-${arch}`);
      } catch (error) {
        console.error(`❌ Failed to rebuild for ${platform}-${arch}:`, error.message);
        throw error;
      }
    }
  },
  makers: [
    // Windows - Squirrel Installer (.exe)
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'isla_journal',
        authors: 'Taylor Wall',
        description: 'AI-powered offline journal and writing companion',
        setupExe: 'IslaJournalSetup.exe',
        setupIcon: './build/icon.ico'
      },
    },
    // macOS - DMG installer
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Isla Journal',
        title: 'Isla Journal Installer'
      }
    },
    // macOS - ZIP backup
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    }
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'trtslyr',
          name: 'isla-journal'
        },
        prerelease: false,
        draft: true
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {
        // Ensure better-sqlite3 is rebuilt for target platform
        unpackDir: 'node_modules',
        // Force rebuild
        rebuild: true,
        // Specify modules that need platform-specific rebuilding
        nativeModules: ['better-sqlite3', 'systeminformation']
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
