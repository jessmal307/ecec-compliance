import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from './ui/page'
import { ComplianceCalendar } from './ComplianceCalendar'
import { ComplianceItems } from './ComplianceItems'
import { ComplianceMatrix } from './ComplianceMatrix'

const COMPLIANCE_TABS = new Set(['matrix', 'items', 'calendar'])

export function Compliance() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab = COMPLIANCE_TABS.has(requestedTab) ? requestedTab : 'matrix'

  function setTab(next) {
    if (next === 'items' || next === 'calendar') {
      setSearchParams({ tab: next })
      return
    }
    setSearchParams({})
  }

  return (
    <section className="flex w-full min-w-0 flex-col gap-6 text-left">
      <PageHeader
        title="Compliance"
        description="Required checks across your service, and the records you have entered."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="no-print">
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix">
          <ComplianceMatrix />
        </TabsContent>
        <TabsContent value="calendar">
          <ComplianceCalendar />
        </TabsContent>
        <TabsContent value="items">
          <ComplianceItems embedded />
        </TabsContent>
      </Tabs>
    </section>
  )
}
