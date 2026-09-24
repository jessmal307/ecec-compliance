import { Navigate, Route, Routes } from 'react-router-dom'
import { AccountSettings } from './components/AccountSettings'
import { AppLayout } from './components/AppLayout'
import { Attention } from './components/Attention'
import { AuthForm } from './components/AuthForm'
import { ForgotPassword } from './components/ForgotPassword'
import { Compliance } from './components/Compliance'
import { Gaps } from './components/Gaps'
import { Overview } from './components/Overview'
import { ResetPassword } from './components/ResetPassword'
import { SetupScreen } from './components/SetupScreen'
import { SiteProfile } from './components/SiteProfile'
import { Sites } from './components/Sites'
import { FormComplete } from './components/FormComplete'
import { FormPreview } from './components/FormPreview'
import { FormSubmissionView } from './components/FormSubmissionView'
import { Forms } from './components/Forms'
import { Landing } from './components/Landing'
import { ImportStaff } from './components/ImportStaff'
import { NewStaff } from './components/NewStaff'
import { Staff } from './components/Staff'
import { StaffProfile } from './components/StaffProfile'
import { LegalLinks } from './components/LegalDocument'
import { Privacy } from './components/Privacy'
import { Security } from './components/Security'
import { Terms } from './components/Terms'
import { ThemeToggle } from './components/ThemeToggle'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './hooks/useAuth'
import { isSupabaseConfigured } from './lib/supabase'
import { paths } from './lib/paths'
import './App.css'

function GuestShell({ children }) {
  return (
    <div className="guest-shell">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {children}
      <div className="absolute inset-x-0 bottom-4">
        <LegalLinks />
      </div>
    </div>
  )
}

function AppShell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <GuestShell>
        <p className="status" role="status" aria-live="polite">
          Loading…
        </p>
      </GuestShell>
    )
  }

  return (
    <Routes>
      <Route
        path={paths.resetPassword}
        element={
          <GuestShell>
            <ResetPassword />
          </GuestShell>
        }
      />
      {session ? (
        <Route element={<AppLayout />}>
          <Route path={paths.home} element={<Overview />} />
          <Route path={paths.staff} element={<Staff />} />
          <Route path={paths.newStaff} element={<NewStaff />} />
          <Route path={paths.importStaff} element={<ImportStaff />} />
          <Route path="/staff/:staffId" element={<StaffProfile />} />
          <Route path={paths.sites} element={<Sites />} />
          <Route path="/sites/:siteId" element={<SiteProfile />} />
          <Route path={paths.compliance} element={<Compliance />} />
          <Route path={paths.forms} element={<Forms />} />
          <Route
            path="/forms/submissions/:submissionId"
            element={<FormSubmissionView />}
          />
          <Route path="/forms/:templateId/complete" element={<FormComplete />} />
          <Route path="/forms/:templateId" element={<FormPreview />} />
          <Route
            path={paths.requirements}
            element={
              <Navigate
                to={{ pathname: paths.settings, search: '?tab=requirements' }}
                replace
              />
            }
          />
          <Route path={paths.gaps} element={<Gaps />} />
          <Route path={paths.attention} element={<Attention />} />
          <Route path={paths.settings} element={<AccountSettings />} />
          <Route path={paths.privacy} element={<Privacy />} />
          <Route path={paths.terms} element={<Terms />} />
          <Route path={paths.security} element={<Security />} />
          <Route path="*" element={<Navigate to={paths.home} replace />} />
        </Route>
      ) : (
        <>
          <Route path={paths.home} element={<Landing />} />
          <Route
            path={paths.login}
            element={
              <GuestShell>
                <AuthForm mode="login" />
              </GuestShell>
            }
          />
          <Route
            path={paths.signup}
            element={
              <GuestShell>
                <AuthForm mode="signup" />
              </GuestShell>
            }
          />
          <Route
            path={paths.privacy}
            element={
              <GuestShell>
                <Privacy />
              </GuestShell>
            }
          />
          <Route
            path={paths.terms}
            element={
              <GuestShell>
                <Terms />
              </GuestShell>
            }
          />
          <Route
            path={paths.security}
            element={
              <GuestShell>
                <Security />
              </GuestShell>
            }
          />
          <Route
            path={paths.forgotPassword}
            element={
              <GuestShell>
                <ForgotPassword />
              </GuestShell>
            }
          />
          <Route path="*" element={<Navigate to={paths.home} replace />} />
        </>
      )}
    </Routes>
  )
}

function App() {
  if (!isSupabaseConfigured) {
    return (
      <GuestShell>
        <SetupScreen />
      </GuestShell>
    )
  }

  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

export default App
