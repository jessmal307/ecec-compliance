import { useAuth } from '../hooks/useAuth'
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_SECTIONS,
  PRIVACY_TITLE,
  PRIVACY_UPDATED,
} from '../content/privacy'
import { LegalDocument } from './LegalDocument'

export function Privacy() {
  const { session } = useAuth()

  return (
    <LegalDocument
      title={PRIVACY_TITLE}
      updated={PRIVACY_UPDATED}
      contactEmail={PRIVACY_CONTACT_EMAIL}
      sections={PRIVACY_SECTIONS}
      session={session}
    />
  )
}
