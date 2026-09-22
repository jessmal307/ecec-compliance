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
  security: '/security',
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

export function attentionStatusFilter(search) {
  const status = new URLSearchParams(search).get('status')
  if (status === 'expiring' || status === 'expired') return status
  return null
}

export function isExpiringAttentionPath(search) {
  return attentionStatusFilter(search) === 'expiring'
}

export function isExpiredAttentionPath(search) {
  return attentionStatusFilter(search) === 'expired'
}

export function isSitesPath(pathname) {
  return pathname === paths.sites || pathname.startsWith(`${paths.sites}/`)
}

export function isCompliancePath(pathname) {
  return pathname === paths.compliance
}

export function isSettingsNavPath(pathname) {
  return (
    pathname === paths.settings ||
    pathname === paths.requirements ||
    pathname === paths.privacy ||
    pathname === paths.terms ||
    pathname === paths.security
  )
}

export function complianceHref(tab) {
  if (tab === 'items') return { pathname: paths.compliance, search: '?tab=items' }
  if (tab === 'calendar') {
    return { pathname: paths.compliance, search: '?tab=calendar' }
  }
  return paths.compliance
}

export function settingsHref(tab) {
  if (!tab || tab === 'account') return paths.settings
  return { pathname: paths.settings, search: `?tab=${tab}` }
}
