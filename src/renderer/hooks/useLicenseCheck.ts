import { useEffect, useState } from 'react';
import { LicenseValidator, ValidationResult } from '../services/licenseValidation';
import { LicenseStorage } from '../services/licenseStorage';

export const useLicenseCheck = () => {
  const [licenseStatus, setLicenseStatus] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkLicense = async () => {
      try {
        // Check for stored license
        const stored = LicenseStorage.getStoredLicense();
        
        if (stored) {
          // Check if we need to revalidate
          if (LicenseStorage.needsRevalidation(stored.data)) {
            // Revalidate with backend
            const freshResult = await LicenseValidator.validateLicense(stored.key);
            
            if (freshResult.valid) {
              LicenseStorage.storeLicense(stored.key, freshResult);
              setLicenseStatus(freshResult);
            } else {
              // License no longer valid
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

    checkLicense();
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
    isLicensed: licenseStatus?.valid || false
  };
}; 