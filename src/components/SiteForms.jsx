import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormRenderer } from './forms/FormRenderer'
import { emptyHazardRow } from './forms/RiskMatrixFormRenderer'
import { PageError, PageMuted, PageSuccess } from './ui/page'
import {
  INACTIVE_MESSAGE,
  SIGNATURE_AGAIN_MESSAGE,
  buildPublicSubmissionData,
  dataUrlToBlob,
  emptyFormState,
  getSiteForms,
  isSignatureDataUrl,
  saveSiteForm,
  uploadSignature,
  validateFormSubmission,
} from '../lib/siteFormsPublic'

function statusLabel(status) {
  if (status === 'done') return 'Done'
  if (status === 'missed') return 'Missed'
  if (status === 'available') return 'Available'
  return 'Due'
}

function canComplete(status) {
  return status === 'due' || status === 'available'
}

function formatDay(isoDate) {
  if (!isoDate) return ''
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return isoDate
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function startState(archetype) {
  const state = emptyFormState()
  if (archetype === 'risk_matrix') state.rows = [emptyHazardRow()]
  return state
}

export function SiteForms() {
  const { token: rawToken } = useParams()
  let token = rawToken || ''
  try {
    token = rawToken ? decodeURIComponent(rawToken) : ''
  } catch {
    token = rawToken || ''
  }
  const [loading, setLoading] = useState(true)
  const [inactive, setInactive] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [siteName, setSiteName] = useState('')
  const [today, setToday] = useState('')
  const [forms, setForms] = useState([])
  const [active, setActive] = useState(null)
  const [formState, setFormState] = useState(() => emptyFormState())
  const [draftIds, setDraftIds] = useState({})
  const [saving, setSaving] = useState(false)
  const [rendererKey, setRendererKey] = useState(0)

  async function loadList() {
    setLoading(true)
    try {
      const result = await getSiteForms(token)
      if (result.error?.status === 401) {
        setInactive(true)
        setError('')
        return
      }
      if (result.error) {
        setError(result.error.message)
        return
      }
      setSiteName(result.data?.site_name || '')
      setToday(result.data?.today || '')
      setForms(result.data?.forms || [])
      setInactive(false)
      setError('')
    } catch {
      setError('Could not reach the forms service. Try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      setInactive(true)
      setLoading(false)
      return
    }
    loadList()
  }, [token])

  function openForm(form) {
    if (!canComplete(form.status)) {
      setError(
        form.status === 'missed'
          ? 'This form was recorded as missed.'
          : 'This form is already completed.',
      )
      setSaved('')
      return
    }
    setError('')
    setSaved('')
    setActive(form)
    setFormState(startState(form.archetype))
  }

  function closeForm() {
    setActive(null)
    setError('')
    setSaved('')
  }

  // Remounting the renderer blanks the pad, which only reads its value on mount.
  function clearSignature(state) {
    setFormState({ ...state, signoff: { ...state.signoff, signature: '' } })
    setRendererKey((key) => key + 1)
  }

  async function persist(status) {
    if (!active) return
    setError('')
    setSaved('')
    if (status === 'complete') {
      const issues = validateFormSubmission(active.schema, active.archetype, formState)
      if (issues.length) {
        setError(issues[0])
        return
      }
    }

    setSaving(true)
    let nextState = formState
    const draft = await saveSiteForm(token, {
      template_id: active.template_id,
      status: 'draft',
      for_date: active.for_date || null,
      submission_id: draftIds[active.template_id] || undefined,
      data: buildPublicSubmissionData(nextState),
    })
    if (draft.error) {
      if (draft.error.status === 401) {
        setInactive(true)
        setSaving(false)
        return
      }
      if (draft.error.message === SIGNATURE_AGAIN_MESSAGE) clearSignature(nextState)
      setError(draft.error.message)
      setSaving(false)
      return
    }

    const submissionId = draft.data.submission_id
    setDraftIds((current) => ({ ...current, [active.template_id]: submissionId }))

    if (isSignatureDataUrl(nextState.signoff?.signature)) {
      let uploaded
      if (!draft.data.upload) {
        uploaded = { error: { message: 'Could not upload the signature. Try again.' } }
      } else {
        try {
          const blob = await dataUrlToBlob(nextState.signoff.signature)
          uploaded = await uploadSignature(draft.data.upload, blob)
        } catch {
          uploaded = { error: { message: 'Could not upload the signature. Try again.' } }
        }
      }
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextState = {
        ...nextState,
        signoff: { ...nextState.signoff, signature: draft.data.upload.path },
      }
      setFormState(nextState)
    }

    if (status === 'draft') {
      setSaved('Draft saved.')
      setSaving(false)
      return
    }

    const completed = await saveSiteForm(token, {
      template_id: active.template_id,
      status: 'complete',
      for_date: active.for_date || null,
      submission_id: submissionId,
      data: buildPublicSubmissionData(nextState),
    })
    if (completed.error) {
      if (completed.error.status === 401) {
        setInactive(true)
        setSaving(false)
        return
      }
      if (completed.error.message === SIGNATURE_AGAIN_MESSAGE) clearSignature(nextState)
      setError(completed.error.message)
      setSaving(false)
      return
    }

    setSaved('Form submitted.')
    setSaving(false)
    setActive(null)
    setDraftIds((current) => {
      const next = { ...current }
      delete next[active.template_id]
      return next
    })
    await loadList()
  }

  if (loading) return <PageMuted>Loading forms…</PageMuted>

  if (inactive) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Link not active
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base text-muted-foreground">{INACTIVE_MESSAGE}</p>
        </CardContent>
      </Card>
    )
  }

  if (active) {
    return (
      <section className="flex w-full max-w-2xl flex-col gap-5">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">{siteName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{active.name}</h1>
        </header>
        <PageError>{error}</PageError>
        <PageSuccess>{saved}</PageSuccess>
        <Card>
          <CardContent className="space-y-5 pt-6">
            <FormRenderer
              key={rendererKey}
              archetype={active.archetype}
              schema={active.schema}
              state={formState}
              onStateChange={setFormState}
            />
            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="min-h-12 flex-1"
                disabled={saving}
                onClick={() => persist('draft')}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                className="min-h-12 flex-1"
                disabled={saving}
                onClick={() => persist('complete')}
              >
                {saving ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-12 w-full"
              disabled={saving}
              onClick={closeForm}
            >
              Back to forms
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="flex w-full max-w-lg flex-col gap-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{siteName || 'Forms'}</h1>
        <p className="text-base text-muted-foreground">{formatDay(today)}</p>
      </header>
      <PageError>{error}</PageError>
      <PageSuccess>{saved}</PageSuccess>
      {error ? (
        <Button type="button" className="min-h-12 w-full" onClick={loadList}>
          Try again
        </Button>
      ) : forms.length === 0 ? (
        <PageMuted>No forms to complete today.</PageMuted>
      ) : (
        <ul className="flex flex-col gap-3">
          {forms.map((form) => (
            <li key={form.template_id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-lg font-medium leading-snug">{form.name}</p>
                    <Badge variant="outline">{statusLabel(form.status)}</Badge>
                  </div>
                  {canComplete(form.status) ? (
                    <Button
                      type="button"
                      className="min-h-12 w-full sm:w-auto"
                      onClick={() => openForm(form)}
                    >
                      Complete
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {form.status === 'missed' ? 'Recorded as missed' : 'Completed'}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
