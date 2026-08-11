import { describe, expect, it } from 'vitest'

import { normalizeApproximateElevation } from './openMeteo'

describe('normalizeApproximateElevation', () => {
  it('Weather API応答の標高を整数mの概算値へ正規化する', () => {
    expect(normalizeApproximateElevation({ elevation: 10.4 })).toBe(10)
  })

  it('標高が欠損または不正でも例外にせず非表示扱いにする', () => {
    expect(normalizeApproximateElevation({})).toBeUndefined()
    expect(normalizeApproximateElevation({ elevation: Number.NaN })).toBeUndefined()
  })
})
