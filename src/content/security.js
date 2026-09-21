export const SECURITY_TITLE = 'Data security'
export const SECURITY_UPDATED = '21/09/2026'
export const SECURITY_CONTACT_EMAIL = 'jmalek42@gmail.com'

export const SECURITY_SECTIONS = [
  {
    heading: 'Where it lives',
    paragraphs: [
      'Your data is hosted on Supabase, which runs on SOC 2 Type II–certified infrastructure, in an Australian (Sydney) data region — your information stays onshore.',
    ],
  },
  {
    heading: 'Encryption',
    paragraphs: [
      'All data is encrypted in transit (HTTPS/TLS) and at rest.',
    ],
  },
  {
    heading: 'Isolation',
    paragraphs: [
      "Each operator's data is separated by row-level security — no operator can ever access another's, and we test this directly.",
    ],
  },
  {
    heading: 'Documents',
    paragraphs: [
      'Uploaded certificates and records are kept in private storage, reachable only through short-lived secure links to your own account — never public.',
    ],
  },
  {
    heading: 'Access',
    paragraphs: [
      'Only you and the users you authorise can access your data, protected by secure login. Our team does not access your data except where you explicitly ask us to for support.',
    ],
  },
  {
    heading: "We collect only what's needed",
    paragraphs: [
      'We deliberately keep personal information to the minimum required for compliance tracking.',
    ],
  },
  {
    heading: 'Backups',
    paragraphs: [
      'Your records are backed up automatically to protect against loss.',
    ],
  },
  {
    heading: 'If something goes wrong',
    paragraphs: [
      "In the unlikely event of a data breach affecting your information, we will notify you promptly, in line with Australia's Notifiable Data Breaches scheme.",
    ],
  },
  {
    heading: 'Who else touches your data',
    paragraphs: [
      'Only our essential service providers: Supabase (database & hosting), Resend (sending alert emails), and Vercel (app hosting). We never sell or share your data.',
    ],
  },
  {
    heading: 'Deletion',
    paragraphs: [
      'Your data is kept while your account is active and deleted on request.',
    ],
  },
]
