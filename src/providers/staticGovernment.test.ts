import { describe, expect, it, vi } from 'vitest'

import { createStaticGovernmentProvider } from './staticGovernment'

const origin = { latitude: 35.681236, longitude: 139.767125 }
const office = (overrides: Record<string, unknown>) => ({
  id: '13-pref', municipalityCode: '13', officeType: 'prefectural', name: '東京都庁',
  coordinates: { latitude: 35.6895, longitude: 139.6917 },
  officialUrl: 'https://www.metro.tokyo.lg.jp/', sourceAddress: '新宿区西新宿2-8-1',
  sourceUrl: 'https://amano-tec.com/data/localgovernments.html', checkedAt: '2026-08-11',
  ...overrides
})

describe('static government provider', () => {
  it('自治体コードから都道府県庁と管轄役所を返す', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return Response.json({ dataVersion: '2026-01-15', schemaVersion: 1, recordCount: 2 })
      return Response.json([
        office({}),
        office({ id: '13101-ward', municipalityCode: '13101', officeType: 'ward', name: '千代田区役所', coordinates: { latitude: 35.6939, longitude: 139.7536 } })
      ])
    }) as typeof fetch

    const result = await createStaticGovernmentProvider({ fetchImpl }).fetchGovernment(origin, '13101')

    expect(result.prefecturalOffice.name).toBe('東京都庁')
    expect(result.jurisdictionOffice.name).toBe('千代田区役所')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('不正な庁舎データはカード単位の形式エラーにする', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith('manifest.json')
      ? Response.json({ dataVersion: '2026-01-15', schemaVersion: 1, recordCount: 1 })
      : Response.json([office({ officialUrl: 'http://example.com' })])) as typeof fetch

    await expect(createStaticGovernmentProvider({ fetchImpl }).fetchGovernment(origin, '13101'))
      .rejects.toMatchObject({ code: 'GOVERNMENT_DATA_INVALID' })
  })
})
