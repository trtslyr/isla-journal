import { ValidationResult } from './licenseValidation';

export class LicenseStorage {
  private static readonly LICENSE_KEY = 'license_key';
  private static readonly LICENSE_DATA = 'license_data';

  // Store validated license
  static storeLicense(licenseKey: string, validationResult: ValidationResult): void {
    localStorage.setItem(this.LICENSE_KEY, licenseKey);
    localStorage.setItem(this.LICENSE_DATA, JSON.stringify(validationResult));
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
    
    // For subscriptions, revalidate daily
    const lastValidated = new Date(validationResult.expiresAt || 0);
    const now = new Date();
    const daysSinceValidation = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);
    
    return daysSinceValidation > 1;
  }

  // Clear stored license
  static clearLicense(): void {
    localStorage.removeItem(this.LICENSE_KEY);
    localStorage.removeItem(this.LICENSE_DATA);
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