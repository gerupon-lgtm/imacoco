import { describe, expect, it, vi } from 'vitest'

import { createStaticStationProvider, gridIdsForRadius } from './staticStations'

const origin = { latitude: 35.681236, longitude: 139.767125 }

describe('static station provider', () => {
  it('30km外接矩形の0.25度グリッドを列挙する', () => {
    const ids = gridIdsForRadius(origin, 30_000)
    expect(ids).toContain('142-559')
    expect(ids.length).toBeGreaterThan(4)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('manifestに存在する近傍shardだけを読み、最寄り3駅を返す', async () => {
    const relevantGrid = '142-559'
    const manifest = {
      dataVersion: '2025-12-31', sourceDataset: 'N05', schemaVersion: 1,
      gridSizeDegrees: 0.25, usageRestriction: 'non-commercial', grids: { [relevantGrid]: 2 }
    }
    const stations = [
      {
        id: 'tokyo', name: '東京', coordinates: { latitude: 35.6812, longitude: 139.7671 },
        lines: [{ lineName: '東海道線', operatorName: '東日本旅客鉄道', operatorType: '2' }],
        sourceRelationIds: ['r1'], installedStartYear: 1914, installedEndYear: 9999, dataVersion: '2025-12-31'
      },
      {
        id: 'yurakucho', name: '有楽町', coordinates: { latitude: 35.6751, longitude: 139.7638 },
        lines: [], sourceRelationIds: ['r2'], installedStartYear: 1910, installedEndYear: 9999, dataVersion: '2025-12-31'
      }
    ]
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return Response.json(manifest)
      if (url.endsWith(`${relevantGrid}.json`)) return Response.json(stations)
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const result = await createStaticStationProvider({ fetchImpl, baseUrl: '/data/stations' }).fetchStations(origin)
    expect(result.stations.map((station) => station.name)).toEqual(['東京', '有楽町'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('必要shardが1つでも壊れたら部分結果を表示しない', async () => {
    const ids = gridIdsForRadius(origin, 30_000)
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) {
        return Response.json({
          dataVersion: '2025-12-31', sourceDataset: 'N05', schemaVersion: 1,
          gridSizeDegrees: 0.25, usageRestriction: 'non-commercial', grids: { [ids[0]]: 1, [ids[1]]: 1 }
        })
      }
      return new Response('', { status: url.endsWith(`${ids[1]}.json`) ? 404 : 200 })
    }) as typeof fetch

    await expect(createStaticStationProvider({ fetchImpl, baseUrl: '/data/stations' }).fetchStations(origin))
      .rejects.toMatchObject({ code: 'STATION_SHARD_ERROR' })
  })
})
