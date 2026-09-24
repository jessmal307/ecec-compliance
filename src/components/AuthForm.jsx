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
import { Field, FormActions, FormSection, PasswordInput, Input, Choice } from './ui/form'
import { PageError, PageSuccess } from './ui/page'
import { paths } from '../lib/paths'
import { supabase } from '../lib/supabase'

export function AuthForm({ mode = 'login' }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [consentError, setConsentError] = useState('')

  const isSignUp = mode === 'signup'

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setConsentError('')

    if (isSignUp && !acceptedLegal) {
      setConsentError(
        'Please agree to the Privacy Policy, Terms of Service, and Security statement.',
      )
      return
    }

    setSubmitting(true)

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name.trim(),
              organization_name: organizationName.trim(),
            },
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setMessage('Check your email to confirm your account, then log in.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {isSignUp ? 'Create account' : 'Log in'}
        </CardTitle>
        <CardDescription>
          {isSignUp
            ? 'Your organisation name creates your workspace. Your first month is free — no card required.'
            : 'Welcome back. Use your email and password to continue.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <FormSection title="Details">
            <div className="grid grid-cols-1 gap-4">
              {isSignUp ? (
                <Field label="Your name">
                  <Input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    disabled={submitting}
                  />
                </Field>
              ) : null}
              <Field label={isSignUp ? 'Work email' : 'Email'}>
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
              <Field label="Password">
                <PasswordInput
                  name="password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={submitting}
                />
              </Field>
              {isSignUp ? (
                <Field label="Organisation / provider name">
                  <Input
                    type="text"
                    name="organization_name"
                    autoComplete="organization"
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                    required
                    disabled={submitting}
                  />
                </Field>
              ) : (
                <p className="-mt-2 text-right text-sm">
                  <Link
                    to={paths.forgotPassword}
                    className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
                  >
                    Forgot password?
                  </Link>
                </p>
              )}
            </div>
          </FormSection>

          <PageError>{error}</PageError>
          <PageSuccess>{message}</PageSuccess>

          {isSignUp ? (
            <Field error={consentError} className="font-normal">
              <Choice
                type="checkbox"
                name="acceptedLegal"
                className="items-start"
                checked={acceptedLegal}
                onChange={(event) => {
                  setAcceptedLegal(event.target.checked)
                  if (event.target.checked) setConsentError('')
                }}
                required
                disabled={submitting}
                aria-invalid={Boolean(consentError) || undefined}
                aria-label="I agree to the Privacy Policy, Terms of Service, and Security statement"
              >
                <span className="text-muted-foreground">
                  I agree to the{' '}
                  <Link
                    to={paths.privacy}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-card-foreground underline underline-offset-4"
                  >
                    Privacy Policy
                  </Link>
                  ,{' '}
                  <Link
                    to={paths.terms}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-card-foreground underline underline-offset-4"
                  >
                    Terms of Service
                  </Link>
                  , and{' '}
                  <Link
                    to={paths.security}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-card-foreground underline underline-offset-4"
                  >
                    Security
                  </Link>{' '}
                  statement
                </span>
              </Choice>
            </Field>
          ) : null}

          <FormActions>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || (isSignUp && !acceptedLegal)}
            >
              {submitting
                ? 'Please wait…'
                : isSignUp
                  ? 'Start your free month'
                  : 'Log in'}
            </Button>
          </FormActions>
        </form>

        <p className="mt-4 text-center text-base text-muted-foreground md:text-sm">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <Link
                to={paths.login}
                className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
              >
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{' '}
              <Link
                to={paths.signup}
                className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
              >
                Create an account
              </Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
