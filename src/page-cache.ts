import { getPage, type CanvasCourse, type CanvasModule, type CanvasPage } from "./canvas.js"
import { cachedResource, loadResource, prefetchResource, resourceKey, selectResourceForPrefetch } from "./resource-cache.js"

const maxPrefetchRequests = 3

function pageKey(courseId: CanvasCourse["id"], pageUrl: string) {
  return resourceKey("page", String(courseId), pageUrl)
}

export function cachedPage(courseId: CanvasCourse["id"], pageUrl: string) {
  const stored = cachedResource<CanvasPage>(pageKey(courseId, pageUrl))
  return stored ? { page: stored.value, fresh: stored.fresh } : undefined
}

export function loadPage(courseId: CanvasCourse["id"], pageUrl: string, refresh = false): Promise<CanvasPage> {
  const key = pageKey(courseId, pageUrl)
  return loadResource(key, () => getPage(courseId, pageUrl), refresh)
}

export function prefetchPage(courseId: CanvasCourse["id"], pageUrl: string) {
  return prefetchResource(pageKey(courseId, pageUrl), () => getPage(courseId, pageUrl))
}

export function selectPageForPrefetch(courseId: CanvasCourse["id"], pageUrl: string) {
  return selectResourceForPrefetch(pageKey(courseId, pageUrl), () => getPage(courseId, pageUrl))
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
