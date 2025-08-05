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
export interface LicenseInfo {
    valid: boolean;
    licenseType?: 'lifetime' | 'monthly' | 'annual';
    customerName?: string;
    planType?: string;
    expiresAt?: string;
    grantedAt?: string;
    neverExpires?: boolean;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map