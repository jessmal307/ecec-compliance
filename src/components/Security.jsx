import { useAuth } from '../hooks/useAuth'
import {
  SECURITY_CONTACT_EMAIL,
  SECURITY_SECTIONS,
  SECURITY_TITLE,
  SECURITY_UPDATED,
} from '../content/security'
import { LegalDocument } from './LegalDocument'

export function Security() {
  const { session } = useAuth()


  return (
    <LegalDocument
      title={SECURITY_TITLE}
      updated={SECURITY_UPDATED}
      contactEmail={SECURITY_CONTACT_EMAIL}
      sections={SECURITY_SECTIONS}
      session={session}
    />
  )
}
