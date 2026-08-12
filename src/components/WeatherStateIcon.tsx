import { AppIcon, type AppIconName } from './AppIcon'

export function weatherIconName(weatherCode: number): AppIconName {
  if (weatherCode === 0 || weatherCode === 1) return 'sun'
  if (weatherCode === 2) return 'partly-cloudy'
  if (weatherCode === 3) return 'cloud'
  if (weatherCode === 45 || weatherCode === 48) return 'fog'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return 'rain'
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'snow'
  if ([95, 96, 99].includes(weatherCode)) return 'thunderstorm'
  return 'cloud'
}

type WeatherStateIconProps = {
  weatherCode: number
  className?: string
}

export function WeatherStateIcon({ weatherCode, className }: WeatherStateIconProps) {
  return <AppIcon name={weatherIconName(weatherCode)} className={className} />
}
