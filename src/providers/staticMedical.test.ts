import { describe, expect, it, vi } from 'vitest'

import { createStaticMedicalProvider } from './staticMedical'

const origin = { latitude: 35.681236, longitude: 139.767125 }

function facility(id: string, type: 'hospital' | 'clinic' | 'dental' | 'pharmacy' | 'midwifery', latitude: number) {
  return {
    id,
    type,
    name: `${type}-${id}`,
    coordinates: { latitude, longitude: 139.767125 },
    prefectureCode: '13',
    municipalityCode: '13101',
    sourceUpdatedAt: '2026-06-01'
  }
}

describe('static medical provider', () => {
  it('manifestにある30km圏のシャードから5区分を検索する', async () => {
    const manifest = {
      dataVersion: '2026-06-01', schemaVersion: 1, gridSizeDegrees: 0.25,
      grids: { '142-559': 5 }
    }
    const records = [
      facility('h', 'hospital', 35.6813),
      facility('c', 'clinic', 35.6814),
      facility('d', 'dental', 35.6815),
      facility('p', 'pharmacy', 35.6816),
      facility('m', 'midwifery', 35.6817)
    ]
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return Response.json(manifest)
      if (url.endsWith('142-559.json')) return Response.json(records)
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const result = await createStaticMedicalProvider({ fetchImpl }).fetchMedical(origin)

    expect(result.hospitals[0].id).toBe('h')
    expect(result.clinics[0].id).toBe('c')
    expect(result.dentalClinics[0].id).toBe('d')
    expect(result.pharmacies[0].id).toBe('p')
    expect(result.midwiferyCenters[0].id).toBe('m')
    expect(result.partialData).toBe(false)
  })

  it('一部シャードの取得失敗は取得済み範囲を返し、不完全表示を明示する', async () => {
    const manifest = {
      dataVersion: '2026-06-01', schemaVersion: 1, gridSizeDegrees: 0.25,
      grids: { '142-559': 1, '142-560': 1 }
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return Response.json(manifest)
      if (url.endsWith('142-559.json')) return Response.json([facility('h', 'hospital', 35.6813)])
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await createStaticMedicalProvider({ fetchImpl }).fetchMedical(origin)

    expect(result.hospitals[0].id).toBe('h')
    expect(result.partialData).toBe(true)
    expect(result.missingShardCount).toBe(1)
  })

  it('対象シャードを1件も読めなければカード単位のエラーにする', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) {
        return Response.json({ dataVersion: '2026-06-01', schemaVersion: 1, gridSizeDegrees: 0.25, grids: { '142-559': 1 } })
      }
      return new Response('', { status: 503 })
    }) as typeof fetch

    await expect(createStaticMedicalProvider({ fetchImpl }).fetchMedical(origin))
      .rejects.toMatchObject({ code: 'MEDICAL_SHARD_MISSING' })
  })

  it('10km内に病院・一般診療所が各3件あれば30km側のシャードを取得しない', async () => {
    const manifest = {
      dataVersion: '2026-06-01', schemaVersion: 1, gridSizeDegrees: 0.25,
      grids: { '142-559': 6, '141-557': 1 }
    }
    const records = [
      ...[1, 2, 3].map((index) => facility(`h${index}`, 'hospital', 35.6813 + index / 100_000)),
      ...[1, 2, 3].map((index) => facility(`c${index}`, 'clinic', 35.6814 + index / 100_000))
    ]
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return Response.json(manifest)
      if (url.endsWith('142-559.json')) return Response.json(records)
      if (url.endsWith('141-557.json')) return Response.json([facility('outer', 'hospital', 35.45)])
      throw new Error(`unexpected ${url}`)
    })

    const result = await createStaticMedicalProvider({ fetchImpl: fetchImpl as unknown as typeof fetch }).fetchMedical(origin)

    expect(result.searchRadiusKm).toBe(10)
    expect(fetchImpl.mock.calls.some(([input]) => String(input).endsWith('141-557.json'))).toBe(false)
  })
})
