import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormDue } from './forms/FormDue'
import { FormLibraryCard } from './forms/FormLibraryCard'
import { FormSubmissions } from './forms/FormSubmissions'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { listFormOrgSchedules, listFormTemplates } from '../lib/forms'
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
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessLoading || !allowed) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [templatesResult, schedulesResult] = await Promise.all([
        listFormTemplates(),
        listFormOrgSchedules(organizationId),
      ])
      if (cancelled) return
      if (templatesResult.error || schedulesResult.error) {
        setError((templatesResult.error || schedulesResult.error).message)
        setTemplates([])
        setSchedules([])
        setLoading(false)
        return
      }
      setTemplates(templatesResult.data)
      setSchedules(schedulesResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, organizationId])

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
            <div className="flex flex-col gap-8">
              {[
                ['Audits', (template) => template.category === 'audit'],
                ['Checklists', (template) => template.category === 'checklist'],
                ['Other', (template) => template.category !== 'audit' && template.category !== 'checklist'],
              ].map(([heading, matches]) => {
                const group = templates.filter(matches)
                if (!group.length) return null
                return (
                  <section key={heading} className="flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">{heading}</h2>
                    <ul className="grid grid-cols-1 gap-3">
                      {group.map((template) => (
                        <li key={template.id}>
                          <FormLibraryCard
                            organizationId={organizationId}
                            template={template}
                            schedule={schedules.find((row) => row.template_id === template.id) ?? null}
                            onSchedule={(row) =>
                              setSchedules((current) => {
                                const rest = current.filter((item) => item.template_id !== row.template_id)
                                return [...rest, row]
                              })
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
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
