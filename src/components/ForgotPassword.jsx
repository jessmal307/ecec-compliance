import { useState } from 'react'
import { Link } from 'react-router-dom'
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
import { authRedirectUrl, paths } from '../lib/paths'
import { supabase } from '../lib/supabase'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: authRedirectUrl(paths.resetPassword) },
    )

    if (resetError) {
      setError(resetError.message)
      setSubmitting(false)
      return
    }

    setMessage('If an account exists for that email, we sent a reset link.')
    setSubmitting(false)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Forgot password?
        </CardTitle>
        <CardDescription>
          Enter your email and we will send a link to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <FormSection title="Details">
            <div className="grid grid-cols-1 gap-4">
              <Field label="Email">
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
              {submitting ? 'Please wait…' : 'Send reset link'}
            </Button>
          </FormActions>
        </form>

        <p className="mt-4 text-center text-base text-muted-foreground md:text-sm">
          Remembered your password?{' '}
          <Link
            to={paths.login}
            className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
          >
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
