import { getLicenseType } from '../utils/licenseUtils';

// TypeScript interfaces
export interface ValidationResult {
  valid: boolean;
  licenseType?: 'lifetime' | 'subscription';
  customerName?: string;
  planType?: string;
  expiresAt?: string;
  grantedAt?: string;
  neverExpires?: boolean;
  stripeCustomerId?: string;
  subscriptionStatus?: string;
  licenseKey?: string;
  error?: string;
  isNetworkError?: boolean;
}

export class LicenseValidator {
  private static readonly BACKEND_URL = 'https://islajournalbackend-production.up.railway.app';

  // Validate any license key (determines type automatically)
  static async validateLicense(licenseKey: string): Promise<ValidationResult> {
    const keyType = getLicenseType(licenseKey);
    
    switch (keyType) {
      case 'lifetime':
        return await this.validateLifetimeKey(licenseKey);
      case 'subscription':
        return await this.validateSubscriptionKey(licenseKey);
      default:
        return {
          valid: false,
          error: 'Invalid license key format. Keys should start with ij_life_ or ij_sub_'
        };
    }
  }

  // Validate lifetime license with your backend
  static async validateLifetimeKey(licenseKey: string): Promise<ValidationResult> {
    try {
      const response = await fetch(`${this.BACKEND_URL}/validate-lifetime-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey })
      });

      const data = await response.json();

      if (data.valid) {
        return {
          valid: true,
          licenseType: 'lifetime',
          customerName: data.customer_name,
          grantedAt: data.granted_at,
          neverExpires: true,
          licenseKey: licenseKey
        };
      } else {
        return {
          valid: false,
          error: this.getErrorMessage(data.reason)
        };
      }
    } catch (error) {
      console.error('Lifetime license validation error:', error);
      return {
        valid: false,
        error: 'Network error. Please check your connection and try again.',
        isNetworkError: true
      };
    }
  }

  // Validate subscription license with your backend
  static async validateSubscriptionKey(licenseKey: string): Promise<ValidationResult> {
    try {
      const response = await fetch(`${this.BACKEND_URL}/validate-subscription-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey })
      });

      const data = await response.json();

      if (data.valid) {
        return {
          valid: true,
          licenseType: 'subscription',
          planType: data.plan_type,
          expiresAt: data.expires_at,
          stripeCustomerId: data.stripe_customer_id,
          subscriptionStatus: data.subscription_status,
          licenseKey: licenseKey
        };
      } else {
        return {
          valid: false,
          error: this.getErrorMessage(data.reason)
        };
      }
    } catch (error) {
      console.error('Subscription license validation error:', error);
      return {
        valid: false,
        error: 'Network error. Please check your connection and try again.',
        isNetworkError: true
      };
    }
  }

  // Convert backend error codes to user-friendly messages
  private static getErrorMessage(reason?: string): string {
    switch (reason) {
      case 'invalid_key':
        return 'License key is invalid or has been deactivated.';
      case 'missing_key':
        return 'Please enter a license key.';
      case 'subscription_inactive':
        return 'Subscription is no longer active. Please check your billing.';
      case 'stripe_error':
        return 'Error verifying subscription. Please contact support.';
      case 'database_error':
        return 'Server error. Please try again later.';
      default:
        return 'Invalid license key. Please check and try again.';
    }
  }
} 