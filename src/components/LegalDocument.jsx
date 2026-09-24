import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from './ui/page'
import { paths } from '../lib/paths'

const legalLinkClassName =
  'inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4'

function PolicyParagraph({ text, contactEmail }) {
  if (!contactEmail || !text.includes(contactEmail)) {
    return (
      <p className="text-base leading-relaxed text-muted-foreground md:text-sm">
        {text}
      </p>
    )
  }

  const parts = text.split(contactEmail)

  return (
    <p className="text-base leading-relaxed text-muted-foreground md:text-sm">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? (
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-card-foreground underline underline-offset-4"
            >
              {contactEmail}
            </a>
          ) : null}
        </span>
      ))}
    </p>
  )
}

export function LegalDocument({ title, updated, contactEmail, sections, session }) {
  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={title}
        description={`Last updated: ${updated}`}
        actions={
          session ? null : (
            <Button asChild variant="outline" size="sm">
              <Link to={paths.login}>Back to log in</Link>
            </Button>
          )
        }
      />

      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="space-y-6 pt-(--card-spacing)">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-base font-semibold tracking-tight text-card-foreground">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <PolicyParagraph
                  key={paragraph}
                  text={paragraph}
                  contactEmail={contactEmail}
                />
              ))}
            </section>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

export function LegalLinks() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-muted-foreground">
      <Link to={paths.privacy} className={legalLinkClassName}>
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link to={paths.terms} className={legalLinkClassName}>
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link to={paths.security} className={legalLinkClassName}>
        Security
      </Link>
    </p>
  )
}
