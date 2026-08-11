import { describe, expect, it, vi } from 'vitest'

import { runWithOneRetry } from './retry'

describe('runWithOneRetry', () => {
  it('一時エラーなら1回だけ再試行する', async () => {
    const transient = new Error('transient')
    const operation = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('ok')

    await expect(runWithOneRetry(operation, (error) => error === transient)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('再試行対象外のエラーはそのまま返す', async () => {
    const permanent = new Error('permanent')
    const operation = vi.fn().mockRejectedValue(permanent)

    await expect(runWithOneRetry(operation, () => false)).rejects.toBe(permanent)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('2回目も失敗した場合は2回目のエラーを返す', async () => {
    const first = new Error('first')
    const second = new Error('second')
    const operation = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)

    await expect(runWithOneRetry(operation, () => true)).rejects.toBe(second)
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
