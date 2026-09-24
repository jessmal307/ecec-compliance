import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageError, PageMuted } from '../ui/page'
import {
  addFormSiteExclusion,
  isFormSiteExcluded,
  listFormSiteExclusions,
  removeFormSiteExclusion,
} from '../../lib/forms'
import { firstError } from '../../lib/query'
import { listSites } from '../../lib/sites'

export function FormSiteExclusions({ organizationId, templateId }) {
  const [sites, setSites] = useState([])
  const [exclusions, setExclusions] = useState([])
  const [loading, setLoading] = useState(false)
  const [togglingId, setTogglingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId || !templateId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [sitesResult, exclusionsResult] = await Promise.all([
        listSites(organizationId),
        listFormSiteExclusions(organizationId),
      ])
      if (cancelled) return
      const loadError = firstError(sitesResult, exclusionsResult)
      if (loadError) {
        setError(loadError.message)
        setSites([])
        setExclusions([])
        setLoading(false)
        return
      }
      setSites(sitesResult.data ?? [])
      setExclusions(exclusionsResult.data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, templateId])

  async function handleToggle(site) {
    const excluded = isFormSiteExcluded(exclusions, site.id, templateId)
    const previous = exclusions
    setTogglingId(site.id)
    setError('')
    setExclusions((current) =>
      excluded
        ? current.filter(
            (row) =>
              !(
                String(row.site_id) === String(site.id) &&
                String(row.template_id) === String(templateId)
              ),
          )
        : [...current, { site_id: site.id, template_id: templateId }],
    )

    const { error: toggleError } = excluded
      ? await removeFormSiteExclusion(organizationId, site.id, templateId)
      : await addFormSiteExclusion(organizationId, site.id, templateId)

    if (toggleError) {
      setExclusions(previous)
      setError(toggleError.message)
    }
    setTogglingId('')
  }

  if (loading) {
    return <PageMuted>Loading sites…</PageMuted>
  }

  if (!sites.length) {
    return <PageMuted>Add a site to choose where this form applies.</PageMuted>
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Applies to all active sites unless excluded.</p>
      <PageError>{error}</PageError>
      <ul className="space-y-1.5">
        {sites.map((site) => {
          const excluded = isFormSiteExcluded(exclusions, site.id, templateId)
          return (
            <li key={site.id} className="flex items-center justify-between gap-3">
              <span className={excluded ? 'text-muted-foreground' : undefined}>
                {site.name}
                {excluded ? ' · excluded' : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={togglingId === site.id}
                onClick={() => handleToggle(site)}
              >
                {excluded ? 'Include' : 'Exclude'}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
