import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  dismissInstallGuide,
  floorDevicePlatform,
  installGuideDismissed,
  runningFromHomeScreen,
} from '../lib/floorDevice'

const IOS_STEPS = [
  'Tap Share (the square with an arrow).',
  'Tap Add to Home Screen.',
  'Tap Add.',
]

const ANDROID_STEPS = [
  'Tap the ⋮ menu.',
  'Tap Add to Home screen or Install app.',
  'Tap Add.',
]

function Steps({ title, steps }) {
  return (
    <div className="space-y-1">
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      <ol className="list-decimal space-y-1 pl-5 text-base text-muted-foreground md:text-sm">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

export function FloorInstallGuide({ siteName }) {
  const [hidden, setHidden] = useState(() => runningFromHomeScreen() || installGuideDismissed())
  const [platform] = useState(floorDevicePlatform)

  if (hidden) return null

  function dismiss() {
    dismissInstallGuide()
    setHidden(true)
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="space-y-1">
          <p className="text-lg font-medium leading-snug">Add to Home Screen</p>
          <p className="text-base text-muted-foreground md:text-sm">
            Do this from this page so the icon always opens {siteName || 'this centre'}’s forms.
          </p>
        </div>
        {platform === 'ios' ? <Steps steps={IOS_STEPS} /> : null}
        {platform === 'android' ? <Steps steps={ANDROID_STEPS} /> : null}
        {platform === 'other' ? (
          <>
            <Steps title="iPad or iPhone (Safari)" steps={IOS_STEPS} />
            <Steps title="Android (Chrome)" steps={ANDROID_STEPS} />
          </>
        ) : null}
        <Button type="button" variant="outline" className="min-h-12 w-full" onClick={dismiss}>
          Got it
        </Button>
      </CardContent>
    </Card>
  )
}
