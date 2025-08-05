import { BrowserWindow } from 'electron';
export interface LicenseStatus {
    isValid: boolean;
    licenseType: 'lifetime' | 'monthly' | 'annual' | null;
    expiresAt?: string;
    lastValidated: string;
    error?: string;
}
export interface LicenseValidationResponse {
    success: boolean;
    license?: {
        type: 'lifetime' | 'monthly' | 'annual';
        status: 'active' | 'expired' | 'cancelled';
        expires_at?: string;
    };
    error?: string;
}
export declare class LicenseService {
    private static instance;
    private mainWindow;
    private backendUrl;
    private validationInProgress;
    static getInstance(): LicenseService;
    private constructor();
    setMainWindow(window: BrowserWindow): void;
    /**
     * Validate license key with backend server
     */
    validateLicense(licenseKey: string): Promise<LicenseValidationResponse>;
    /**
     * Get current license status from local storage
     */
    getCurrentLicenseStatus(): Promise<LicenseStatus>;
    /**
     * Check if license needs revalidation based on type
     */
    shouldRevalidate(): Promise<boolean>;
    /**
     * Perform automatic license check on app startup
     */
    performStartupLicenseCheck(): Promise<boolean>;
    /**
     * Store license information locally
     */
    private storeLicenseLocally;
    /**
     * Get cached license status
     */
    private getCachedLicenseStatus;
    /**
     * Clear stored license (logout)
     */
    clearLicense(): Promise<void>;
    /**
     * Set backend URL (for development/testing)
     */
    setBackendUrl(url: string): void;
}
//# sourceMappingURL=licenseService.d.ts.map