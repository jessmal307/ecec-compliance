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
import { Field, FormActions, FormSection, PasswordInput, Input } from './ui/form'
import { PageError, PageSuccess } from './ui/page'
import { paths } from '../lib/paths'
import { supabase } from '../lib/supabase'

export function AuthForm() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isSignUp = mode === 'signup'

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)

    try {
      if (isSignUp) {
        const organizationName = `${email.split('@')[0]}'s organization`
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { organization_name: organizationName },
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

  function switchMode() {
    setMode(isSignUp ? 'login' : 'signup')
    setError('')
    setMessage('')
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {isSignUp ? 'Create account' : 'Log in'}
        </CardTitle>
        <CardDescription>
          {isSignUp
            ? 'Sign up with email and password. An organization will be created for you.'
            : 'Welcome back. Use your email and password to continue.'}
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
              {isSignUp ? null : (
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

          <FormActions>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Please wait…' : isSignUp ? 'Sign up' : 'Log in'}
            </Button>
          </FormActions>
        </form>

        <p className="mt-4 text-center text-base text-muted-foreground md:text-sm">
          {isSignUp ? 'Already have an account?' : 'Need an account?'}{' '}
          <button
            type="button"
            className="inline-flex min-h-11 items-center font-medium text-card-foreground underline underline-offset-4"
            onClick={switchMode}
          >
            {isSignUp ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </CardContent>
    </Card>
  )
}
