import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field, FieldGrid, FormActions, FormSection, Input } from './ui/form'
import { PageError, PageHeader, PageMuted, PageSuccess } from './ui/page'
import { LegalLinks } from './LegalDocument'
import { Requirements } from './Requirements'
import { useAuth } from '../hooks/useAuth'
import { getOrganization, updateOrganization } from '../lib/organizations'
import { supabase } from '../lib/supabase'

function displayNameFromUser(user) {
  return user?.user_metadata?.display_name ?? ''
}

export function AccountSettings() {
  const { user, organizationId, signOut } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const settingsTab = ['organisation', 'requirements'].includes(
    searchParams.get('tab'),
  )
    ? searchParams.get('tab')
    : 'account'
  const [displayName, setDisplayName] = useState(displayNameFromUser(user))
  const [orgName, setOrgName] = useState('')
  const [alertEmail, setAlertEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [orgError, setOrgError] = useState('')
  const [securityError, setSecurityError] = useState('')
  const [alertsError, setAlertsError] = useState('')
  const [accountSaved, setAccountSaved] = useState('')
  const [orgSaved, setOrgSaved] = useState('')
  const [securitySaved, setSecuritySaved] = useState('')
  const [alertsSaved, setAlertsSaved] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)
  const [savingOrg, setSavingOrg] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingAlerts, setSavingAlerts] = useState(false)

  useEffect(() => {
    setDisplayName(displayNameFromUser(user))
  }, [user])

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data, error: orgError } = await getOrganization(organizationId)
      if (cancelled) return
      if (orgError) {
        setError(orgError.message)
        setLoading(false)
        return
      }

      setOrgName(data.name ?? '')
      setAlertEmail(data.alert_email || user?.email || '')
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId, user?.email])

  async function handleSaveAccount(event) {
    event.preventDefault()
    setAccountError('')
    setAccountSaved('')
    setSavingAccount(true)

    const { error: updateError } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim() },
    })

    if (updateError) {
      setAccountError(updateError.message)
      setSavingAccount(false)
      return
    }

    setAccountSaved('Display name saved.')
    setSavingAccount(false)
  }

  async function handleSaveOrganization(event) {
    event.preventDefault()
    if (!organizationId) return

    setOrgError('')
    setOrgSaved('')
    setSavingOrg(true)

    const nextName = orgName.trim()
    const { data, error: saveError } = await updateOrganization(organizationId, {
      name: nextName,
    })

    if (saveError) {
      setOrgError(saveError.message)
      setSavingOrg(false)
      return
    }

    const { error: metaError } = await supabase.auth.updateUser({
      data: { organization_name: nextName },
    })
    if (metaError) {
      setOrgError(metaError.message)
      setSavingOrg(false)
      return
    }

    setOrgName(data.name)
    setOrgSaved('Organisation name saved.')
    setSavingOrg(false)
  }

  async function handleChangePassword(event) {
    event.preventDefault()
    setSecurityError('')
    setSecuritySaved('')

    if (newPassword !== confirmPassword) {
      setSecurityError('New passwords do not match.')
      return
    }

    setSavingPassword(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setSecurityError(updateError.message)
      setSavingPassword(false)
      return
    }

    setNewPassword('')
    setConfirmPassword('')
    setSecuritySaved('Password updated.')
    setSavingPassword(false)
  }

  async function handleSaveAlerts(event) {
    event.preventDefault()
    if (!organizationId) return

    setAlertsError('')
    setAlertsSaved('')
    setSavingAlerts(true)

    const { data, error: saveError } = await updateOrganization(organizationId, {
      alertEmail,
    })

    if (saveError) {
      setAlertsError(saveError.message)
      setSavingAlerts(false)
      return
    }

    setAlertEmail(data.alert_email || user?.email || '')
    setAlertsSaved('Alert email saved.')
    setSavingAlerts(false)
  }

  const formBusy = loading || !organizationId

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Settings"
        description="Account, organisation, requirement types, and legal documents."
      />

      <PageError>{error}</PageError>

      <Tabs
        value={settingsTab}
        onValueChange={(next) => {
          if (next === 'account') setSearchParams({})
          else setSearchParams({ tab: next })
        }}
      >
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="organisation">Organisation</TabsTrigger>
          <TabsTrigger value="requirements">Requirement types</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          {loading ? (
            <Card>
              <PageMuted>Loading settings…</PageMuted>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Account</CardTitle>
                  <CardDescription>
                    Your display name is stored on your login, not on a staff profile.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleSaveAccount}>
                    <FormSection title="Details">
                      <FieldGrid>
                        <Field label="Display name">
                          <Input
                            type="text"
                            name="display_name"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            disabled={savingAccount}
                          />
                        </Field>
                        <Field
                          label="Login email"
                          hint="Used to sign in. This cannot be changed here."
                        >
                          <Input
                            type="email"
                            name="email"
                            value={user?.email ?? ''}
                            readOnly
                            disabled
                          />
                        </Field>
                      </FieldGrid>
                    </FormSection>

                    <PageError>{accountError}</PageError>
                    <PageSuccess>{accountSaved}</PageSuccess>
                    <FormActions>
                      <Button type="submit" disabled={savingAccount}>
                        {savingAccount ? 'Saving…' : 'Save'}
                      </Button>
                    </FormActions>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                  <CardDescription>
                    Change your password or sign out of this device.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleChangePassword}>
                    <FormSection title="Password">
                      <FieldGrid>
                        <Field label="New password">
                          <Input
                            type="password"
                            name="new_password"
                            autoComplete="new-password"
                            minLength={6}
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            required
                            disabled={savingPassword}
                          />
                        </Field>
                        <Field label="Confirm password">
                          <Input
                            type="password"
                            name="confirm_password"
                            autoComplete="new-password"
                            minLength={6}
                            value={confirmPassword}
                            onChange={(event) =>
                              setConfirmPassword(event.target.value)
                            }
                            required
                            disabled={savingPassword}
                          />
                        </Field>
                      </FieldGrid>
                    </FormSection>

                    <PageError>{securityError}</PageError>
                    <PageSuccess>{securitySaved}</PageSuccess>
                    <FormActions>
                      <Button type="submit" disabled={savingPassword}>
                        {savingPassword ? 'Saving…' : 'Update password'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => signOut()}
                        disabled={savingPassword}
                      >
                        <LogOut data-icon="inline-start" />
                        Log out
                      </Button>
                    </FormActions>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="organisation">
          {loading ? (
            <Card>
              <PageMuted>Loading settings…</PageMuted>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Organization</CardTitle>
                  <CardDescription>
                    Shown in the sidebar and on compliance alert emails.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleSaveOrganization}>
                    <FormSection title="Details">
                      <FieldGrid>
                        <Field label="Organisation name" className="col-span-full">
                          <Input
                            type="text"
                            name="organization_name"
                            value={orgName}
                            onChange={(event) => setOrgName(event.target.value)}
                            required
                            disabled={formBusy || savingOrg}
                          />
                        </Field>
                      </FieldGrid>
                    </FormSection>

                    <PageError>{orgError}</PageError>
                    <PageSuccess>{orgSaved}</PageSuccess>
                    <FormActions>
                      <Button type="submit" disabled={formBusy || savingOrg}>
                        {savingOrg ? 'Saving…' : 'Save'}
                      </Button>
                    </FormActions>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Alerts</CardTitle>
                  <CardDescription>
                    Compliance emails go here. Defaults to your login email.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleSaveAlerts}>
                    <FormSection title="Delivery">
                      <FieldGrid>
                        <Field
                          label="Alert email"
                          hint="Renewal, expired, and recheck alerts are sent to this address."
                          className="col-span-full"
                        >
                          <Input
                            type="email"
                            name="alert_email"
                            value={alertEmail}
                            onChange={(event) => setAlertEmail(event.target.value)}
                            required
                            disabled={formBusy || savingAlerts}
                          />
                        </Field>
                      </FieldGrid>
                    </FormSection>

                    <PageError>{alertsError}</PageError>
                    <PageSuccess>{alertsSaved}</PageSuccess>
                    <FormActions>
                      <Button type="submit" disabled={formBusy || savingAlerts}>
                        {savingAlerts ? 'Saving…' : 'Save'}
                      </Button>
                    </FormActions>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="requirements">
          <Requirements embedded />
        </TabsContent>
      </Tabs>

      <LegalLinks />
    </section>
  )
}
