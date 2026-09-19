import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
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
  return 'ECEC'
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
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
              ].join(' ')
            }
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

export function AppLayout() {
  const { signOut, user } = useAuth()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = mobileOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  return (
    <div className="app-shell flex min-h-svh w-full max-w-full overflow-x-hidden bg-background text-left">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[min(16rem,85vw)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg lg:static lg:z-0 lg:w-60 lg:shadow-none',
          mobileOpen ? 'flex' : 'hidden lg:flex',
        ].join(' ')}
      >
        <SidebarBrand />
        <SidebarNav onNavigate={() => setMobileOpen(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>
            <p className="truncate text-sm font-semibold tracking-tight text-card-foreground">
              {pageTitle(pathname)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {user?.email ? (
              <Link
                to={paths.settings}
                className="hidden max-w-40 truncate text-xs text-muted-foreground hover:text-card-foreground hover:underline lg:block lg:max-w-56"
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

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full min-w-0 max-w-7xl p-3 sm:p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
