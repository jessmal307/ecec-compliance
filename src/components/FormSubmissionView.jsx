import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormRenderer } from './forms/FormRenderer'
import { useFormsAccess } from './Forms'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { formatTimestamp } from '../lib/format'
import { getFormSubmission, getFormTemplate } from '../lib/forms'
import { getFormUploadUrl, isSignatureDataUrl } from '../lib/formUploads'
import { firstError } from '../lib/query'
import { formsHref, paths } from '../lib/paths'

function collectSignatureFieldIds(schema, archetype) {
  if (archetype === 'checklist') return []
  const fields = schema?.fields || schema?.items || []
  return fields.filter((field) => field.type === 'signature').map((field) => field.id)
}

export function FormSubmissionView() {
  const { submissionId } = useParams()
  const navigate = useNavigate()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [submission, setSubmission] = useState(null)
  const [template, setTemplate] = useState(null)
  const [signatureUrls, setSignatureUrls] = useState({})
  const [evidenceUrls, setEvidenceUrls] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessLoading || !allowed || !submissionId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await getFormSubmission(submissionId)
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }
      if (!data) {
        setSubmission(null)
        setLoading(false)
        return
      }
      if (data.status === 'draft') {
        navigate(`${paths.formComplete(data.template_id)}?draft=${data.id}`, {
          replace: true,
        })
        return
      }
      const templateResult = await getFormTemplate(data.template_id)
      if (cancelled) return
      const nextError = firstError(templateResult)
      if (nextError) {
        setError(nextError.message)
        setLoading(false)
        return
      }
      setSubmission(data)
      setTemplate(templateResult.data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, submissionId, navigate])

  useEffect(() => {
    if (!submission || !template) return

    let cancelled = false
    const pathsToResolve = []
    if (submission.signoff.signature && !isSignatureDataUrl(submission.signoff.signature)) {
      pathsToResolve.push(['signoff', submission.signoff.signature])
    }
    for (const fieldId of collectSignatureFieldIds(template.schema, template.archetype)) {
      const value = submission.values[fieldId]
      if (value && !isSignatureDataUrl(value)) pathsToResolve.push([fieldId, value])
    }

    Promise.all([
      Promise.all(
        pathsToResolve.map(async ([key, path]) => {
          const { url } = await getFormUploadUrl(path)
          return [key, url]
        }),
      ),
      Promise.all(
        submission.evidence.map(async (item) => {
          const { url } = await getFormUploadUrl(item.path)
          return { ...item, url }
        }),
      ),
    ]).then(([signatureEntries, photos]) => {
      if (cancelled) return
      setSignatureUrls(Object.fromEntries(signatureEntries.filter(([, url]) => url)))
      setEvidenceUrls(photos)
    })

    return () => {
      cancelled = true
    }
  }, [submission, template])

  if (accessLoading) return <PageMuted>Loading submission…</PageMuted>
  if (!allowed) return <Navigate to={paths.home} replace />

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={submission?.template_name || 'Submission'}
        description="Completed submissions cannot be edited."
        actions={
          <Button asChild variant="outline">
            <Link to={formsHref({ tab: 'submissions' })}>Back to forms</Link>
          </Button>
        }
      />

      <PageError>{error}</PageError>

      {loading || !submission || !template ? (
        <PageMuted>Loading submission…</PageMuted>
      ) : (
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Complete</Badge>
              <Badge variant="outline">{template.archetype}</Badge>
            </div>
            <CardTitle>{submission.template_name}</CardTitle>
            <p className="text-base text-muted-foreground md:text-sm">
              {submission.site_name || 'No site'}
              {submission.room ? ` · ${submission.room}` : ''}
              {' · '}
              {submission.signoff.name || 'Unsigned'}
              {' · '}
              {formatTimestamp(submission.submitted_at || submission.created_at)}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormRenderer
              archetype={template.archetype}
              schema={template.schema}
              state={{
                values: submission.values,
                notes: submission.notes,
                signoff: submission.signoff,
                rows: submission.rows,
              }}
              readOnly
              signatureUrls={signatureUrls}
            />
            {evidenceUrls.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Photos</h3>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {evidenceUrls.map((item) => (
                    <li key={item.path}>
                      {item.url ? (
                        <img
                          src={item.url}
                          alt={item.name || 'Evidence'}
                          className="max-h-64 w-full rounded-lg border border-border object-contain"
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">{item.name}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </section>
  )
}
