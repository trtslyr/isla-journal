import { BrowserWindow } from 'electron';
export interface LicenseValidationResult {
    valid: boolean;
    reason?: string;
    license_type?: 'lifetime' | 'subscription';
    customer_name?: string;
    never_expires?: boolean;
    granted_at?: string;
    plan_type?: string;
    expires_at?: string;
    next_validation?: string;
}
export interface LicenseState {
    status: 'unlicensed' | 'active' | 'expired' | 'invalid';
    license_type?: 'lifetime' | 'subscription';
    license_key?: string;
    last_validated?: string;
    next_validation?: string;
    customer_name?: string;
    expires_at?: string;
}
export interface PaymentLinks {
    monthly: string;
    annual: string;
    lifetime: string;
    portal: string;
}
export declare class LicenseService {
    private static instance;
    private licenseServer;
    private mainWindow;
    private isInitialized;
    private validationTimer;
    static getInstance(): LicenseService;
    private constructor();
    setMainWindow(window: BrowserWindow): void;
    /**
     * Initialize the license service
     */
    initialize(): Promise<void>;
    /**
     * Validate a license key
     */
    validateLicense(licenseKey: string): Promise<LicenseValidationResult>;
    /**
     * Get current license state
     */
    getCurrentLicenseState(): Promise<LicenseState>;
    /**
     * Check if app is licensed and operational
     */
    isAppLicensed(): Promise<boolean>;
    /**
     * Start automatic validation timer for subscription licenses
     */
    private startValidationTimer;
    /**
     * Get payment links for purchasing licenses
     */
    getPaymentLinks(): PaymentLinks;
    /**
     * Open payment link in user's browser
     */
    openPaymentLink(linkType: 'monthly' | 'annual' | 'lifetime' | 'portal'): Promise<void>;
    /**
     * Show license enforcement dialog
     */
    showLicenseDialog(): Promise<void>;
    /**
     * Lock the app due to invalid license
     */
    lockApp(reason: string): Promise<void>;
    /**
     * Unlock the app after successful license validation
     */
    unlockApp(): Promise<void>;
    /**
     * Perform startup license check
     */
    performStartupCheck(): Promise<boolean>;
    /**
     * Clear current license (for testing or license reset)
     */
    clearLicense(): Promise<void>;
    /**
     * Get license usage statistics
     */
    getLicenseStats(): Promise<any>;
    /**
     * Stop validation timer and cleanup
     */
    cleanup(): void;
}
//# sourceMappingURL=licenseService.d.ts.map