import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Building2, ChevronDown, List, Plus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { isSitesPath, paths } from '../lib/paths'
import { listSites } from '../lib/sites'

function isNewSiteSearch(search) {
  return new URLSearchParams(search).get('new') === '1'
}

function childNavClassName(isActive) {
  return [
    'flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-1.5 text-base no-underline transition-colors md:min-h-9 md:text-sm',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
  ].join(' ')
}

function useOrgSites() {
  const { organizationId } = useAuth()
  const { pathname, search } = useLocation()
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!organizationId) {
      setSites([])
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: selectError } = await listSites(organizationId)
      if (cancelled) return
      if (selectError) {
        setError(selectError.message)
        setLoading(false)
        return
      }
      setSites(data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, pathname, search])

  return { sites, error, loading, organizationId }
}

export function SitesNavLinks({ onNavigate }) {
  const { pathname, search } = useLocation()
  const { sites, error, loading } = useOrgSites()
  const adding = pathname === paths.sites && isNewSiteSearch(search)
  const showingAll = pathname === paths.sites && !adding

  return (
    <div className="flex flex-col gap-0.5">
      {loading && sites.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">Loading sites…</p>
      ) : null}

      {error ? (
        <p className="px-2.5 py-2 text-xs text-status-expired" role="alert">
          {error}
        </p>
      ) : null}

      {sites.map((site) => (
        <NavLink
          key={site.id}
          to={paths.siteProfile(site.id)}
          onClick={onNavigate}
          className={({ isActive }) => childNavClassName(isActive)}
          title={site.name}
        >
          <span className="truncate">{site.name}</span>
        </NavLink>
      ))}

      {!loading && !error && sites.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">No sites yet.</p>
      ) : null}

      <NavLink
        to={{ pathname: paths.sites, search: '' }}
        end
        onClick={onNavigate}
        className={childNavClassName(showingAll)}
      >
        <List className="size-4 shrink-0" />
        Show all
      </NavLink>

      <NavLink
        to={{ pathname: paths.sites, search: '?new=1' }}
        onClick={onNavigate}
        className={childNavClassName(adding)}
      >
        <Plus className="size-4 shrink-0" />
        Add site
      </NavLink>
    </div>
  )
}

export function SitesSidebarItem({ onNavigate, navClassName }) {
  const { pathname } = useLocation()
  const [expanded, setExpanded] = useState(() => isSitesPath(pathname))
  const [seenPath, setSeenPath] = useState(pathname)
  const sectionActive = isSitesPath(pathname)

  if (pathname !== seenPath) {
    setSeenPath(pathname)
    if (isSitesPath(pathname)) setExpanded(true)
  }

  return (
    <div>
      <button
        type="button"
        className={`${navClassName(sectionActive)} w-full cursor-pointer`}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <Building2 className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Sites</span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded ? (
        <div className="mt-0.5 ml-4 border-l border-sidebar-border pl-2">
          <SitesNavLinks onNavigate={onNavigate} />
        </div>
      ) : null}
    </div>
  )
}
