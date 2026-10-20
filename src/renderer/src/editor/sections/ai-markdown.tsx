import { memo } from 'react'
import { Streamdown } from 'streamdown'

// Agent replies are markdown. Streamdown copes with half-written syntax while
// the text streams in. Links open in the browser: window.ts denies new
// windows and hands their URLs to the OS.
export const Markdown = memo(function Markdown({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  return (
    <Streamdown
      className="ai-markdown px-1 text-sm leading-relaxed"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      controls={false}
      linkSafety={{ enabled: false }}
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline">
            {children}
          </a>
        )
      }}
    >
      {text}
    </Streamdown>
  )
})
