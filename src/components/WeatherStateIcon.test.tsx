import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WeatherStateIcon } from './WeatherStateIcon'

describe('WeatherStateIcon', () => {
  it.each([
    [0, 'sun'],
    [1, 'sun'],
    [2, 'partly-cloudy'],
    [3, 'cloud'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'rain'],
    [61, 'rain'],
    [80, 'rain'],
    [71, 'snow'],
    [85, 'snow'],
    [95, 'thunderstorm'],
    [99, 'thunderstorm'],
  ])('WMOコード%dに%sアイコンを割り当てる', (weatherCode, iconName) => {
    const { container } = render(<WeatherStateIcon weatherCode={weatherCode as number} />)

    expect(container.querySelector('svg')).toHaveClass(`app-icon--${iconName}`)
  })

  it('未知のWMOコードは中立的なくもりアイコンにする', () => {
    const { container } = render(<WeatherStateIcon weatherCode={1234} />)

    expect(container.querySelector('svg')).toHaveClass('app-icon--cloud')
  })
})
