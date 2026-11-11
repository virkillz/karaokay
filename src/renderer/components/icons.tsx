import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const stroke = (size: number, sw: number, props: P): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props
})

export const IconPlay = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
)
export const IconPause = ({ size = 20, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <rect x="5" y="4" width="5" height="16" rx="1.6" />
    <rect x="14" y="4" width="5" height="16" rx="1.6" />
  </svg>
)
export const IconSkip = ({ size = 17, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M4 5.5v13L15 12z" />
    <rect x="16.8" y="5" width="3.2" height="14" rx="1.2" />
  </svg>
)
export const IconRestart = ({ size = 17, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <rect x="4" y="5" width="3.2" height="14" rx="1.2" />
    <path d="M20 5.5v13L9 12z" />
  </svg>
)
export const IconPlus = ({ size = 15, ...p }: P) => (
  <svg {...stroke(size, 4, p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const IconMinus = ({ size = 15, ...p }: P) => (
  <svg {...stroke(size, 4, p)}>
    <path d="M5 12h14" />
  </svg>
)
export const IconX = ({ size = 14, ...p }: P) => (
  <svg {...stroke(size, 3.5, p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const IconSearch = ({ size = 19, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.6-4.6" />
  </svg>
)
export const IconPlayNext = ({ size = 16, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />
  </svg>
)
export const IconExpand = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
)
export const IconCollapse = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
)
export const IconUpload = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
  </svg>
)
export const IconSettings = ({ size = 20, ...p }: P) => (
  <svg {...stroke(size, 2.6, p)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.4" />
    <circle cx="10" cy="17" r="2.4" />
  </svg>
)
export const IconGrip = ({ size = 14, ...p }: P) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 14 20" fill="currentColor" aria-hidden {...p}>
    {[4, 10, 16].map((y) => (
      <g key={y}>
        <circle cx="4" cy={y} r="1.8" />
        <circle cx="10" cy={y} r="1.8" />
      </g>
    ))}
  </svg>
)
export const IconHeart = ({ size = 14, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...stroke(size, 2.6, p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
)
export const IconMore = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="12" cy="12" r="2.2" />
    <circle cx="19" cy="12" r="2.2" />
  </svg>
)
export const IconBack = ({ size = 16, ...p }: P) => (
  <svg {...stroke(size, 3, p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)
