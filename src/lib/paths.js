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
}

export function authRedirectUrl(path) {
  return `${window.location.origin}${path}`
}

export function ownerProfilePath(item) {
  if (item?.staff_id) return paths.staffProfile(item.staff_id)
  if (item?.site_id) return paths.siteProfile(item.site_id)
  return paths.home
}
