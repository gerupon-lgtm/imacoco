export async function runWithOneRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean
) {
  try {
    return await operation()
  } catch (error) {
    if (!shouldRetry(error)) throw error
    return operation()
  }
}
