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
    // Add icon paths when you have them
    // icon: './build/icon' // Will use icon.ico, icon.icns automatically
  },
  rebuildConfig: {},
  makers: [
    // Windows
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'isla_journal',
        authors: 'Taylor Wall',
        description: 'AI-powered offline journal and writing companion'
      },
    },
    // macOS
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Isla Journal',
        title: 'Isla Journal Installer'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    // Linux
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Taylor Wall',
          homepage: 'https://github.com/trtslyr/isla-journal',
          description: 'AI-powered offline journal and writing companion'
        }
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          maintainer: 'Taylor Wall',
          homepage: 'https://github.com/trtslyr/isla-journal',
          description: 'AI-powered offline journal and writing companion'
        }
      },
    },
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
      config: {},
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
