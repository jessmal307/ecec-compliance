import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from './ui/form'
import { PageError, PageMuted } from './ui/page'
import { listSiteStaff, verifyStaffPin } from '../lib/siteFormsPublic'

export function FloorSignIn({ token, siteName, formName, notice = '', onSignedIn, onCancel, onInactive }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')

  async function loadStaff() {
    setLoading(true)
    const result = await listSiteStaff(token)
    if (result.error?.status === 401) {
      onInactive()
      return
    }
    if (result.error) {
      setError(result.error.message)
      setStaff([])
    } else {
      setStaff(result.data?.staff || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadStaff()
  }, [token])

  function choose(person) {
    setError('')
    setPin('')
    setSelected(person)
  }

  async function handleVerify(event) {
    event.preventDefault()
    if (!selected) return
    if (!/^\d{4}$/.test(pin)) {
      setError('Enter your 4-digit PIN.')
      return
    }
    setVerifying(true)
    setError('')
    const result = await verifyStaffPin(token, selected.id, pin)
    setVerifying(false)
    setPin('')
    if (result.error?.status === 401) {
      onInactive()
      return
    }
    if (result.error) {
      setError(result.error.message)
      if (result.data?.pick_again) {
        setSelected(null)
        loadStaff()
      }
      return
    }
    onSignedIn({
      token: result.data.session,
      expiresAt: result.data.expires_at,
      name: result.data.staff?.name || selected.name,
    })
  }

  return (
    <section className="flex w-full max-w-lg flex-col gap-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{siteName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {selected ? `Hi ${selected.name}` : 'Who’s signing?'}
        </h1>
        {formName ? <p className="text-base text-muted-foreground">{formName}</p> : null}
      </header>
      {notice && !error ? <PageMuted>{notice}</PageMuted> : null}
      <PageError>{error}</PageError>
      <Card>
        <CardContent className="space-y-4 pt-6">
          {selected ? (
            <form className="space-y-4" onSubmit={handleVerify}>
              <Field label="Your 4-digit PIN">
                <Input
                  type="password"
                  name="floor-pin"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  disabled={verifying}
                  autoFocus
                />
              </Field>
              <Button type="submit" className="min-h-12 w-full" disabled={verifying}>
                {verifying ? 'Checking…' : 'Continue'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-12 w-full"
                disabled={verifying}
                onClick={() => choose(null)}
              >
                Not you? Pick your name
              </Button>
            </form>
          ) : loading ? (
            <PageMuted>Loading staff…</PageMuted>
          ) : staff.length === 0 ? (
            <PageMuted>No staff can sign at this site yet. Ask your director.</PageMuted>
          ) : (
            <ul className="flex flex-col gap-2">
              {staff.map((person) => (
                <li key={person.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12 w-full justify-start text-base"
                    onClick={() => choose(person)}
                  >
                    {person.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full"
            disabled={verifying}
            onClick={onCancel}
          >
            Back
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
