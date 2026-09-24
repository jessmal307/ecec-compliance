import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormRenderer } from './forms/FormRenderer'
import { useFormsAccess } from './Forms'
import { PageError, PageHeader, PageMuted } from './ui/page'
import { archetypeLabel, getFormTemplate } from '../lib/forms'
import { formsHref, paths } from '../lib/paths'

export function FormPreview() {
  const { templateId } = useParams()
  const { allowed, loading: accessLoading } = useFormsAccess()
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accessLoading || !allowed || !templateId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await getFormTemplate(templateId)
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setTemplate(null)
        setLoading(false)
        return
      }
      setTemplate(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [accessLoading, allowed, templateId])

  if (accessLoading) {
    return <PageMuted>Loading form…</PageMuted>
  }

  if (!allowed) {
    return <Navigate to={paths.home} replace />
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title={template?.name || 'Form'}
        description="Interactive preview — nothing is saved."
        actions={
          <div className="flex flex-wrap gap-2">
            {template ? (
              <Button asChild>
                <Link to={formsHref({ assign: template.id })}>Assign</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to={paths.forms}>Back to forms</Link>
            </Button>
          </div>
        }
      />

      <PageError>{error}</PageError>

      {loading ? (
        <PageMuted>Loading form…</PageMuted>
      ) : !template ? (
        <PageMuted>This template is not available.</PageMuted>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <Badge variant="secondary">Preview</Badge>
            <Badge variant="outline">
              {archetypeLabel(template.archetype)}
            </Badge>
            <CardTitle className="w-full">{template.name}</CardTitle>
            {template.description ? (
              <p className="w-full text-base text-muted-foreground md:text-sm">
                {template.description}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <FormRenderer
              archetype={template.archetype}
              schema={template.schema}
            />
          </CardContent>
        </Card>
      )}
    </section>
  )
}
