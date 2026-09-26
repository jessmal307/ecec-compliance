export const PRIVACY_TITLE = 'Privacy & Data Handling'
export const PRIVACY_UPDATED = '19/09/2026'
export const PRIVACY_CONTACT_EMAIL = 'jmalek42@gmail.com'

export const PRIVACY_SECTIONS = [
  {
    heading: 'What we collect',
    paragraphs: [
      "To help you track compliance, we store: your account details (name, email, organisation name); your centres' details; your staff members' names, roles, and contact details; and compliance records — certificate types, reference numbers, issue and expiry dates, and any documents you choose to upload. We deliberately collect only what's needed to track compliance — no home addresses, dates of birth, or other personal details.",
    ],
  },
  {
    heading: 'Why we collect it',
    paragraphs: [
      'Solely to record your compliance items and alert you before they expire. We do not use it for anything else, and we never sell or share it.',
    ],
  },
  {
    heading: "How it's stored and secured",
    paragraphs: [
      "Your data is hosted on Supabase (secure cloud infrastructure) and encrypted both in transit and at rest. Each operator's data is isolated so that no operator can ever see another's. Uploaded documents are kept in private storage, accessible only through short-lived secure links to your own account.",
    ],
  },
  {
    heading: 'Who can access it',
    paragraphs: [
      'Only you and the users you authorise on your account. Our team does not access your data except where you explicitly ask us to for support.',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: [
      'For as long as your account is active. If you close your account or ask us to delete your data, we will remove it.',
    ],
  },
  {
    heading: 'Data breaches',
    paragraphs: [
      "In the unlikely event of a data breach affecting your information, we will notify you promptly, in line with Australia's Notifiable Data Breaches scheme.",
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      `You can access, correct, or delete your data at any time. To make a request or ask a question, contact us at ${PRIVACY_CONTACT_EMAIL}`,
    ],
  },
]
