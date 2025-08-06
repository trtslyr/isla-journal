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
    overwrite: true
  },
  rebuildConfig: {
    // Force rebuild of native modules for target platform
    force: true,
    // Debug rebuild process
    debug: true
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
        rebuild: true
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
