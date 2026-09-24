import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageError, PageMuted } from '../ui/page'
import { formatDate } from '../../lib/format'
import {
  assignmentTargetLabel,
  cadenceLabel,
  listAssignments,
  setAssignmentActive,
} from '../../lib/forms'
import { firstError } from '../../lib/query'
import { listSites } from '../../lib/sites'
import { listStaff } from '../../lib/staff'

export function FormAssignments({ organizationId }) {
  const [assignments, setAssignments] = useState([])
  const [sites, setSites] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deactivatingId, setDeactivatingId] = useState(null)

  useEffect(() => {
    if (!organizationId) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const [assignmentResult, sitesResult, staffResult] = await Promise.all([
        listAssignments(organizationId),
        listSites(organizationId),
        listStaff(organizationId),
      ])
      if (cancelled) return
      const loadError = firstError(assignmentResult, sitesResult, staffResult)
      if (loadError) {
        setError(loadError.message)
        setAssignments([])
        setLoading(false)
        return
      }
      setAssignments(assignmentResult.data)
      setSites(sitesResult.data ?? [])
      setStaff(staffResult.data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [organizationId])

  async function handleDeactivate(id) {
    setDeactivatingId(id)
    setError('')
    const { error: saveError } = await setAssignmentActive(id, false)
    setDeactivatingId(null)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setAssignments((current) => current.filter((row) => row.id !== id))
  }

  if (loading) {
    return <PageMuted>Loading assignments…</PageMuted>
  }

  return (
    <div className="space-y-4">
      <PageError>{error}</PageError>
      {assignments.length === 0 ? (
        <PageMuted>
          No assigned forms yet. Open a template and choose Assign.
        </PageMuted>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{assignment.template_name}</CardTitle>
                  <CardDescription>
                    {assignmentTargetLabel(assignment, { sites, staff })}
                    {' · '}
                    {cadenceLabel(assignment.cadence)}
                    {' · '}
                    Due {formatDate(assignment.next_due)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deactivatingId === assignment.id}
                    onClick={() => handleDeactivate(assignment.id)}
                  >
                    {deactivatingId === assignment.id
                      ? 'Deactivating…'
                      : 'Deactivate'}
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
