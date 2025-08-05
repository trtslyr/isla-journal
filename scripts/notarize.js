const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASS) {
    console.log('⚠️  Skipping notarization: APPLE_ID or APPLE_ID_PASS not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log('🍎 Notarizing macOS app...');

  try {
    await notarize({
      appBundleId: 'com.taylorwall.isla-journal',
      appPath: `${appOutDir}/${appName}.app`,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASS,
    });
    
    console.log('✅ Notarization successful');
  } catch (error) {
    console.error('❌ Notarization failed:', error);
    throw error;
  }
}; 