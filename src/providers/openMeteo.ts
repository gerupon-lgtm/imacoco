import { z } from 'zod'

const elevationResponseSchema = z
  .object({
    elevation: z.number().finite().optional()
  })
  .passthrough()

export function normalizeApproximateElevation(response: unknown) {
  const parsed = elevationResponseSchema.safeParse(response)

  if (!parsed.success || parsed.data.elevation === undefined) {
    return undefined
  }

  return Math.round(parsed.data.elevation)
}
