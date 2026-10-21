import type { ComponentProps } from 'react'
import { observer } from 'mobx-react-lite'
import { Focus } from 'lucide-react'
import { getTranslations } from 'polotno/config'
import type { StoreType } from 'polotno/model/store'
import type { ImageElementType } from 'polotno/model/image-model'
import { Button } from 'polotno/primitives/button'
import { ImageEdit } from 'polotno/toolbar/image-tools'
import { preciseRetryAvailable, retryPrecise } from './ai-image-tools'

// Shown right after Vision or the standard model removed the image's
// background: reruns it with the precise model.
const PreciseBackgroundButton = observer(
  ({ store, element }: { store: StoreType; element: ImageElementType }) => {
    if (!preciseRetryAvailable(element)) return null
    const texts = (getTranslations() as unknown as { backgroundRemoval: Record<string, string> })
      .backgroundRemoval
    return (
      <Button
        variant="ghost"
        size="sm"
        title={texts.notRight}
        disabled={!!element.pendingEdit}
        onClick={() => retryPrecise(store, element)}
      >
        <Focus className="size-3.5" />
        {texts.tryHq}
      </Button>
    )
  }
)

// Polotno's "AI edit" toolbar item with the button next to it (custom
// toolbar items go last, into the overflow menu on most widths).
export const ImageEditWithPrecise = observer((props: ComponentProps<typeof ImageEdit>) => (
  <div className="flex items-center">
    <ImageEdit {...props} />
    <PreciseBackgroundButton store={props.store} element={props.element} />
  </div>
))
