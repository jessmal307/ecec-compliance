export const paths = {
  home: '/',
  staff: '/staff',
  newStaff: '/staff/new',
  staffProfile: (staffId) => `/staff/${staffId}`,
  sites: '/sites',
  siteProfile: (siteId) => `/sites/${siteId}`,
  compliance: '/compliance',
  requirements: '/requirements',
  gaps: '/gaps',
  attention: '/attention',
  settings: '/settings',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  privacy: '/privacy',
  terms: '/terms',
}

export function authRedirectUrl(path) {
  return `${window.location.origin}${path}`
}

export function ownerProfilePath(item) {
  if (item?.staff_id) return paths.staffProfile(item.staff_id)
  if (item?.site_id) return paths.siteProfile(item.site_id)
  return paths.home
}

export function isSitesPath(pathname) {
  return pathname === paths.sites || pathname.startsWith(`${paths.sites}/`)
}
