import { canvasBaseUrl } from "./canvas.js"

type Entry = {
  value?: unknown
  hasValue: boolean
  expiresAt: number
  nextCheckAt: number
  nextPrefetchAt: number
  lastError?: unknown
}

const maxEntries = 80
const maxPrefetchRequests = 3
const defaultLifetimeMs = 5 * 60_000
const requestCooldownMs = 30_000
const entries = new Map<string, Entry>()
const pending = new Map<string, Promise<unknown>>()
const progress = new Map<string, { value: unknown; hasNext: boolean; listeners: Set<(value: unknown, hasNext: boolean) => void> }>()
let activePrefetchRequests = 0
let selectedPrefetch: { key: string; scope: string; loader: () => Promise<unknown>; lifetimeMs: number } | undefined

function resourceScope() {
  return JSON.stringify([canvasBaseUrl(), process.env.CANVAS_ACCESS_TOKEN])
}

export function resourceKey(...parts: Array<string | number | boolean>) {
  // The token is only held in memory, never written with the cached data.
  return JSON.stringify([canvasBaseUrl(), process.env.CANVAS_ACCESS_TOKEN, ...parts])
}

function remember(key: string, entry: Entry) {
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

export function cachedResource<T>(key: string): { value: T; fresh: boolean } | undefined {
  const entry = entries.get(key)
  if (!entry?.hasValue) return undefined
  remember(key, entry)
  return { value: entry.value as T, fresh: entry.expiresAt > Date.now() }
}

export function resourcePending(key: string) {
  return pending.has(key)
}

export function reportResourceProgress<T>(key: string, value: T, hasNext: boolean) {
  const state = progress.get(key) ?? { value, hasNext, listeners: new Set<(value: unknown, hasNext: boolean) => void>() }
  state.value = value
  state.hasNext = hasNext
  progress.set(key, state)
  for (const listener of state.listeners) listener(value, hasNext)
}

export function subscribeResourceProgress<T>(key: string, listener: (value: T, hasNext: boolean) => void) {
  const state = progress.get(key) ?? { value: undefined, hasNext: true, listeners: new Set<(value: unknown, hasNext: boolean) => void>() }
  const callback = listener as (value: unknown, hasNext: boolean) => void
  state.listeners.add(callback)
  progress.set(key, state)
  if (state.value !== undefined) listener(state.value as T, state.hasNext)
  return () => {
    state.listeners.delete(callback)
    if (!state.listeners.size && !pending.has(key)) progress.delete(key)
  }
}

export function resourcePrefetchAllowed(key: string) {
  const entry = entries.get(key)
  return !pending.has(key) && Date.now() >= (entry?.nextPrefetchAt ?? 0) && Date.now() >= (entry?.nextCheckAt ?? 0)
}

export function allowExplicitRetryAfterPrefetchFailure(key: string) {
  const entry = entries.get(key)
  if (!entry) return
  entry.nextCheckAt = 0
  entry.nextPrefetchAt = Date.now() + requestCooldownMs
}

export function loadResource<T>(key: string, loader: () => Promise<T>, refresh = false, lifetimeMs = defaultLifetimeMs): Promise<T> {
  const existing = pending.get(key)
  if (existing) return existing as Promise<T>
  const entry = entries.get(key)
  if (!refresh && entry?.hasValue && entry.expiresAt > Date.now()) return Promise.resolve(entry.value as T)
  if (entry && Date.now() < entry.nextCheckAt) {
    if (entry.hasValue) return Promise.resolve(entry.value as T)
    return Promise.reject(entry.lastError ?? new Error("Innehållet kan hämtas igen om en stund."))
  }

  const request = loader().then(value => {
    const current = entries.get(key) ?? { hasValue: false, expiresAt: 0, nextCheckAt: 0, nextPrefetchAt: 0 }
    current.value = value
    current.hasValue = true
    current.expiresAt = Date.now() + lifetimeMs
    current.nextCheckAt = Date.now() + requestCooldownMs
    delete current.lastError
    remember(key, current)
    return value
  }, error => {
    const current = entries.get(key) ?? { hasValue: false, expiresAt: 0, nextCheckAt: 0, nextPrefetchAt: 0 }
    current.nextCheckAt = Date.now() + requestCooldownMs
    current.lastError = error
    remember(key, current)
    throw error
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key)
    progress.delete(key)
  })
  pending.set(key, request)
  return request
}

export function prefetchResource<T>(key: string, loader: () => Promise<T>, lifetimeMs = defaultLifetimeMs) {
  if (activePrefetchRequests >= maxPrefetchRequests || !resourcePrefetchAllowed(key) || cachedResource<T>(key)?.fresh) return false
  activePrefetchRequests++
  void loadResource(key, loader, false, lifetimeMs).catch(() => {
    // The first explicit opening can retry after a failed speculative request.
    allowExplicitRetryAfterPrefetchFailure(key)
  }).finally(() => {
    activePrefetchRequests--
    runSelectedPrefetch()
  })
  return true
}

function runSelectedPrefetch() {
  if (!selectedPrefetch || activePrefetchRequests >= maxPrefetchRequests) return
  const selected = selectedPrefetch
  selectedPrefetch = undefined
  if (selected.scope !== resourceScope()) return
  prefetchResource(selected.key, selected.loader, selected.lifetimeMs)
}

export function selectResourceForPrefetch<T>(key: string, loader: () => Promise<T>, lifetimeMs = defaultLifetimeMs) {
  const selected = { key, scope: resourceScope(), loader, lifetimeMs }
  selectedPrefetch = selected
  runSelectedPrefetch()
  return () => {
    if (selectedPrefetch === selected) selectedPrefetch = undefined
  }
}
