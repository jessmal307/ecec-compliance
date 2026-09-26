import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, Input } from './ui/form'
import { PageError, PageMuted, PageSuccess } from './ui/page'
import { formatTimestamp } from '../lib/format'
import { getOrganization } from '../lib/organizations'
import { can } from '../lib/plans'
import { getStaffPinStatus, pinProblem, setStaffPin } from '../lib/staffPins'

export function StaffFloorPin({ organizationId, staffId, disabled = false }) {
  const [allowed, setAllowed] = useState(false)
  const [setAt, setSetAt] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    getOrganization(organizationId).then(({ data }) => {
      if (!cancelled) setAllowed(can(data, 'forms'))
    })

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!allowed || !staffId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await getStaffPinStatus(staffId)
      if (cancelled) return
      if (loadError) setError('Could not load the PIN status.')
      else setSetAt(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [allowed, staffId])

  if (!allowed) return null

  function closeEditor() {
    setEditing(false)
    setPin('')
  }

  async function handleSave(event) {
    event.preventDefault()
    setError('')
    setSaved('')
    const problem = pinProblem(pin)
    if (problem) {
      setError(problem)
      return
    }

    setSaving(true)
    const hadPin = Boolean(setAt)
    const { data, error: saveError } = await setStaffPin(staffId, pin)
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSetAt(data)
    setSaved(hadPin ? 'PIN reset.' : 'PIN set.')
    closeEditor()
  }

  const busy = disabled || saving || loading

  return (
    <Card>
      <CardHeader>
        <CardTitle>Floor link PIN</CardTitle>
        <CardDescription>
          Staff pick their name and enter this 4-digit PIN to sign forms on the floor link.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PageError>{error}</PageError>
        <PageSuccess>{saved}</PageSuccess>
        {loading ? (
          <PageMuted>Loading…</PageMuted>
        ) : (
          <p className="text-base md:text-sm">
            {setAt
              ? `PIN set ${formatTimestamp(setAt)}`
              : 'No PIN. This person can’t sign on the floor link.'}
          </p>
        )}
        {editing ? (
          <form className="space-y-3" onSubmit={handleSave}>
            <Field
              label={setAt ? 'New PIN' : 'PIN'}
              hint="4 digits. Not the same digit four times, and not a run like 1234 or 4321."
            >
              <Input
                type="text"
                name="floor-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
                }
                disabled={busy}
                autoFocus
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {saving ? 'Saving…' : 'Save PIN'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={closeEditor}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError('')
              setSaved('')
              setEditing(true)
            }}
          >
            {setAt ? 'Reset PIN' : 'Set PIN'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
