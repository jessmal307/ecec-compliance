import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { archetypeLabel, listFormTemplates } from '../lib/forms'
import { getOrganization } from '../lib/organizations'
import { paths } from '../lib/paths'
import { can } from '../lib/plans'

export function useFormsAccess() {
  const { organizationId } = useAuth()
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(Boolean(organizationId))

  useEffect(() => {
    if (!organizationId) {
      setOrganization(null)
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await getOrganization(organizationId)
      if (cancelled) return
      setOrganization(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  return {
    organization,
    loading,
    allowed: can(organization, 'forms'),
  }
}

export function Forms() {
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessLoading || !allowed) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await listFormTemplates()
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setTemplates([])
        setLoading(false)
        return
      }
      setTemplates(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed])

  if (accessLoading) {
    return <PageMuted>Loading forms…</PageMuted>
  }

  if (!allowed) {
    return <Navigate to={paths.home} replace />
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Forms"
        description="Preview templates. Nothing you enter here is saved."
      />

      <PageError>{error}</PageError>

      {loading ? (
        <PageMuted>Loading forms…</PageMuted>
      ) : templates.length === 0 ? (
        <PageMuted>No form templates available yet.</PageMuted>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {templates.map((template) => (
            <li key={template.id}>
              <Link
                to={paths.formPreview(template.id)}
                className="block rounded-xl no-underline"
              >
                <Card className="transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{template.name}</CardTitle>
                      <Badge variant="outline">
                        {archetypeLabel(template.archetype)}
                      </Badge>
                    </div>
                    {template.description ? (
                      <CardDescription>{template.description}</CardDescription>
                    ) : null}
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
