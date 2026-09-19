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
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'

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

function pageTitle(pathname) {
  if (pathname === paths.home) return 'Overview'
  if (pathname === paths.compliance) return 'Compliance items'
  if (pathname === paths.staff) return 'Staff'
  if (pathname === paths.newStaff) return 'New staff'
  if (pathname.startsWith(`${paths.staff}/`)) return 'Staff profile'
  if (pathname === paths.sites) return 'Sites'
  if (pathname.startsWith(`${paths.sites}/`)) return 'Site profile'
  if (pathname === paths.requirements) return 'Requirements'
  if (pathname === paths.gaps) return 'Compliance gaps'
  if (pathname === paths.attention) return 'Needs attention'
  if (pathname === paths.settings) return 'Account'
  if (pathname === paths.privacy) return 'Privacy & Data Handling'
  return 'ECEC'
}

function isStaffPath(pathname) {
  return pathname === paths.staff || pathname.startsWith(`${paths.staff}/`)
}

function isSitesPath(pathname) {
  return pathname === paths.sites || pathname.startsWith(`${paths.sites}/`)
}

function isOverviewPath(pathname) {
  return pathname === paths.home
}

function isMorePath(pathname) {
  return (
    !isOverviewPath(pathname) &&
    !isStaffPath(pathname) &&
    !isSitesPath(pathname) &&
    pathname !== paths.privacy
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
    'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium no-underline transition-colors',
    isActive ? 'text-foreground' : 'text-muted-foreground',
  ].join(' ')
}

function SidebarNav({ onNavigate }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {pages.map((item) => {
        const Icon = item.icon
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

function BottomTabBar({ pathname, moreOpen, onToggleMore, onCloseMore }) {
  return (
    <>
      {moreOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-foreground/20 md:hidden"
          aria-label="Close more menu"
          onClick={onCloseMore}
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
                onClick={onCloseMore}
                className={({ isActive }) => navClassName(isActive)}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            )
          })}
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid min-h-14 grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        <NavLink
          to={paths.home}
          end
          onClick={onCloseMore}
          className={tabClassName(isOverviewPath(pathname))}
        >
          <LayoutDashboard className="size-5" />
          Overview
        </NavLink>
        <NavLink
          to={paths.staff}
          onClick={onCloseMore}
          className={tabClassName(isStaffPath(pathname))}
        >
          <Users className="size-5" />
          Staff
        </NavLink>
        <NavLink
          to={paths.sites}
          onClick={onCloseMore}
          className={tabClassName(isSitesPath(pathname))}
        >
          <Building2 className="size-5" />
          Sites
        </NavLink>
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
  const { pathname } = useLocation()
  const [moreForPath, setMoreForPath] = useState(null)
  const moreOpen = moreForPath === pathname

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = moreOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [moreOpen])

  return (
    <div className="app-shell flex min-h-svh w-full max-w-full overflow-x-hidden bg-background text-left">
      <aside className="hidden w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBrand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-4 md:px-6">
          <p className="truncate text-sm font-semibold tracking-tight text-card-foreground">
            {pageTitle(pathname)}
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
            <ThemeToggle />
            <Button type="button" variant="outline" size="sm" onClick={() => signOut()}>
              <LogOut data-icon="inline-start" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomTabBar
        pathname={pathname}
        moreOpen={moreOpen}
        onToggleMore={() =>
          setMoreForPath((current) => (current === pathname ? null : pathname))
        }
        onCloseMore={() => setMoreForPath(null)}
      />
    </div>
  )
}
