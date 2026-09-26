import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormActionList } from './forms/FormActionList'
import { FormRenderer } from './forms/FormRenderer'
import { useFormsAccess } from './Forms'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { formatDate, formatTimestamp } from '../lib/format'
import { listFormActions } from '../lib/formActions'
import { archetypeLabel, getFormSubmission, getFormTemplate } from '../lib/forms'
import { listStaff } from '../lib/staff'
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
  const [actions, setActions] = useState([])
  const [staff, setStaff] = useState([])
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
      const [actionsResult, staffResult] = await Promise.all([
        listFormActions(data.org_id, { submissionId: data.id }),
        listStaff(data.org_id),
      ])
      if (cancelled) return
      if (actionsResult.error || staffResult.error) {
        setError((actionsResult.error || staffResult.error).message)
        setLoading(false)
        return
      }
      setSubmission(data)
      setTemplate(templateResult.data)
      setActions(actionsResult.data)
      setStaff(staffResult.data ?? [])
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
        description="Completed and missed submissions cannot be edited."
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
              <Badge variant={submission.status === 'missed' ? 'outline' : 'secondary'}>
                {submission.status === 'missed' ? 'Missed' : 'Complete'}
              </Badge>
              {submission.late ? <Badge variant="outline">Late</Badge> : null}
              <Badge variant="outline">{archetypeLabel(template.archetype)}</Badge>
            </div>
            <CardTitle>{submission.template_name}</CardTitle>
            <p className="text-base text-muted-foreground md:text-sm">
              {submission.site_name || 'No centre'}
              {submission.room ? ` · ${submission.room}` : ''}
              {submission.for_date ? ` · covers ${formatDate(submission.for_date)}` : ''}
              {!submission.for_date && submission.completed_on
                ? ` · completed ${formatDate(submission.completed_on)}`
                : ''}
              {submission.status === 'missed'
                ? ''
                : submission.signer_name
                  ? ` · Signed by ${submission.signer_name} (floor link PIN)`
                  : ` · ${submission.signoff.name || 'Unsigned'}`}
              {' · '}
              {formatTimestamp(submission.submitted_at || submission.created_at)}
            </p>
            {submission.status === 'missed' && submission.missed_reason ? (
              <p className="text-base text-muted-foreground md:text-sm">
                Reason: {submission.missed_reason}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {submission.status === 'missed' ? (
              <p className="text-sm text-muted-foreground">
                This occurrence was recorded as missed. No form was completed.
              </p>
            ) : template.archetype === 'evidence' ? (
              submission.notes?.text ? (
                <p className="text-sm whitespace-pre-wrap">{submission.notes.text}</p>
              ) : null
            ) : (
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
            )}
            {evidenceUrls.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  {template.archetype === 'evidence' ? 'Files' : 'Photos'}
                </h3>
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
            <div className="space-y-3 border-t border-border pt-5">
              <h3 className="text-sm font-medium">Actions</h3>
              <FormActionList
                actions={actions}
                staff={staff}
                onError={setError}
                onChanged={(row) =>
                  setActions((current) => current.map((item) => (item.id === row.id ? row : item)))
                }
              />
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
