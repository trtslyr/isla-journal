// License type determination based on key prefixes
export const getLicenseType = (licenseKey: string): 'lifetime' | 'subscription' | 'invalid' => {
  if (licenseKey.startsWith('ij_life_')) {
    return 'lifetime';
  } else if (licenseKey.startsWith('ij_sub_')) {
    return 'subscription';
  } else {
    return 'invalid';
  }
}

export const isValidLicenseFormat = (licenseKey: string): boolean => {
  return getLicenseType(licenseKey) !== 'invalid';
}

export const getLicenseDisplayType = (licenseKey: string): string => {
  const type = getLicenseType(licenseKey);
  switch (type) {
    case 'lifetime':
      return 'Lifetime License';
    case 'subscription':
      return 'Subscription License';
    default:
      return 'Invalid License';
  }
} 