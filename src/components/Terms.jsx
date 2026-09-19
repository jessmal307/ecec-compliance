import { useAuth } from '../hooks/useAuth'
import {
  TERMS_CONTACT_EMAIL,
  TERMS_SECTIONS,
  TERMS_TITLE,
  TERMS_UPDATED,
} from '../content/terms'
import { LegalDocument } from './LegalDocument'

export function Terms() {
  const { session } = useAuth()

  return (
    <LegalDocument
      title={TERMS_TITLE}
      updated={TERMS_UPDATED}
      contactEmail={TERMS_CONTACT_EMAIL}
      sections={TERMS_SECTIONS}
      session={session}
    />
  )
}
