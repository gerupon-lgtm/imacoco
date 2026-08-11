export type AppIconName =
  | 'building'
  | 'chevron'
  | 'clock'
  | 'map'
  | 'medical'
  | 'partly-cloudy'
  | 'pin'
  | 'refresh'
  | 'share'
  | 'shield'
  | 'sun'
  | 'sunrise'
  | 'sunset'
  | 'train'
  | 'trash'
  | 'waves'

type AppIconProps = {
  name: AppIconName
  className?: string
}

function IconBody({ name }: { name: AppIconName }) {
  switch (name) {
    case 'refresh':
      return <><path d="M37 14v10H27" /><path d="M35 24a13 13 0 1 1-3-13" /></>
    case 'share':
      return <><circle cx="13" cy="24" r="4" /><circle cx="35" cy="11" r="4" /><circle cx="35" cy="37" r="4" /><path d="m16.5 22 15-8.8M16.5 26l15 8.8" /></>
    case 'clock':
      return <><circle cx="24" cy="24" r="18" /><path d="M24 13v12l8 5" /></>
    case 'pin':
      return <><path d="M24 43s13-11.3 13-24a13 13 0 1 0-26 0c0 12.7 13 24 13 24Z" /><circle cx="24" cy="19" r="4.5" /></>
    case 'sun':
      return <><circle className="icon-sun-fill" cx="24" cy="24" r="8" /><path className="icon-sun-ray" d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.3 4.3M33.1 33.1l4.3 4.3M37.4 10.6l-4.3 4.3M14.9 33.1l-4.3 4.3" /></>
    case 'partly-cloudy':
      return <><circle className="icon-sun-fill" cx="17" cy="17" r="8" /><path className="icon-sun-ray" d="M17 3v5M17 26v5M3 17h5M26 17h5M7.2 7.2l3.6 3.6M23.2 23.2l3.6 3.6M26.8 7.2l-3.6 3.6" /><path className="icon-cloud" d="M16 39h22a7 7 0 0 0 .5-14 11 11 0 0 0-20.7-2.7A8.5 8.5 0 0 0 16 39Z" /></>
    case 'sunrise':
    case 'sunset':
      return <><path className="icon-sun-arc" d="M14 30a10 10 0 0 1 20 0" /><path className="icon-sun-ray" d="M24 8v7M8 30h5M35 30h5M12.5 17.5l4 4M35.5 17.5l-4 4" /><path className="icon-horizon" d="M7 35h34M13 41h22" /></>
    case 'waves':
      return <><path d="M5 14c4-5 8 5 12 0s8 5 12 0 8 5 14 0M5 24c4-5 8 5 12 0s8 5 12 0 8 5 14 0M5 34c4-5 8 5 12 0s8 5 12 0 8 5 14 0" /></>
    case 'train':
      return <><rect className="icon-soft-fill" x="11" y="5" width="26" height="31" rx="7" /><path d="M16 36 11 43M32 36l5 7M15 43h18" /><rect x="16" y="10" width="16" height="10" rx="2" /><path d="M14 26h20" /><circle cx="17" cy="30" r="2" /><circle cx="31" cy="30" r="2" /></>
    case 'building':
      return <><path className="icon-soft-fill" d="m5 18 19-11 19 11Z" /><path d="M8 19h32M10 39h28M6 44h36M13 20v19M21 20v19M29 20v19M37 20v19" /></>
    case 'medical':
      return <><circle className="icon-soft-fill" cx="24" cy="24" r="19" /><path className="icon-cross" d="M24 14v20M14 24h20" /></>
    case 'shield':
      return <><path className="icon-soft-fill" d="M24 5 39 11v11c0 10-6.3 17.2-15 21-8.7-3.8-15-11-15-21V11Z" /><path d="M24 13v21M17 24h14" /></>
    case 'trash':
      return <><path d="M10 14h28M18 14V9h12v5M14 14l2 28h16l2-28M21 21v14M27 21v14" /></>
    case 'map':
      return <><path className="icon-soft-fill" d="m5 10 12-5 14 5 12-5v33l-12 5-14-5-12 5Z" /><path d="M17 5v33M31 10v33" /></>
    case 'chevron':
      return <path d="m18 10 14 14-14 14" />
  }
}

export function AppIcon({ name, className = '' }: AppIconProps) {
  return (
    <svg
      className={`app-icon app-icon--${name} ${className}`.trim()}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <IconBody name={name} />
    </svg>
  )
}
