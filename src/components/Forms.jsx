import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormDue } from './forms/FormDue'
import { FormSiteExclusions } from './forms/FormSiteExclusions'
import { FormSubmissions } from './forms/FormSubmissions'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  archetypeLabel,
  cadenceLabel,
  isScheduledAllSitesTemplate,
  listFormTemplates,
} from '../lib/forms'
import { getOrganization } from '../lib/organizations'
import { paths } from '../lib/paths'
import { can } from '../lib/plans'

function formsTab(searchParams) {
  const tab = searchParams.get('tab')
  if (tab === 'submissions' || tab === 'due') return tab
  return 'templates'
}

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
    organizationId,
    loading,
    allowed: can(organization, 'forms'),
  }
}

export function Forms() {
  const { organizationId } = useAuth()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = formsTab(searchParams)
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

  function setTab(next) {
    if (next === 'submissions' || next === 'due') setSearchParams({ tab: next })
    else setSearchParams({})
  }

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
        description="Preview, complete, and review saved forms."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="due">Due</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <PageError>{error}</PageError>
          {loading ? (
            <PageMuted>Loading forms…</PageMuted>
          ) : templates.length === 0 ? (
            <PageMuted>No form templates available yet.</PageMuted>
          ) : (
            <ul className="grid grid-cols-1 gap-3">
              {templates.map((template) => (
                <li key={template.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{template.name}</CardTitle>
                        <Badge variant="outline">
                          {archetypeLabel(template.archetype)}
                        </Badge>
                        {template.cadence ? (
                          <Badge variant="outline">{cadenceLabel(template.cadence)}</Badge>
                        ) : null}
                      </div>
                      {template.description ? (
                        <CardDescription>{template.description}</CardDescription>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button asChild>
                          <Link to={paths.formComplete(template.id)}>Complete</Link>
                        </Button>
                        <Button asChild variant="outline">
                          <Link to={paths.formPreview(template.id)}>Preview</Link>
                        </Button>
                      </div>
                    </CardHeader>
                    {isScheduledAllSitesTemplate(template) ? (
                      <CardContent>
                        <FormSiteExclusions
                          organizationId={organizationId}
                          templateId={template.id}
                        />
                      </CardContent>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="due">
          <FormDue organizationId={organizationId} />
        </TabsContent>

        <TabsContent value="submissions">
          <FormSubmissions organizationId={organizationId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
