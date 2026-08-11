import { z } from 'zod'

import { clearAppSettings } from './appSettings'
import type { LocationSnapshot, ResourceCacheEntry, ResourceType } from './cachePolicy'

const DATABASE_NAME = 'imakoko-info'
const DATABASE_VERSION = 1
const LATEST_LOCATION_STORE = 'latest-location'
const LATEST_DASHBOARD_STORE = 'latest-dashboard'
const RESOURCE_CACHE_STORE = 'resource-cache'

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
})

const locationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  coordinates: coordinatesSchema,
  accuracyMeters: z.number().finite().nonnegative(),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime()
})

const resourceCacheEntrySchema = z.object({
  resourceType: z.enum(['place', 'weather', 'solar', 'tide', 'government', 'station', 'medical']),
  origin: coordinatesSchema,
  payload: z.unknown(),
  fetchedAt: z.string().datetime(),
  freshUntil: z.string().datetime(),
  staleUntil: z.string().datetime(),
  provider: z.string().min(1),
  dataVersion: z.string().optional()
})

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('端末内データを読み書きできませんでした'))
  })
}

function transactionCompleted(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('端末内データを更新できませんでした'))
    transaction.onabort = () => reject(new Error('端末内データの更新が中断されました'))
  })
}

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDBは利用できません'))
  if (databasePromise) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(LATEST_LOCATION_STORE)) {
        database.createObjectStore(LATEST_LOCATION_STORE)
      }
      if (!database.objectStoreNames.contains(LATEST_DASHBOARD_STORE)) {
        database.createObjectStore(LATEST_DASHBOARD_STORE)
      }
      if (!database.objectStoreNames.contains(RESOURCE_CACHE_STORE)) {
        database.createObjectStore(RESOURCE_CACHE_STORE, { keyPath: 'resourceType' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => {
      databasePromise = undefined
      reject(new Error('端末内データを開けませんでした'))
    }
  })

  return databasePromise
}

export async function putLatestLocation(snapshot: LocationSnapshot) {
  const database = await openDatabase()
  const transaction = database.transaction(LATEST_LOCATION_STORE, 'readwrite')
  transaction.objectStore(LATEST_LOCATION_STORE).put(snapshot, 'latest')
  await transactionCompleted(transaction)
}

export async function getLatestLocation(now = new Date()) {
  const database = await openDatabase()
  const transaction = database.transaction(LATEST_LOCATION_STORE, 'readonly')
  const raw = await requestResult(transaction.objectStore(LATEST_LOCATION_STORE).get('latest'))
  const parsed = locationSnapshotSchema.safeParse(raw)
  if (!parsed.success) return undefined

  if (now.getTime() >= new Date(parsed.data.expiresAt).getTime()) {
    const deleteTransaction = database.transaction(LATEST_LOCATION_STORE, 'readwrite')
    deleteTransaction.objectStore(LATEST_LOCATION_STORE).delete('latest')
    await transactionCompleted(deleteTransaction)
    return undefined
  }

  return parsed.data
}

export async function putResourceCache<T>(entry: ResourceCacheEntry<T>) {
  resourceCacheEntrySchema.parse(entry)
  const database = await openDatabase()
  const transaction = database.transaction(RESOURCE_CACHE_STORE, 'readwrite')
  transaction.objectStore(RESOURCE_CACHE_STORE).put(entry)
  await transactionCompleted(transaction)
}

export async function getResourceCache<T = unknown>(resourceType: ResourceType) {
  const database = await openDatabase()
  const transaction = database.transaction(RESOURCE_CACHE_STORE, 'readonly')
  const raw = await requestResult(transaction.objectStore(RESOURCE_CACHE_STORE).get(resourceType))
  const parsed = resourceCacheEntrySchema.safeParse(raw)
  return parsed.success ? parsed.data as ResourceCacheEntry<T> : undefined
}

export async function deleteResourceCache(resourceType: ResourceType) {
  const database = await openDatabase()
  const transaction = database.transaction(RESOURCE_CACHE_STORE, 'readwrite')
  transaction.objectStore(RESOURCE_CACHE_STORE).delete(resourceType)
  await transactionCompleted(transaction)
}

export async function putLatestDashboard(snapshot: unknown) {
  const database = await openDatabase()
  const transaction = database.transaction(LATEST_DASHBOARD_STORE, 'readwrite')
  transaction.objectStore(LATEST_DASHBOARD_STORE).put(snapshot, 'latest')
  await transactionCompleted(transaction)
}

export async function getLatestDashboard() {
  const database = await openDatabase()
  const transaction = database.transaction(LATEST_DASHBOARD_STORE, 'readonly')
  return requestResult<unknown>(transaction.objectStore(LATEST_DASHBOARD_STORE).get('latest'))
}

export async function clearAllAppData() {
  clearAppSettings()
  const database = await openDatabase()
  const transaction = database.transaction(
    [LATEST_LOCATION_STORE, LATEST_DASHBOARD_STORE, RESOURCE_CACHE_STORE],
    'readwrite'
  )
  transaction.objectStore(LATEST_LOCATION_STORE).clear()
  transaction.objectStore(LATEST_DASHBOARD_STORE).clear()
  transaction.objectStore(RESOURCE_CACHE_STORE).clear()
  await transactionCompleted(transaction)
}
