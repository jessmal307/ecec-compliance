import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FormActions, FormSection, Input } from './ui/form'
import { PageError, PageSuccess } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { paths } from '../lib/paths'
import { supabase } from '../lib/supabase'

function hasRecoveryParams() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('code') || params.get('type') === 'recovery') return true
  return window.location.hash.includes('access_token')
}

export function ResetPassword() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [waitingForLink, setWaitingForLink] = useState(
    () => !session && hasRecoveryParams(),
  )

  useEffect(() => {
    if (session) {
      setWaitingForLink(false)
      return
    }

    if (!hasRecoveryParams()) {
      setWaitingForLink(false)
    }
  }, [session])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (password !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setSubmitting(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    setMessage('Password updated. Taking you to the app…')
    setSubmitting(false)
    navigate(paths.home, { replace: true })
  }

  if (waitingForLink) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Set a new password
          </CardTitle>
          <CardDescription>Confirming your reset link…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!session) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Set a new password
          </CardTitle>
          <CardDescription>
            This reset link is invalid or has expired. Request a new one and try
            again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-base text-muted-foreground md:text-sm">
            <Link
              to={paths.forgotPassword}
              className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Set a new password
        </CardTitle>
        <CardDescription>
          Choose a new password for {session.user?.email ?? 'your account'}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <FormSection title="Password">
            <div className="grid grid-cols-1 gap-4">
              <Field label="New password">
                <Input
                  type="password"
                  name="new_password"
                  autoComplete="new-password"
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  name="confirm_password"
                  autoComplete="new-password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
            </div>
          </FormSection>

          <PageError>{error}</PageError>
          <PageSuccess>{message}</PageSuccess>

          <FormActions>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Please wait…' : 'Update password'}
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  )
}
