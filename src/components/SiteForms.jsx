import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  addFloorAppHead,
  clearStoredFloorToken,
  readStoredFloorToken,
  resolveFloorToken,
  storeFloorToken,
} from '../lib/floorDevice'
import { paths } from '../lib/paths'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FloorInstallGuide } from './FloorInstallGuide'
import { FloorSignIn } from './FloorSignIn'
import { FormRenderer } from './forms/FormRenderer'
import { emptyHazardRow } from './forms/RiskMatrixFormRenderer'
import { PageError, PageMuted, PageSuccess } from './ui/page'
import {
  INACTIVE_MESSAGE,
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

const UPLOAD_FAILED_MESSAGE = 'Could not upload the signature. Try again.'
const INACTIVE_NOTICES = {
  missing: {
    title: 'Open your floor link',
    message: 'Open your centre’s floor link, or scan the QR poster, once on this device.',
  },
  inactive: { title: 'Link not active', message: INACTIVE_MESSAGE },
  replaced: {
    title: 'Link replaced',
    message: 'This link has been replaced — ask your director for the new one.',
  },
}
const SIGN_IN_AGAIN_NOTICE = 'Your sign-in has ended. Sign in again, then tap Save or Submit.'

// Matches the server's field source in site-forms.
function signatureFieldIds(schema, archetype) {
  if (archetype === 'checklist') return []
  const fields = schema?.fields ?? schema?.items
  if (!Array.isArray(fields)) return []
  return fields.filter((field) => field?.type === 'signature').map((field) => field.id)
}

async function uploadDrawnSignature(dataUrl, upload) {
  if (!upload?.path) return { path: null, error: { message: UPLOAD_FAILED_MESSAGE } }
  try {
    const blob = await dataUrlToBlob(dataUrl)
    const uploaded = await uploadSignature(upload, blob)
    if (uploaded.error) return { path: null, error: uploaded.error }
    return { path: upload.path, error: null }
  } catch {
    return { path: null, error: { message: UPLOAD_FAILED_MESSAGE } }
  }
}

export function SiteForms() {
  const { token: pathToken } = useParams()
  const [token] = useState(() => resolveFloorToken(pathToken))
  const [loading, setLoading] = useState(true)
  // '' while usable; otherwise 'missing', 'inactive' or 'replaced'.
  const [inactive, setInactive] = useState('')
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
  // Held in memory only: a reload means signing in again.
  const [session, setSession] = useState(null)
  const [signingFor, setSigningFor] = useState(null)

  async function loadList() {
    setLoading(true)
    try {
      const result = await getSiteForms(token)
      if (result.error?.status === 401) {
        markUnauthorized()
        setError('')
        return
      }
      if (result.error) {
        setError(result.error.message)
        return
      }
      storeFloorToken(token)
      setSiteName(result.data?.site_name || '')
      setToday(result.data?.today || '')
      setForms(result.data?.forms || [])
      setInactive('')
      setError('')
    } catch {
      setError('Could not reach the forms service. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // A 401 on a token this device already had means it was revoked or replaced.
  function markUnauthorized() {
    if (token && readStoredFloorToken() === token) {
      clearStoredFloorToken()
      setInactive('replaced')
      return
    }
    setInactive('inactive')
  }

  useEffect(() => addFloorAppHead(), [])

  useEffect(() => {
    if (!token) {
      setInactive('missing')
      setLoading(false)
      return
    }
    if (pathToken) {
      window.history.replaceState(window.history.state, '', paths.floorLink(token))
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
    if (!sessionValid()) {
      setError('')
      setSaved('')
      setSigningFor({ form, resume: false, notice: '' })
      return
    }
    startForm(form)
  }

  function startForm(form) {
    setError('')
    setSaved('')
    setActive(form)
    setFormState(startState(form.archetype))
  }

  function sessionValid() {
    return Boolean(session?.token) && Date.parse(session.expiresAt) > Date.now()
  }

  function requireSignIn(notice) {
    setSession(null)
    setSigningFor({ form: active, resume: true, notice })
  }

  function handleSignedIn(next) {
    const pending = signingFor
    setSession(next)
    setSigningFor(null)
    if (pending && !pending.resume) startForm(pending.form)
  }

  function signOut() {
    setSession(null)
    closeForm()
  }

  function closeForm() {
    setActive(null)
    setError('')
    setSaved('')
  }

  // Remounting the renderer blanks the pads, which only read their value on mount.
  function clearSignatures(state) {
    const values = { ...(state.values || {}) }
    for (const fieldId of signatureFieldIds(active?.schema, active?.archetype)) {
      if (fieldId in values) values[fieldId] = ''
    }
    setFormState({ ...state, values, signoff: { ...state.signoff, signature: '' } })
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

    if (!sessionValid()) {
      requireSignIn(SIGN_IN_AGAIN_NOTICE)
      return
    }

    setSaving(true)
    let nextState = formState
    const draft = await saveSiteForm(
      token,
      {
        template_id: active.template_id,
        status: 'draft',
        for_date: active.for_date || null,
        submission_id: draftIds[active.template_id] || undefined,
        data: buildPublicSubmissionData(nextState),
      },
      session.token,
    )
    if (draft.error) {
      if (draft.error.status === 401) {
        markUnauthorized()
        setSaving(false)
        return
      }
      if (draft.data?.session === 'required') {
        requireSignIn(SIGN_IN_AGAIN_NOTICE)
        setSaving(false)
        return
      }
      if (draft.data?.redraw) clearSignatures(nextState)
      setError(draft.error.message)
      setSaving(false)
      return
    }

    const submissionId = draft.data.submission_id
    setDraftIds((current) => ({ ...current, [active.template_id]: submissionId }))

    if (isSignatureDataUrl(nextState.signoff?.signature)) {
      const uploaded = await uploadDrawnSignature(nextState.signoff.signature, draft.data.upload)
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextState = {
        ...nextState,
        signoff: { ...nextState.signoff, signature: uploaded.path },
      }
      setFormState(nextState)
    }

    for (const [fieldId, value] of Object.entries(nextState.values || {})) {
      if (!isSignatureDataUrl(value)) continue
      const uploaded = await uploadDrawnSignature(value, draft.data.field_uploads?.[fieldId])
      if (uploaded.error) {
        setError(uploaded.error.message)
        setSaving(false)
        return
      }
      nextState = {
        ...nextState,
        values: { ...nextState.values, [fieldId]: uploaded.path },
      }
      setFormState(nextState)
    }

    if (status === 'draft') {
      setSaved('Draft saved.')
      setSaving(false)
      return
    }

    const completed = await saveSiteForm(
      token,
      {
        template_id: active.template_id,
        status: 'complete',
        for_date: active.for_date || null,
        submission_id: submissionId,
        data: buildPublicSubmissionData(nextState),
      },
      session.token,
    )
    if (completed.error) {
      if (completed.error.status === 401) {
        markUnauthorized()
        setSaving(false)
        return
      }
      if (completed.data?.session === 'required') {
        requireSignIn(SIGN_IN_AGAIN_NOTICE)
        setSaving(false)
        return
      }
      if (completed.data?.redraw) clearSignatures(nextState)
      setError(completed.error.message)
      setSaving(false)
      return
    }

    setSaved('Form submitted.')
    setSaving(false)
    setSession(null)
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
    const notice = INACTIVE_NOTICES[inactive] || INACTIVE_NOTICES.inactive
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            {notice.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base text-muted-foreground">{notice.message}</p>
        </CardContent>
      </Card>
    )
  }

  if (signingFor) {
    return (
      <FloorSignIn
        token={token}
        siteName={siteName}
        formName={signingFor.form?.name || ''}
        notice={signingFor.notice}
        onSignedIn={handleSignedIn}
        onCancel={() => setSigningFor(null)}
        onInactive={() => {
          setSigningFor(null)
          markUnauthorized()
        }}
      />
    )
  }

  const signedInLine = sessionValid() ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground md:text-sm">
      <span>Signed in as {session.name}</span>
      <Button type="button" variant="link" className="h-auto p-0" disabled={saving} onClick={signOut}>
        Sign out
      </Button>
    </div>
  ) : null

  if (active) {
    return (
      <section className="flex w-full max-w-2xl flex-col gap-5">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">{siteName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{active.name}</h1>
          {signedInLine}
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
        {signedInLine}
      </header>
      <FloorInstallGuide siteName={siteName} />
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
