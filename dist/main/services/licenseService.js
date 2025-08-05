"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LicenseService = void 0;
const electron_1 = require("electron");
const licenseServer_1 = require("../backend/licenseServer");
class LicenseService {
    static getInstance() {
        if (!LicenseService.instance) {
            LicenseService.instance = new LicenseService();
        }
        return LicenseService.instance;
    }
    constructor() {
        this.mainWindow = null;
        this.isInitialized = false;
        this.validationTimer = null;
        this.licenseServer = new licenseServer_1.LicenseServer();
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * Initialize the license service
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            console.log('🔐 [LicenseService] Initializing...');
            // Initialize the embedded license server
            await this.licenseServer.initialize();
            // Check current license state
            const licenseState = await this.getCurrentLicenseState();
            console.log('📝 [LicenseService] Current license state:', licenseState.status);
            // Start validation timer for subscription licenses
            this.startValidationTimer();
            this.isInitialized = true;
            console.log('✅ [LicenseService] Initialized successfully');
        }
        catch (error) {
            console.error('❌ [LicenseService] Initialization failed:', error);
            throw error;
        }
    }
    /**
     * Validate a license key
     */
    async validateLicense(licenseKey) {
        if (!this.isInitialized) {
            throw new Error('LicenseService not initialized');
        }
        try {
            console.log('🔍 [LicenseService] Validating license key:', licenseKey.substring(0, 10) + '...');
            const result = await this.licenseServer.validateLicense(licenseKey);
            if (result.valid) {
                console.log('✅ [LicenseService] License validation successful:', result.license_type);
                // Notify renderer about license status change
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('license:statusChanged', {
                        status: 'active',
                        license_type: result.license_type,
                        customer_name: result.customer_name
                    });
                }
            }
            else {
                console.log('❌ [LicenseService] License validation failed:', result.reason);
            }
            return result;
        }
        catch (error) {
            console.error('❌ [LicenseService] License validation error:', error);
            return { valid: false, reason: 'validation_error' };
        }
    }
    /**
     * Get current license state
     */
    async getCurrentLicenseState() {
        if (!this.isInitialized) {
            throw new Error('LicenseService not initialized');
        }
        try {
            return await this.licenseServer.getCurrentLicenseState();
        }
        catch (error) {
            console.error('❌ [LicenseService] Error getting license state:', error);
            return {
                status: 'unlicensed',
                license_type: undefined,
                license_key: undefined
            };
        }
    }
    /**
     * Check if app is licensed and operational
     */
    async isAppLicensed() {
        try {
            const state = await this.getCurrentLicenseState();
            if (state.status === 'unlicensed') {
                return false;
            }
            // For lifetime licenses, always return true if active
            if (state.license_type === 'lifetime' && state.status === 'active') {
                return true;
            }
            // For subscription licenses, check if revalidation is needed
            if (state.license_type === 'subscription') {
                const needsRevalidation = await this.licenseServer.needsRevalidation();
                if (needsRevalidation && state.license_key) {
                    // Try to revalidate
                    const validation = await this.validateLicense(state.license_key);
                    return validation.valid;
                }
                return state.status === 'active';
            }
            return false;
        }
        catch (error) {
            console.error('❌ [LicenseService] Error checking license status:', error);
            return false;
        }
    }
    /**
     * Start automatic validation timer for subscription licenses
     */
    startValidationTimer() {
        // Check every hour if revalidation is needed
        this.validationTimer = setInterval(async () => {
            try {
                const state = await this.getCurrentLicenseState();
                if (state.license_type === 'subscription' && state.license_key) {
                    const needsRevalidation = await this.licenseServer.needsRevalidation();
                    if (needsRevalidation) {
                        console.log('⏰ [LicenseService] Automatic revalidation triggered');
                        await this.validateLicense(state.license_key);
                    }
                }
            }
            catch (error) {
                console.error('❌ [LicenseService] Validation timer error:', error);
            }
        }, 60 * 60 * 1000); // 1 hour
    }
    /**
     * Get payment links for purchasing licenses
     */
    getPaymentLinks() {
        return this.licenseServer.getPaymentLinks();
    }
    /**
     * Open payment link in user's browser
     */
    async openPaymentLink(linkType) {
        try {
            const links = this.getPaymentLinks();
            const url = links[linkType];
            if (!url || url.includes('your-')) {
                throw new Error(`Payment link for ${linkType} not configured`);
            }
            console.log(`🌐 [LicenseService] Opening ${linkType} payment link`);
            await electron_1.shell.openExternal(url);
        }
        catch (error) {
            console.error(`❌ [LicenseService] Failed to open ${linkType} payment link:`, error);
            throw error;
        }
    }
    /**
     * Show license enforcement dialog
     */
    async showLicenseDialog() {
        if (!this.mainWindow)
            return;
        // Send message to renderer to show license dialog
        this.mainWindow.webContents.send('license:showDialog', {
            title: 'License Required',
            message: 'A valid license is required to use Isla Journal. Please enter your license key or purchase a license.',
            actions: ['enter_key', 'purchase']
        });
    }
    /**
     * Lock the app due to invalid license
     */
    async lockApp(reason) {
        if (!this.mainWindow)
            return;
        console.log('🔒 [LicenseService] Locking app due to:', reason);
        // Disable all functionality except license validation
        this.mainWindow.webContents.send('license:lockApp', {
            reason,
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Unlock the app after successful license validation
     */
    async unlockApp() {
        if (!this.mainWindow)
            return;
        console.log('🔓 [LicenseService] Unlocking app');
        this.mainWindow.webContents.send('license:unlockApp', {
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Perform startup license check
     */
    async performStartupCheck() {
        try {
            console.log('🚀 [LicenseService] Performing startup license check...');
            const isLicensed = await this.isAppLicensed();
            if (!isLicensed) {
                console.log('⚠️ [LicenseService] App is not properly licensed');
                await this.showLicenseDialog();
                return false;
            }
            console.log('✅ [LicenseService] App is properly licensed');
            return true;
        }
        catch (error) {
            console.error('❌ [LicenseService] Startup check failed:', error);
            return false;
        }
    }
    /**
     * Clear current license (for testing or license reset)
     */
    async clearLicense() {
        try {
            // Update license state to unlicensed
            await this.licenseServer.updateLicenseState({
                license_key: null,
                license_type: null,
                status: 'unlicensed',
                last_validated: null,
                next_validation: null,
                customer_name: null,
                expires_at: null
            });
            console.log('🗑️ [LicenseService] License cleared');
            // Notify renderer
            if (this.mainWindow) {
                this.mainWindow.webContents.send('license:statusChanged', {
                    status: 'unlicensed'
                });
            }
        }
        catch (error) {
            console.error('❌ [LicenseService] Failed to clear license:', error);
            throw error;
        }
    }
    /**
     * Get license usage statistics
     */
    async getLicenseStats() {
        try {
            const state = await this.getCurrentLicenseState();
            return {
                current_status: state.status,
                license_type: state.license_type,
                last_validated: state.last_validated,
                next_validation: state.next_validation,
                customer_name: state.customer_name,
                expires_at: state.expires_at
            };
        }
        catch (error) {
            console.error('❌ [LicenseService] Error getting license stats:', error);
            return null;
        }
    }
    /**
     * Stop validation timer and cleanup
     */
    cleanup() {
        if (this.validationTimer) {
            clearInterval(this.validationTimer);
            this.validationTimer = null;
        }
        if (this.licenseServer) {
            this.licenseServer.close();
        }
        console.log('🧹 [LicenseService] Cleanup completed');
    }
}
exports.LicenseService = LicenseService;
//# sourceMappingURL=licenseService.js.map