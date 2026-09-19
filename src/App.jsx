import { Navigate, Route, Routes, Link } from 'react-router-dom'
import { AccountSettings } from './components/AccountSettings'
import { AppLayout } from './components/AppLayout'
import { Attention } from './components/Attention'
import { AuthForm } from './components/AuthForm'
import { ForgotPassword } from './components/ForgotPassword'
import { ComplianceItems } from './components/ComplianceItems'
import { Gaps } from './components/Gaps'
import { Overview } from './components/Overview'
import { ResetPassword } from './components/ResetPassword'
import { Requirements } from './components/Requirements'
import { SetupScreen } from './components/SetupScreen'
import { SiteProfile } from './components/SiteProfile'
import { Sites } from './components/Sites'
import { NewStaff } from './components/NewStaff'
import { Staff } from './components/Staff'
import { StaffProfile } from './components/StaffProfile'
import { Privacy } from './components/Privacy'
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
      <p className="absolute inset-x-0 bottom-4 text-center">
        <Link
          to={paths.privacy}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Privacy
        </Link>
      </p>
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
          <Route path="/staff/:staffId" element={<StaffProfile />} />
          <Route path={paths.sites} element={<Sites />} />
          <Route path="/sites/:siteId" element={<SiteProfile />} />
          <Route path={paths.compliance} element={<ComplianceItems />} />
          <Route path={paths.requirements} element={<Requirements />} />
          <Route path={paths.gaps} element={<Gaps />} />
          <Route path={paths.attention} element={<Attention />} />
          <Route path={paths.settings} element={<AccountSettings />} />
          <Route path={paths.privacy} element={<Privacy />} />
          <Route path="*" element={<Navigate to={paths.home} replace />} />
        </Route>
      ) : (
        <>
          <Route
            path={paths.privacy}
            element={
              <GuestShell>
                <Privacy />
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
          <Route
            path="*"
            element={
              <GuestShell>
                <AuthForm />
              </GuestShell>
            }
          />
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
