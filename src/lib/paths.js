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

export function ownerRequirementPath(item) {
  const pathname = ownerProfilePath(item)
  if (pathname === paths.home) return pathname

  const extra =
    String(item?.typeName ?? '').trim().toLowerCase() === 'other' && item?.id

  return {
    pathname,
    search: '?tab=requirements',
    hash: extra
      ? `#requirement-extra-${item.id}`
      : item?.requirement_type_id
        ? `#requirement-${item.requirement_type_id}`
        : '',
  }
}

export function isExpiringAttentionPath(search) {
  return new URLSearchParams(search).get('status') === 'expiring'
}

export function isSitesPath(pathname) {
  return pathname === paths.sites || pathname.startsWith(`${paths.sites}/`)
}
