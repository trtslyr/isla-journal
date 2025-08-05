import { ValidationResult } from './licenseValidation';

export class LicenseStorage {
  private static readonly LICENSE_KEY = 'license_key';
  private static readonly LICENSE_DATA = 'license_data';
  private static readonly LAST_VALIDATION = 'license_last_validation';

  // Store validated license
  static storeLicense(licenseKey: string, validationResult: ValidationResult): void {
    localStorage.setItem(this.LICENSE_KEY, licenseKey);
    localStorage.setItem(this.LICENSE_DATA, JSON.stringify(validationResult));
    localStorage.setItem(this.LAST_VALIDATION, new Date().toISOString());
  }

  // Get stored license
  static getStoredLicense(): { key: string; data: ValidationResult } | null {
    const key = localStorage.getItem(this.LICENSE_KEY);
    const dataStr = localStorage.getItem(this.LICENSE_DATA);
    
    if (key && dataStr) {
      try {
        const data = JSON.parse(dataStr);
        return { key, data };
      } catch (error) {
        console.error('Error parsing stored license data:', error);
      }
    }
    
    return null;
  }

  // Check if license needs revalidation
  static needsRevalidation(validationResult: ValidationResult): boolean {
    if (validationResult.licenseType === 'lifetime') {
      return false; // Lifetime licenses never need revalidation
    }
    
    const now = new Date();
    
    // Check if subscription has expired
    if (validationResult.licenseType === 'subscription' && validationResult.expiresAt) {
      const expiresAt = new Date(validationResult.expiresAt);
      if (now > expiresAt) {
        return true; // License expired, needs revalidation
      }
    }
    
    // For active subscriptions, revalidate daily to check server status
    const lastValidatedStr = localStorage.getItem(this.LAST_VALIDATION);
    if (lastValidatedStr) {
      const lastValidated = new Date(lastValidatedStr);
      const daysSinceValidation = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceValidation > 1; // Revalidate every 24 hours
    }
    
    return true; // No validation timestamp, needs revalidation
  }

  // Clear stored license
  static clearLicense(): void {
    localStorage.removeItem(this.LICENSE_KEY);
    localStorage.removeItem(this.LICENSE_DATA);
    localStorage.removeItem(this.LAST_VALIDATION);
  }

  // Get license status for display
  static getLicenseStatus(): 'valid' | 'expired' | 'none' {
    const stored = this.getStoredLicense();
    if (!stored) return 'none';
    
    if (!stored.data.valid) return 'expired';
    
    // Check if subscription is expired
    if (stored.data.licenseType === 'subscription' && stored.data.expiresAt) {
      const expiresAt = new Date(stored.data.expiresAt);
      const now = new Date();
      if (now > expiresAt) return 'expired';
    }
    
    return 'valid';
  }
} 