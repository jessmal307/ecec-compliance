import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormSection, Input } from './ui/form'
import { PageError, PageMuted } from './ui/page'
import { useAuth } from '../hooks/useAuth'
import { openFloorPoster } from '../lib/floorPoster'
import { formatTimestamp } from '../lib/format'
import { getOrganization } from '../lib/organizations'
import { paths } from '../lib/paths'
import { can } from '../lib/plans'
import {
  createSiteAccessToken,
  hashFloorToken,
  listSiteAccessTokens,
  mintFloorToken,
  revokeSiteAccessToken,
} from '../lib/siteAccessTokens'

const COPY_WARNING = "Copy this now — for security it won't be shown again."

function formatUsedAt(value) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function floorLinkUrl(rawToken) {
  return `${window.location.origin}${paths.floorLink(rawToken)}`
}

export function SiteFloorLinks({ organizationId, siteId, siteName = '', disabled = false }) {
  const { user } = useAuth()
  const [allowed, setAllowed] = useState(false)
  const [links, setLinks] = useState([])
  const [label, setLabel] = useState('')
  const [freshUrl, setFreshUrl] = useState('')
  const [replaced, setReplaced] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revokingId, setRevokingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    getOrganization(organizationId).then(({ data }) => {
      if (!cancelled) setAllowed(can(data, 'forms'))
    })

    return () => {
      cancelled = true
    }
  }, [organizationId])

  useEffect(() => {
    if (!allowed || !organizationId || !siteId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const { data, error: loadError } = await listSiteAccessTokens(
        organizationId,
        siteId,
      )
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setLinks([])
        setLoading(false)
        return
      }
      setLinks(data)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [allowed, organizationId, siteId])

  if (!allowed) return null

  async function mint(revokeId) {
    setSaving(true)
    setError('')
    setCopied(false)

    const rawToken = mintFloorToken()
    const tokenHash = await hashFloorToken(rawToken)
    const created = await createSiteAccessToken({
      orgId: organizationId,
      siteId,
      tokenHash,
      label,
      createdBy: user?.id,
    })
    if (created.error) {
      setError(created.error.message)
      setSaving(false)
      return
    }

    if (revokeId) {
      const revoked = await revokeSiteAccessToken(revokeId)
      if (revoked.error) {
        setError(revoked.error.message)
        setLinks((current) => [created.data, ...current])
        setFreshUrl(floorLinkUrl(rawToken))
        setReplaced(false)
        setLabel('')
        setSaving(false)
        return
      }
    }

    setLinks((current) => [
      created.data,
      ...current.filter((row) => row.id !== revokeId),
    ])
    setFreshUrl(floorLinkUrl(rawToken))
    setReplaced(Boolean(revokeId))
    setLabel('')
    setSaving(false)
  }

  async function handleRevoke(id) {
    setRevokingId(id)
    setError('')
    const { error: revokeError } = await revokeSiteAccessToken(id)
    setRevokingId('')
    if (revokeError) {
      setError(revokeError.message)
      return
    }
    setLinks((current) => current.filter((row) => row.id !== id))
  }

  async function handleCopy() {
    if (!freshUrl) return
    try {
      await navigator.clipboard.writeText(freshUrl)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the link and copy it yourself.')
    }
  }

  async function handlePrintPoster() {
    if (!freshUrl) return
    setError('')
    const printed = await openFloorPoster({ siteName, url: freshUrl })
    if (printed.error) setError(printed.error.message)
  }

  const busy = disabled || saving || loading

  return (
    <FormSection
      title="Floor completion link"
      description="Staff on a shared tablet use this link to complete today’s forms. No login."
    >
      <div className="space-y-4">
        <PageError>{error}</PageError>
        {freshUrl ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <p className="break-all text-sm font-medium">{freshUrl}</p>
            <p className="text-sm text-muted-foreground">{COPY_WARNING}</p>
            {replaced ? (
              <p className="text-sm text-foreground">
                Print the new poster and re-open the new link on the centre
                tablet — the old poster and tablet link have stopped working.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={handleCopy}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                type="button"
                variant={replaced ? 'default' : 'outline'}
                disabled={busy}
                onClick={handlePrintPoster}
              >
                Print QR poster
              </Button>
            </div>
          </div>
        ) : null}
        <Field label="Label" hint="Optional. For example, Reception tablet.">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => mint()}
        >
          {saving ? 'Generating…' : 'Generate floor link'}
        </Button>
        {loading ? (
          <PageMuted>Loading links…</PageMuted>
        ) : links.length === 0 ? (
          <PageMuted>No active floor links.</PageMuted>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {links.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">{row.label || 'Floor link'}</p>
                  <p className="text-sm text-muted-foreground">
                    Created {formatTimestamp(row.created_at)}
                    {' · '}
                    Last used {formatUsedAt(row.last_used_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || revokingId === row.id}
                    onClick={() => mint(row.id)}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || revokingId === row.id}
                    onClick={() => handleRevoke(row.id)}
                  >
                    {revokingId === row.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormSection>
  )
}
