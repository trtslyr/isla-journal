import { useEffect, useState } from 'react';
import { LicenseValidator, ValidationResult } from '../services/licenseValidation';
import { LicenseStorage } from '../services/licenseStorage';

export const useLicenseCheck = () => {
  const [licenseStatus, setLicenseStatus] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkLicense = async () => {
    try {
      // Check for stored license
      const stored = LicenseStorage.getStoredLicense();
      
      if (stored) {
        // Check if we need to revalidate
        if (LicenseStorage.needsRevalidation(stored.data)) {
          console.log('🔄 [License] Revalidating license...');
          // Revalidate with backend
          const freshResult = await LicenseValidator.validateLicense(stored.key);
          
          if (freshResult.valid) {
            LicenseStorage.storeLicense(stored.key, freshResult);
            setLicenseStatus(freshResult);
            console.log('✅ [License] License revalidated successfully');
          } else {
            // License no longer valid - clear and lock app
            console.log('❌ [License] License no longer valid, locking app');
            LicenseStorage.clearLicense();
            setLicenseStatus(freshResult);
          }
        } else {
          // Use cached license
          setLicenseStatus(stored.data);
        }
      } else {
        // No license found
        setLicenseStatus({ valid: false, error: 'No license found' });
      }
    } catch (error) {
      console.error('License check error:', error);
      setLicenseStatus({ valid: false, error: 'Error checking license' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkLicense();

    // Set up periodic license checking every hour
    const interval = setInterval(async () => {
      console.log('🔍 [License] Periodic license check...');
      await checkLicense();
    }, 60 * 60 * 1000); // Check every hour

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, []);

  const validateNewLicense = async (licenseKey: string) => {
    setIsLoading(true);
    try {
      const result = await LicenseValidator.validateLicense(licenseKey);
      
      if (result.valid) {
        LicenseStorage.storeLicense(licenseKey, result);
      }
      
      setLicenseStatus(result);
      return result;
    } catch (error) {
      const errorResult = { valid: false, error: 'Failed to validate license' };
      setLicenseStatus(errorResult);
      return errorResult;
    } finally {
      setIsLoading(false);
    }
  };

  const clearLicense = () => {
    LicenseStorage.clearLicense();
    setLicenseStatus({ valid: false, error: 'No license found' });  
  };

  return { 
    licenseStatus, 
    isLoading, 
    validateNewLicense, 
    clearLicense,
    recheckLicense: checkLicense, // Manual recheck function
    isLicensed: licenseStatus?.valid || false
  };
}; 