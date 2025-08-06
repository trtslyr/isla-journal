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
    icon: process.cwd() + '/build/icon', // Will use icon.ico, icon.icns, icon.png automatically
    // Force icon usage
    overwrite: true,
    // ASAR unpacking for native modules and renderer assets
    asarUnpack: [
      '**/node_modules/better-sqlite3/**/*',
      '**/node_modules/systeminformation/**/*',
      '**/node_modules/@electron/**/*'
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
  // Removed cross-compilation hooks - building natively on each platform instead
  makers: [
    // Windows - Squirrel Installer (.exe)
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'isla_journal',
        authors: 'Taylor Wall',
        description: 'AI-powered offline journal and writing companion',
        setupExe: 'IslaJournalSetup.exe',
        setupIcon: process.cwd() + '/build/icon.ico'
      },
    },
    // macOS - DMG installer
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        name: 'Isla Journal',
        title: 'Isla Journal Installer',
        icon: process.cwd() + '/build/icon.icns',
        format: 'UDZO'
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
