import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_SECTIONS,
  PRIVACY_TITLE,
  PRIVACY_UPDATED,
} from '../content/privacy'
import { paths } from '../lib/paths'

function PolicyParagraph({ text }) {
  const parts = text.split(PRIVACY_CONTACT_EMAIL)

  return (
    <p className="text-base leading-relaxed text-muted-foreground md:text-sm">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? (
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="font-medium text-card-foreground underline underline-offset-4"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
          ) : null}
        </span>
      ))}
    </p>
  )
}

export function Privacy() {
  const { session } = useAuth()

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={PRIVACY_TITLE}
        description={`Last updated: ${PRIVACY_UPDATED}`}
        actions={
          session ? null : (
            <Button asChild variant="outline" size="sm">
              <Link to={paths.home}>Back to log in</Link>
            </Button>
          )
        }
      />

      <Card className="w-full max-w-3xl">
        <CardContent className="space-y-6 pt-(--card-spacing)">
          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h2 className="text-base font-semibold tracking-tight text-card-foreground">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <PolicyParagraph key={paragraph} text={paragraph} />
              ))}
            </section>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
