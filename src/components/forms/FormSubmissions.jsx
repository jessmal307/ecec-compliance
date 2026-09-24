import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Select } from '../ui/form'
import { PageError, PageMuted } from '../ui/page'
import { formatTimestamp } from '../../lib/format'
import { listFormSubmissions, listFormTemplates } from '../../lib/forms'
import { formatDate } from '../../lib/format'
import { firstError } from '../../lib/query'
import { listSites } from '../../lib/sites'
import { paths } from '../../lib/paths'

export function FormSubmissions({ organizationId }) {
  const [submissions, setSubmissions] = useState([])
  const [templates, setTemplates] = useState([])
  const [sites, setSites] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function loadFilters() {
      const [templatesResult, sitesResult] = await Promise.all([
        listFormTemplates(),
        listSites(organizationId),
      ])
      if (cancelled) return
      const loadError = firstError(templatesResult, sitesResult)
      if (loadError) {
        setError(loadError.message)
        return
      }
      setTemplates(templatesResult.data)
      setSites(sitesResult.data ?? [])
    }

    loadFilters()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await listFormSubmissions(organizationId, {
        templateId,
        siteId,
      })
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setSubmissions([])
        setLoading(false)
        return
      }
      setSubmissions(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, templateId, siteId])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          aria-label="Filter by template"
          className="sm:w-56"
        >
          <option value="">All templates</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <Select
          value={siteId}
          onChange={(event) => setSiteId(event.target.value)}
          aria-label="Filter by site"
          className="sm:w-52"
        >
          <option value="">All sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </div>

      <PageError>{error}</PageError>

      {loading ? (
        <PageMuted>Loading submissions…</PageMuted>
      ) : submissions.length === 0 ? (
        <PageMuted>No submissions yet. Complete a form to see it here.</PageMuted>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {submissions.map((submission) => {
            const locked =
              submission.status === 'complete' || submission.status === 'missed'
            const href = locked
              ? paths.formSubmission(submission.id)
              : `${paths.formComplete(submission.template_id)}?draft=${submission.id}`

            return (
              <li key={submission.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{submission.template_name}</CardTitle>
                      <Badge
                        variant={
                          submission.status === 'complete' ? 'secondary' : 'outline'
                        }
                      >
                        {submission.status === 'complete'
                          ? 'Complete'
                          : submission.status === 'missed'
                            ? 'Missed'
                            : 'Draft'}
                      </Badge>
                      {submission.late ? <Badge variant="outline">Late</Badge> : null}
                    </div>
                    <CardDescription>
                      {submission.status === 'missed'
                        ? submission.missed_reason || 'Marked missed'
                        : submission.signoff.name || 'No name yet'}
                      {' · '}
                      {submission.site_name || 'No site'}
                      {submission.room ? ` · ${submission.room}` : ''}
                      {submission.for_date ? ` · covers ${formatDate(submission.for_date)}` : ''}
                      {' · '}
                      {formatTimestamp(submission.submitted_at || submission.created_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild variant="outline">
                      <Link to={href}>
                        {locked ? 'Open' : 'Continue draft'}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
