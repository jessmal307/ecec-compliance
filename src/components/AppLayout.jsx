import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Building2,
  ClipboardCheck,
  Ellipsis,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FeedbackButton } from './FeedbackDialog'
import { ThemeToggle } from './ThemeToggle'
import { SitesNavLinks, SitesSidebarItem } from './SitesNav'
import { useAuth } from '../hooks/useAuth'
import {
  isExpiredAttentionPath,
  isExpiringAttentionPath,
  isSitesPath,
  paths,
} from '../lib/paths'

const pages = [
  { to: paths.home, label: 'Overview', icon: LayoutDashboard, end: true },
  { to: paths.compliance, label: 'Compliance items', icon: ClipboardCheck },
  { to: paths.staff, label: 'Staff', icon: Users },
  { to: paths.sites, label: 'Sites', icon: Building2 },
  { to: paths.requirements, label: 'Requirements', icon: ListChecks },
  { to: paths.settings, label: 'Account', icon: Settings },
]

const morePages = pages.filter(
  (item) =>
    item.to !== paths.home &&
    item.to !== paths.staff &&
    item.to !== paths.sites,
)

function pageTitle(pathname, search = '') {
  if (pathname === paths.home) return 'Overview'
  if (pathname === paths.compliance) return 'Compliance items'
  if (pathname === paths.staff) return 'Staff'
  if (pathname === paths.newStaff) return 'New staff'
  if (pathname.startsWith(`${paths.staff}/`)) return 'Staff profile'
  if (pathname === paths.sites) return 'Sites'
  if (pathname.startsWith(`${paths.sites}/`)) return 'Site profile'
  if (pathname === paths.requirements) return 'Requirements'
  if (pathname === paths.gaps) return 'Compliance gaps'
  if (pathname === paths.attention) {
    if (isExpiredAttentionPath(search)) return 'Expired'
    if (isExpiringAttentionPath(search)) return 'Expiring in 30 days'
    return 'Needs attention'
  }
  if (pathname === paths.settings) return 'Account'
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

function isMorePath(pathname) {
  return (
    !isOverviewPath(pathname) &&
    !isStaffPath(pathname) &&
    !isSitesPath(pathname) &&
    pathname !== paths.privacy &&
    pathname !== paths.terms &&
    pathname !== paths.security
  )
}

function navClassName(isActive) {
  return [
    'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-base font-medium no-underline transition-colors md:text-sm',
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

function SidebarNav({ onNavigate }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {pages.map((item) => {
        const Icon = item.icon
        if (item.to === paths.sites) {
          return (
            <SitesSidebarItem
              key={item.to}
              onNavigate={onNavigate}
              navClassName={navClassName}
            />
          )
        }
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => navClassName(isActive)}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SidebarBrand() {
  const { user } = useAuth()
  const orgName = user?.user_metadata?.organization_name

  return (
    <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
      <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
        <ShieldCheck className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          ECEC
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {orgName || 'Compliance'}
        </p>
      </div>
    </div>
  )
}

function BottomTabBar({
  pathname,
  moreOpen,
  sitesOpen,
  onToggleMore,
  onToggleSites,
  onCloseMenus,
}) {
  return (
    <>
      {moreOpen || sitesOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
          aria-label={sitesOpen ? 'Close sites menu' : 'Close more menu'}
          onClick={onCloseMenus}
        />
      ) : null}

      {moreOpen ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card px-2 py-2 shadow-lg md:hidden">
          {morePages.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onCloseMenus}
                className={({ isActive }) => navClassName(isActive)}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            )
          })}
        </div>
      ) : null}

      {sitesOpen ? (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 max-h-[min(24rem,calc(100svh-8rem))] overflow-y-auto border-t border-border bg-card px-2 py-2 shadow-lg md:hidden">
          <SitesNavLinks onNavigate={onCloseMenus} />
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid min-h-14 grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
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
          to={paths.staff}
          onClick={onCloseMenus}
          className={tabClassName(isStaffPath(pathname))}
        >
          <Users className="size-5" />
          Staff
        </NavLink>
        <button
          type="button"
          className={tabClassName(isSitesPath(pathname) || sitesOpen)}
          aria-expanded={sitesOpen}
          aria-label="Sites"
          onClick={onToggleSites}
        >
          <Building2 className="size-5" />
          Sites
        </button>
        <button
          type="button"
          className={tabClassName(isMorePath(pathname) || moreOpen)}
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
  const { signOut, user } = useAuth()
  const { pathname, search } = useLocation()
  const [moreForPath, setMoreForPath] = useState(null)
  const [sitesForPath, setSitesForPath] = useState(null)
  const moreOpen = moreForPath === pathname
  const sitesOpen = sitesForPath === pathname
  const menuOpen = moreOpen || sitesOpen

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = menuOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  function closeMenus() {
    setMoreForPath(null)
    setSitesForPath(null)
  }

  return (
    <div className="app-shell flex h-svh w-full max-w-full overflow-hidden bg-background text-left">
      <aside className="hidden h-full w-[210px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBrand />
        <SidebarNav />
        <div className="mt-auto shrink-0 border-t border-sidebar-border p-3">
          <FeedbackButton className="w-full" />
        </div>
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
          <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomTabBar
        pathname={pathname}
        moreOpen={moreOpen}
        sitesOpen={sitesOpen}
        onToggleMore={() => {
          setSitesForPath(null)
          setMoreForPath((current) => (current === pathname ? null : pathname))
        }}
        onToggleSites={() => {
          setMoreForPath(null)
          setSitesForPath((current) => (current === pathname ? null : pathname))
        }}
        onCloseMenus={closeMenus}
      />
    </div>
  )
}
