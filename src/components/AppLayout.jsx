import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Building2,
  ClipboardCheck,
  Ellipsis,
  FileText,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FeedbackButton } from './FeedbackDialog'
import { SitesSidebarItem } from './SitesNav'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { getOrganization } from '../lib/organizations'
import { can } from '../lib/plans'
import {
  isCompliancePath,
  isExpiredAttentionPath,
  isExpiringAttentionPath,
  isFormsPath,
  isRecheckAttentionPath,
  isSettingsNavPath,
  isSitesPath,
  paths,
} from '../lib/paths'

const SIDEBAR_COLLAPSED_KEY = 'ecec-sidebar-collapsed'

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Ignore quota / private-mode failures.
  }
}

const pages = [
  { to: paths.home, label: 'Overview', icon: LayoutDashboard, end: true },
  { to: paths.compliance, label: 'Compliance', icon: ClipboardCheck },
  { to: paths.forms, label: 'Forms', icon: FileText },
  { to: paths.staff, label: 'Staff', icon: Users },
  { to: paths.sites, label: 'Sites', icon: Building2 },
  { to: paths.settings, label: 'Settings', icon: Settings },
]

function pageTitle(pathname, search = '') {
  if (pathname === paths.home) return 'Overview'
  if (pathname === paths.compliance) return 'Compliance'
  if (pathname === paths.forms) return 'Forms'
  if (pathname.startsWith(`${paths.forms}/submissions/`)) return 'Submission'
  if (pathname.endsWith('/complete')) return 'Complete form'
  if (pathname.startsWith(`${paths.forms}/`)) return 'Form preview'
  if (pathname === paths.staff) return 'Staff'
  if (pathname === paths.newStaff) return 'New staff'
  if (pathname === paths.importStaff) return 'Import staff'
  if (pathname.startsWith(`${paths.staff}/`)) return 'Staff profile'
  if (pathname === paths.sites) return 'Sites'
  if (pathname.startsWith(`${paths.sites}/`)) return 'Site profile'
  if (pathname === paths.requirements) return 'Settings'
  if (pathname === paths.gaps) return 'Compliance gaps'
  if (pathname === paths.attention) {
    if (isExpiredAttentionPath(search)) return 'Expired'
    if (isExpiringAttentionPath(search)) return 'Expiring in 30 days'
    if (isRecheckAttentionPath(search)) return 'Recheck due'
    return 'Needs attention'
  }
  if (pathname === paths.settings) return 'Settings'
  if (pathname === paths.privacy) return 'Privacy & Data Handling'
  if (pathname === paths.terms) return 'Terms of Service'
  if (pathname === paths.security) return 'Data security'
  return 'ECEC'
}

function isStaffPath(pathname) {
  return pathname === paths.staff || pathname.startsWith(`${paths.staff}/`)
}

function isOverviewPath(pathname) {
  return pathname === paths.home
}

const collapsedTipClass =
  'relative after:pointer-events-none after:absolute after:top-1/2 after:left-full after:z-50 after:ml-2 after:hidden after:-translate-y-1/2 after:whitespace-nowrap after:rounded-md after:bg-popover after:px-2 after:py-1 after:text-xs after:font-medium after:text-popover-foreground after:shadow-sm after:ring-1 after:ring-foreground/10 after:content-[attr(data-label)] hover:after:block'

function navClassName(isActive, collapsed = false) {
  return [
    collapsed
      ? `flex size-11 items-center justify-center rounded-lg text-base font-medium no-underline transition-colors ${collapsedTipClass}`
      : 'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-base font-medium no-underline transition-colors md:text-sm',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
  ].join(' ')
}

function tabClassName(isActive) {
  return [
    'mx-0.5 my-0.5 flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-xs font-medium no-underline transition-colors',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
  ].join(' ')
}

function SidebarNav({ collapsed, onNavigate, showForms }) {
  const { pathname } = useLocation()
  const visiblePages = pages.filter(
    (item) => item.to !== paths.forms || showForms,
  )

  return (
    <nav
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-1 py-3',
        collapsed ? 'items-center overflow-visible px-1.5' : 'overflow-y-auto px-3 py-4',
      )}
    >
      {visiblePages.map((item) => {
        if (item.to === paths.sites) {
          return (
            <SitesSidebarItem
              key={item.to}
              collapsed={collapsed}
              onNavigate={onNavigate}
              navClassName={(isActive) => navClassName(isActive, collapsed)}
            />
          )
        }

        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-label={collapsed ? item.label : undefined}
            aria-label={item.label}
            onClick={onNavigate}
            className={({ isActive }) => {
              const active =
                item.to === paths.staff
                  ? isStaffPath(pathname)
                  : item.to === paths.forms
                    ? isFormsPath(pathname)
                    : item.to === paths.settings
                      ? isSettingsNavPath(pathname)
                      : isActive
              return navClassName(active, collapsed)
            }}
          >
            <Icon className="size-4 shrink-0" />
            {collapsed ? null : item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SidebarBrand({ collapsed, onToggle }) {
  const { user } = useAuth()
  const orgName = user?.user_metadata?.organization_name

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-b border-sidebar-border px-1.5 py-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
          <ShieldCheck className="size-4" />
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={collapsedTipClass}
          data-label="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={onToggle}
        >
          <PanelLeft />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
        <ShieldCheck className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          ECEC
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {orgName || 'Compliance'}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Collapse sidebar"
        onClick={onToggle}
      >
        <PanelLeftClose />
      </Button>
    </div>
  )
}

function BottomTabBar({
  pathname,
  moreOpen,
  onToggleMore,
  onCloseMenus,
  showForms,
}) {
  return (
    <>
      {moreOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
          aria-label="Close more menu"
          onClick={onCloseMenus}
        />
      ) : null}

      {moreOpen ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card px-2 py-2 shadow-lg md:hidden">
          {showForms ? (
            <NavLink
              to={paths.forms}
              onClick={onCloseMenus}
              className={navClassName(isFormsPath(pathname))}
            >
              <FileText className="size-4 shrink-0" />
              Forms
            </NavLink>
          ) : null}
          <NavLink
            to={paths.settings}
            onClick={onCloseMenus}
            className={({ isActive }) =>
              navClassName(isActive || isSettingsNavPath(pathname))
            }
          >
            <Settings className="size-4 shrink-0" />
            Settings
          </NavLink>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid min-h-14 grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        <NavLink
          to={paths.home}
          end
          onClick={onCloseMenus}
          className={tabClassName(isOverviewPath(pathname))}
        >
          <LayoutDashboard className="size-5" />
          Overview
        </NavLink>
        <NavLink
          to={paths.compliance}
          onClick={onCloseMenus}
          className={tabClassName(isCompliancePath(pathname))}
        >
          <ClipboardCheck className="size-5" />
          Compliance
        </NavLink>
        <NavLink
          to={paths.staff}
          onClick={onCloseMenus}
          className={tabClassName(isStaffPath(pathname))}
        >
          <Users className="size-5" />
          Staff
        </NavLink>
        <NavLink
          to={paths.sites}
          onClick={onCloseMenus}
          className={tabClassName(isSitesPath(pathname))}
        >
          <Building2 className="size-5" />
          Sites
        </NavLink>
        <button
          type="button"
          className={tabClassName(
            isSettingsNavPath(pathname) || isFormsPath(pathname) || moreOpen,
          )}
          aria-expanded={moreOpen}
          aria-label="More"
          onClick={onToggleMore}
        >
          <Ellipsis className="size-5" />
          More
        </button>
      </nav>
    </>
  )
}

export function AppLayout() {
  const { signOut, user, organizationId } = useAuth()
  const { pathname, search } = useLocation()
  const [moreForPath, setMoreForPath] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [organization, setOrganization] = useState(null)
  const moreOpen = moreForPath === pathname
  const showForms = can(organization, 'forms')

  useEffect(() => {
    if (!organizationId) {
      setOrganization(null)
      return
    }

    let cancelled = false

    getOrganization(organizationId).then(({ data }) => {
      if (!cancelled) setOrganization(data)
    })

    return () => {
      cancelled = true
    }
  }, [organizationId])

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current
      writeSidebarCollapsed(next)
      return next
    })
  }

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = moreOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [moreOpen])

  function closeMenus() {
    setMoreForPath(null)
  }

  return (
    <div className="app-shell flex h-svh w-full max-w-full overflow-hidden bg-background text-left">
      <aside
        className={cn(
          'hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex',
          sidebarCollapsed
            ? 'z-30 w-14 overflow-visible'
            : 'w-[210px] overflow-hidden',
        )}
      >
        <SidebarBrand collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <SidebarNav
          collapsed={sidebarCollapsed}
          showForms={showForms}
        />
        {sidebarCollapsed ? null : (
          <div className="mt-auto shrink-0 border-t border-sidebar-border p-3">
            <FeedbackButton className="w-full" />
          </div>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 md:px-6">
          <p className="truncate text-sm font-semibold tracking-tight text-card-foreground">
            {pageTitle(pathname, search)}
          </p>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {user?.email ? (
              <Link
                to={paths.settings}
                className="hidden max-w-40 truncate text-xs text-muted-foreground underline-offset-2 hover:text-card-foreground md:block md:max-w-56 md:hover:underline"
              >
                {user.user_metadata?.display_name || user.email}
              </Link>
            ) : null}
            <FeedbackButton className="md:hidden" />
            <ThemeToggle />
            <Button type="button" variant="outline" size="sm" onClick={() => signOut()}>
              <LogOut data-icon="inline-start" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <div className="w-full min-w-0 px-4 py-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomTabBar
        pathname={pathname}
        moreOpen={moreOpen}
        onToggleMore={() => {
          setMoreForPath((current) => (current === pathname ? null : pathname))
        }}
        onCloseMenus={closeMenus}
        showForms={showForms}
      />
    </div>
  )
}
