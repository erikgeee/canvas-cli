import { canvasBaseUrl, getPage, type CanvasCourse, type CanvasModule, type CanvasPage } from "./canvas.js"

type PageEntry = {
  page?: CanvasPage
  expiresAt?: number
  nextCheckAt?: number
  nextPrefetchAt?: number
  lastError?: unknown
}

const maxPages = 40
const pageLifetimeMs = 5 * 60_000
const requestCooldownMs = 30_000
const maxPrefetchRequests = 3

const entries = new Map<string, PageEntry>()
const pending = new Map<string, Promise<CanvasPage>>()
let activePrefetchRequests = 0
let selectedPrefetch: { key: string; courseId: CanvasCourse["id"]; pageUrl: string } | undefined

function pageKey(courseId: CanvasCourse["id"], pageUrl: string) {
  // Keep different Canvas hosts and accounts separate, even if their course IDs match.
  return JSON.stringify([canvasBaseUrl(), process.env.CANVAS_ACCESS_TOKEN, String(courseId), pageUrl])
}

function remember(key: string, entry: PageEntry) {
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > maxPages) {
    const oldestKey = entries.keys().next().value
    if (oldestKey === undefined) break
    entries.delete(oldestKey)
  }
}

export function cachedPage(courseId: CanvasCourse["id"], pageUrl: string) {
  const key = pageKey(courseId, pageUrl)
  const entry = entries.get(key)
  if (!entry?.page) return undefined
  remember(key, entry)
  return { page: entry.page, fresh: (entry.expiresAt ?? 0) > Date.now() }
}

export function loadPage(courseId: CanvasCourse["id"], pageUrl: string, refresh = false): Promise<CanvasPage> {
  const key = pageKey(courseId, pageUrl)
  const entry = entries.get(key) ?? {}
  const existing = pending.get(key)
  if (existing) return existing
  if (!refresh && entry.page && (entry.expiresAt ?? 0) > Date.now()) return Promise.resolve(entry.page)
  if (Date.now() < (entry.nextCheckAt ?? 0)) {
    if (entry.page) return Promise.resolve(entry.page)
    return Promise.reject(entry.lastError ?? new Error("Sidan kan hämtas igen om en stund."))
  }

  const request = getPage(courseId, pageUrl).then(page => {
    const current = entries.get(key) ?? entry
    delete current.lastError
    current.nextCheckAt = Date.now() + requestCooldownMs
    current.page = page
    current.expiresAt = Date.now() + pageLifetimeMs
    remember(key, current)
    return page
  }, error => {
    const current = entries.get(key) ?? entry
    current.lastError = error
    current.nextCheckAt = Date.now() + requestCooldownMs
    remember(key, current)
    throw error
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key)
  })
  pending.set(key, request)
  return request
}

export function prefetchPage(courseId: CanvasCourse["id"], pageUrl: string) {
  if (activePrefetchRequests >= maxPrefetchRequests) return false
  const key = pageKey(courseId, pageUrl)
  const entry = entries.get(key)
  if (pending.has(key) || Date.now() < (entry?.nextPrefetchAt ?? 0) || Date.now() < (entry?.nextCheckAt ?? 0)) return false
  if (cachedPage(courseId, pageUrl)?.fresh) return false
  activePrefetchRequests++
  void loadPage(courseId, pageUrl).catch(() => {
    // A speculative failure must not make the first explicit opening wait 30 seconds.
    const failedEntry = entries.get(key)
    if (failedEntry) {
      failedEntry.nextCheckAt = 0
      failedEntry.nextPrefetchAt = Date.now() + requestCooldownMs
    }
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
  if (pageKey(selected.courseId, selected.pageUrl) !== selected.key) return
  prefetchPage(selected.courseId, selected.pageUrl)
}

export function selectPageForPrefetch(courseId: CanvasCourse["id"], pageUrl: string) {
  const selected = { key: pageKey(courseId, pageUrl), courseId, pageUrl }
  selectedPrefetch = selected
  runSelectedPrefetch()
  return () => {
    if (selectedPrefetch === selected) selectedPrefetch = undefined
  }
}

export function prefetchModulePages(courseId: CanvasCourse["id"], modules: CanvasModule[]) {
  const seen = new Set<string>()
  let started = 0
  for (const module of modules) {
    for (const item of module.items ?? []) {
      if (item.type !== "Page" || !item.page_url || seen.has(item.page_url)) continue
      seen.add(item.page_url)
      if (prefetchPage(courseId, item.page_url)) started++
      if (started >= maxPrefetchRequests) return
    }
  }
}

export function prefetchNextPages(courseId: CanvasCourse["id"], pageUrl: string, modules: CanvasModule[]) {
  const pages: string[] = []
  for (const module of modules) {
    for (const item of module.items ?? []) {
      if (item.type === "Page" && item.page_url && !pages.includes(item.page_url)) pages.push(item.page_url)
    }
  }
  const current = pages.indexOf(pageUrl)
  for (const next of pages.slice(current + 1, current + 3)) prefetchPage(courseId, next)
}
