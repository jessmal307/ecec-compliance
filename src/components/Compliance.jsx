import { useSearchParams } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from './ui/page'
import { ComplianceItems } from './ComplianceItems'

export function Compliance() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'items' ? 'items' : 'matrix'

  function setTab(next) {
    if (next === 'items') {
      setSearchParams({ tab: 'items' })
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
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle>Matrix</CardTitle>
              <CardDescription>
                A staff-and-site view of required checks. This tab will be built
                next.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Nothing here yet. Use Items to add and edit compliance records.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="items">
          <ComplianceItems embedded />
        </TabsContent>
      </Tabs>
    </section>
  )
}
