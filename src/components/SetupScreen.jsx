import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function SetupScreen() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Connect Supabase
        </CardTitle>
        <CardDescription>
          Copy <code>.env.example</code> to <code>.env</code> and add your
          project URL and anon key. Then run the SQL in{' '}
          <code>supabase/schema.sql</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-card-foreground">
          <li>Create a project at supabase.com</li>
          <li>
            Paste <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> into <code>.env</code>
          </li>
          <li>
            Run <code>supabase/schema.sql</code> in the SQL editor
          </li>
          <li>Restart the Vite dev server</li>
        </ol>
      </CardContent>
    </Card>
  )
}
