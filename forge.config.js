// Derive notarization configuration from environment variables.
// Supports either App Store Connect API key or Apple ID + app-specific password.
const useApiKey = !!(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
const useAppleId = !!(process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD)

const osxNotarize = useApiKey
  ? {
      tool: 'notarytool',
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
      teamId: process.env.CSC_TEAM_ID || '85H5F442V2',
    }
  : useAppleId
  ? {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.CSC_TEAM_ID || '85H5F442V2',
    }
  : undefined

module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'build/icon',
    osxSign: {
      identity: process.env.CSC_NAME || 'Developer ID Application',
      'hardened-runtime': true,
      entitlements: 'build/entitlements.mac.plist',
      'entitlements-inherit': 'build/entitlements.mac.inherit.plist',
      'gatekeeper-assess': false,
    },
    // Only enable notarization if credentials are provided via env vars
    ...(osxNotarize ? { osxNotarize } : {}),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'IslaJournal',
        setupExe: 'IslaJournal-Setup.exe',
        setupIcon: 'build/icon.ico',
        loadingGif: undefined,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
}