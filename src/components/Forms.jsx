import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AssignForm } from './forms/AssignForm'
import { FormAssignments } from './forms/FormAssignments'
import { FormSubmissions } from './forms/FormSubmissions'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { archetypeLabel, getFormTemplate, listFormTemplates } from '../lib/forms'
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
    organizationId,
    loading,
    allowed: can(organization, 'forms'),
  }
}

export function Forms() {
  const { organizationId } = useAuth()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab =
    requestedTab === 'assigned' || requestedTab === 'submissions'
      ? requestedTab
      : 'templates'
  const assignId = searchParams.get('assign')
  const [templates, setTemplates] = useState([])
  const [assignTemplate, setAssignTemplate] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [assignmentTick, setAssignmentTick] = useState(0)

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

  useEffect(() => {
    if (!assignId || accessLoading || !allowed) {
      if (!assignId) setAssignTemplate(null)
      return
    }

    const fromList = templates.find((template) => template.id === assignId)
    if (fromList) {
      setAssignTemplate(fromList)
      return
    }

    let cancelled = false

    getFormTemplate(assignId).then(({ data }) => {
      if (!cancelled) setAssignTemplate(data)
    })

    return () => {
      cancelled = true
    }
  }, [assignId, templates, accessLoading, allowed])

  function setTab(next) {
    if (next === 'assigned' || next === 'submissions') {
      setSearchParams({ tab: next })
      return
    }
    setSearchParams({})
  }

  function openAssign(template) {
    setAssignTemplate(template)
    setSearchParams({ assign: template.id })
  }

  function closeAssign() {
    setAssignTemplate(null)
    if (tab === 'assigned' || tab === 'submissions') setSearchParams({ tab })
    else setSearchParams({})
  }

  function handleAssigned() {
    setAssignTemplate(null)
    setAssignmentTick((current) => current + 1)
    setSearchParams({ tab: 'assigned' })
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

      {assignTemplate ? (
        <AssignForm
          organizationId={organizationId}
          template={assignTemplate}
          onCancel={closeAssign}
          onSaved={handleAssigned}
        />
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="assigned">Assigned</TabsTrigger>
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
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openAssign(template)}
                        >
                          Assign
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="assigned">
          <FormAssignments
            key={assignmentTick}
            organizationId={organizationId}
          />
        </TabsContent>

        <TabsContent value="submissions">
          <FormSubmissions organizationId={organizationId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
