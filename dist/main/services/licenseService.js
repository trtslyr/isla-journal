"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LicenseService = void 0;
const database_1 = require("../database");
class LicenseService {
    static getInstance() {
        if (!LicenseService.instance) {
            LicenseService.instance = new LicenseService();
        }
        return LicenseService.instance;
    }
    constructor() {
        this.mainWindow = null;
        this.validationInProgress = false;
        // Production backend URL on Railway
        this.backendUrl = process.env.LICENSE_BACKEND_URL || 'https://islajournalbackend-production.up.railway.app';
    }
    setMainWindow(window) {
        this.mainWindow = window;
    }
    /**
     * Validate license key with backend server
     */
    async validateLicense(licenseKey) {
        if (this.validationInProgress) {
            throw new Error('License validation already in progress');
        }
        this.validationInProgress = true;
        try {
            console.log('🔐 [LicenseService] Validating license with backend...');
            const response = await fetch(`${this.backendUrl}/validate-license`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ license_key: licenseKey })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            if (data.success && data.license) {
                // Store valid license in local database
                await this.storeLicenseLocally(licenseKey, data.license);
                console.log('✅ [LicenseService] License validated and stored');
                return {
                    success: true,
                    license: data.license
                };
            }
            else {
                console.log('❌ [LicenseService] License validation failed:', data.error);
                return {
                    success: false,
                    error: data.error || 'Invalid license key'
                };
            }
        }
        catch (error) {
            console.error('❌ [LicenseService] Network error during validation:', error);
            // Check if we have a cached valid license for offline use
            const cachedStatus = await this.getCachedLicenseStatus(licenseKey);
            if (cachedStatus.isValid) {
                console.log('🔄 [LicenseService] Using cached license due to network error');
                return {
                    success: true,
                    license: {
                        type: cachedStatus.licenseType,
                        status: 'active'
                    }
                };
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Network error'
            };
        }
        finally {
            this.validationInProgress = false;
        }
    }
    /**
     * Get current license status from local storage
     */
    async getCurrentLicenseStatus() {
        try {
            const licenseKey = database_1.database.getSetting('license_key');
            if (!licenseKey) {
                return {
                    isValid: false,
                    licenseType: null,
                    lastValidated: new Date().toISOString()
                };
            }
            return await this.getCachedLicenseStatus(licenseKey);
        }
        catch (error) {
            console.error('❌ [LicenseService] Error getting license status:', error);
            return {
                isValid: false,
                licenseType: null,
                lastValidated: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * Check if license needs revalidation based on type
     */
    async shouldRevalidate() {
        const status = await this.getCurrentLicenseStatus();
        if (!status.isValid || !status.licenseType) {
            return true;
        }
        // Lifetime licenses never need revalidation
        if (status.licenseType === 'lifetime') {
            return false;
        }
        const lastValidated = new Date(status.lastValidated);
        const now = new Date();
        // Monthly licenses: revalidate every 30 days
        if (status.licenseType === 'monthly') {
            const daysSinceValidation = Math.floor((now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceValidation >= 30;
        }
        // Annual licenses: revalidate every 365 days
        if (status.licenseType === 'annual') {
            const daysSinceValidation = Math.floor((now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceValidation >= 365;
        }
        return true;
    }
    /**
     * Perform automatic license check on app startup
     */
    async performStartupLicenseCheck() {
        try {
            const licenseKey = database_1.database.getSetting('license_key');
            if (!licenseKey) {
                console.log('🔓 [LicenseService] No license key found');
                return false;
            }
            const shouldRevalidate = await this.shouldRevalidate();
            if (!shouldRevalidate) {
                console.log('✅ [LicenseService] License still valid, no revalidation needed');
                return true;
            }
            console.log('🔄 [LicenseService] License needs revalidation...');
            const result = await this.validateLicense(licenseKey);
            return result.success;
        }
        catch (error) {
            console.error('❌ [LicenseService] Startup license check failed:', error);
            // Check cached license as fallback
            const cachedStatus = await this.getCurrentLicenseStatus();
            return cachedStatus.isValid;
        }
    }
    /**
     * Store license information locally
     */
    async storeLicenseLocally(licenseKey, license) {
        try {
            database_1.database.setSetting('license_key', licenseKey);
            database_1.database.setSetting('license_type', license.type);
            database_1.database.setSetting('license_status', license.status);
            database_1.database.setSetting('license_validated_at', new Date().toISOString());
            if (license.expires_at) {
                database_1.database.setSetting('license_expires_at', license.expires_at);
            }
            console.log('💾 [LicenseService] License stored locally');
        }
        catch (error) {
            console.error('❌ [LicenseService] Failed to store license locally:', error);
            throw error;
        }
    }
    /**
     * Get cached license status
     */
    async getCachedLicenseStatus(licenseKey) {
        try {
            const storedKey = database_1.database.getSetting('license_key');
            if (storedKey !== licenseKey) {
                return {
                    isValid: false,
                    licenseType: null,
                    lastValidated: new Date().toISOString()
                };
            }
            const licenseType = database_1.database.getSetting('license_type');
            const licenseStatus = database_1.database.getSetting('license_status');
            const lastValidated = database_1.database.getSetting('license_validated_at') || new Date().toISOString();
            const expiresAt = database_1.database.getSetting('license_expires_at');
            const isValid = licenseStatus === 'active';
            return {
                isValid,
                licenseType,
                expiresAt,
                lastValidated
            };
        }
        catch (error) {
            console.error('❌ [LicenseService] Error reading cached license:', error);
            return {
                isValid: false,
                licenseType: null,
                lastValidated: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Cache read error'
            };
        }
    }
    /**
     * Clear stored license (logout)
     */
    async clearLicense() {
        try {
            database_1.database.setSetting('license_key', '');
            database_1.database.setSetting('license_type', '');
            database_1.database.setSetting('license_status', '');
            database_1.database.setSetting('license_validated_at', '');
            database_1.database.setSetting('license_expires_at', '');
            console.log('🗑️ [LicenseService] License cleared');
        }
        catch (error) {
            console.error('❌ [LicenseService] Error clearing license:', error);
            throw error;
        }
    }
    /**
     * Set backend URL (for development/testing)
     */
    setBackendUrl(url) {
        this.backendUrl = url;
        console.log('🔧 [LicenseService] Backend URL set to:', url);
    }
}
exports.LicenseService = LicenseService;
//# sourceMappingURL=licenseService.js.map