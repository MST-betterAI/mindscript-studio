import { createUniqueId, type ComponentProps } from "solid-js"

// mindscript_change: the original was 8 hand-drawn letterform paths spelling "OPENCODE" —
// left over from the fork, never rebranded. Hand-authoring matching vector paths for
// "MINDSCRIPT" (10 letters) isn't worth the effort for a faint background watermark, so
// this renders the word as text instead, keeping the same faint/masked-fade treatment.
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 900 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <text
            x="450"
            y="105"
            text-anchor="middle"
            font-family="Arial Black, Helvetica Neue, Arial, sans-serif"
            font-weight="900"
            font-size="108"
            letter-spacing="2"
            opacity="0.16"
            fill="currentColor"
          >
            MINDSCRIPT
          </text>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="129">
          <rect width="900" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="450" y1="68" x2="450" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
