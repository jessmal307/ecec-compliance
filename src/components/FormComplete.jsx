import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileDropZone } from './FileDropZone'
import { FormRenderer } from './forms/FormRenderer'
import { useFormsAccess } from './Forms'
import { useAuth } from '../hooks/useAuth'
import { Field, Input, Select } from './ui/form'
import { PageError, PageHeader, PageMuted, PageSuccess } from './ui/page'
import {
  buildSubmissionData,
  createFormSubmission,
  emptyFormState,
  getFormSubmission,
  getFormTemplate,
  updateFormSubmission,
  validateFormSubmission,
} from '../lib/forms'
import {
  dataUrlToFile,
  FORM_EVIDENCE_ACCEPT,
  getFormUploadUrl,
  isSignatureDataUrl,
  uploadFormFile,
  validateFormUpload,
} from '../lib/formUploads'
import { firstError } from '../lib/query'
import { listSites } from '../lib/sites'
import { paths } from '../lib/paths'

function collectSignatureFieldIds(schema, archetype) {
  if (archetype === 'checklist') return []
  const fields = schema?.fields || schema?.items || []
  return fields.filter((field) => field.type === 'signature').map((field) => field.id)
}

export function FormComplete() {
  const { templateId } = useParams()
  const [searchParams] = useSearchParams()
  const draftParam = searchParams.get('draft')
  const navigate = useNavigate()
  const { organizationId, user } = useAuth()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [template, setTemplate] = useState(null)
  const [sites, setSites] = useState([])
  const [siteId, setSiteId] = useState('')
  const [room, setRoom] = useState('')
  const [formState, setFormState] = useState(() => emptyFormState())
  const [draftId, setDraftId] = useState(draftParam)
  const [evidence, setEvidence] = useState([])
  const [pendingFiles, setPendingFiles] = useState([])
  const [signatureUrls, setSignatureUrls] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    if (accessLoading || !allowed || !templateId || !organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [templateResult, sitesResult, draftResult] = await Promise.all([
        getFormTemplate(templateId),
        listSites(organizationId),
        draftParam ? getFormSubmission(draftParam) : Promise.resolve({ data: null, error: null }),
      ])
      if (cancelled) return
      const loadError = firstError(templateResult, sitesResult, draftResult)
      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }
      if (draftResult.data?.status === 'complete') {
        navigate(paths.formSubmission(draftResult.data.id), { replace: true })
        return
      }
      setTemplate(templateResult.data)
      setSites(sitesResult.data ?? [])
      if (draftResult.data) {
        setDraftId(draftResult.data.id)
        setSiteId(draftResult.data.site_id || '')
        setRoom(draftResult.data.room || '')
        setFormState({
          values: draftResult.data.values,
          notes: draftResult.data.notes,
          signoff: {
            name: draftResult.data.signoff.name || '',
            date: draftResult.data.signoff.date || '',
            note: draftResult.data.signoff.note || '',
            signature: draftResult.data.signoff.signature || '',
          },
          rows: draftResult.data.rows,
        })
        setEvidence(draftResult.data.evidence)
      }
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, templateId, organizationId, draftParam, navigate])

  useEffect(() => {
    if (!template) return

    let cancelled = false
    const pathsToResolve = []
    const signoffPath = formState.signoff?.signature
    if (signoffPath && !isSignatureDataUrl(signoffPath)) {
      pathsToResolve.push(['signoff', signoffPath])
    }
    for (const fieldId of collectSignatureFieldIds(template.schema, template.archetype)) {
      const value = formState.values[fieldId]
      if (value && !isSignatureDataUrl(value)) pathsToResolve.push([fieldId, value])
    }

    if (pathsToResolve.length === 0) {
      setSignatureUrls({})
      return
    }

    Promise.all(
      pathsToResolve.map(async ([key, path]) => {
        const { url } = await getFormUploadUrl(path)
        return [key, url]
      }),
    ).then((entries) => {
      if (!cancelled) setSignatureUrls(Object.fromEntries(entries.filter(([, url]) => url)))
    })

    return () => {
      cancelled = true
    }
  }, [template, formState.signoff?.signature, formState.values])

  async function persist(status) {
    setError('')
    setSaved('')
    if (!siteId) {
      setError('Choose a site.')
      return
    }
    if (status === 'complete') {
      const issues = validateFormSubmission(template.schema, template.archetype, formState)
      if (issues.length) {
        setError(issues[0])
        return
      }
    }

    setSaving(true)

    let submissionId = draftId
    if (!submissionId) {
      const created = await createFormSubmission(organizationId, {
        templateId: template.id,
        siteId,
        userId: user?.id,
      })
      if (created.error) {
        setError(created.error.message)
        setSaving(false)
        return
      }
      submissionId = created.data.id
      setDraftId(submissionId)
    }

    const nextValues = { ...formState.values }
    const nextSignoff = { ...formState.signoff }

    if (isSignatureDataUrl(nextSignoff.signature)) {
      const file = await dataUrlToFile(nextSignoff.signature)
      const uploaded = await uploadFormFile({
        orgId: organizationId,
        submissionId,
        file,
        kind: 'signature',
      })
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextSignoff.signature = uploaded.path
    }

    for (const fieldId of collectSignatureFieldIds(template.schema, template.archetype)) {
      if (!isSignatureDataUrl(nextValues[fieldId])) continue
      const file = await dataUrlToFile(nextValues[fieldId], `${fieldId}.png`)
      const uploaded = await uploadFormFile({
        orgId: organizationId,
        submissionId,
        file,
        kind: 'field',
      })
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextValues[fieldId] = uploaded.path
    }

    const nextEvidence = [...evidence]
    for (const file of pendingFiles) {
      const uploaded = await uploadFormFile({
        orgId: organizationId,
        submissionId,
        file,
        kind: 'evidence',
      })
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextEvidence.push({ path: uploaded.path, name: file.name })
    }

    const now = new Date().toISOString()
    const { data, error: saveError } = await updateFormSubmission(submissionId, {
      site_id: siteId,
      data: buildSubmissionData({
        room,
        values: nextValues,
        notes: formState.notes,
        signoff: nextSignoff,
        rows: formState.rows,
      }),
      evidence: nextEvidence,
      status,
      submitted_by: user?.id ?? null,
      signed_off_by: status === 'complete' ? user?.id ?? null : null,
      signed_off_at: status === 'complete' ? now : null,
      submitted_at: status === 'complete' ? now : null,
    })

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    setFormState((current) => ({
      ...current,
      values: nextValues,
      signoff: nextSignoff,
    }))
    setEvidence(nextEvidence)
    setPendingFiles([])
    setSaving(false)

    if (status === 'complete') {
      navigate(paths.formSubmission(data.id))
      return
    }

    setSaved('Draft saved.')
  }

  function handleEvidence(file) {
    const invalid = validateFormUpload(file)
    if (invalid.error) {
      setError(invalid.error)
      return
    }
    setError('')
    setPendingFiles((current) => [...current, file])
  }

  if (accessLoading) return <PageMuted>Loading form…</PageMuted>
  if (!allowed) return <Navigate to={paths.home} replace />

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={template?.name || 'Complete form'}
        description="Choose a site, fill the form, then save a draft or submit."
        actions={
          <Button asChild variant="outline">
            <Link to={paths.forms}>Back to forms</Link>
          </Button>
        }
      />

      <PageError>{error}</PageError>
      <PageSuccess>{saved}</PageSuccess>

      {loading || !template ? (
        <PageMuted>Loading form…</PageMuted>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <Badge variant="outline">{template.archetype}</Badge>
            <CardTitle className="w-full">{template.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Site (required)">
              <Select
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                disabled={saving}
              >
                <option value="">Select a site…</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Room or area" hint="Optional">
              <Input
                value={room}
                onChange={(event) => setRoom(event.target.value)}
                disabled={saving}
              />
            </Field>

            <FormRenderer
              archetype={template.archetype}
              schema={template.schema}
              state={formState}
              onStateChange={setFormState}
              signatureUrls={signatureUrls}
            />

            <Field label="Photos" hint="Optional. Under 10MB each.">
              <FileDropZone
                accept={FORM_EVIDENCE_ACCEPT}
                disabled={saving}
                onFile={handleEvidence}
                label="Add a photo"
                hint="JPG, PNG, WebP, or GIF"
                fileName={
                  pendingFiles.length
                    ? `${pendingFiles.length} photo${pendingFiles.length === 1 ? '' : 's'} ready to upload`
                    : evidence.length
                      ? `${evidence.length} attached`
                      : ''
                }
              />
            </Field>

            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => persist('draft')}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" disabled={saving} onClick={() => persist('complete')}>
                {saving ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
