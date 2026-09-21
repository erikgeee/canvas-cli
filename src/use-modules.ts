import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import { canvasBaseUrl, listModules, type CanvasCourse, type CanvasModule } from "./canvas.js"
import { moduleReducer } from "./module-state.js"
import { moduleTreeEntries } from "./module-tree.js"

const emptyModules: CanvasModule[] = []
const refreshIntervalMs = 30_000
const courseKey = (course: CanvasCourse) => JSON.stringify([canvasBaseUrl(), String(course.id)])

export function useModules(course: CanvasCourse | null) {
  const [state, dispatch] = useReducer(moduleReducer, new Map())
  const pending = useRef(new Map<string, Promise<void>>())
  const nextCheckAt = useRef(new Map<string, number>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback((selectedCourse: CanvasCourse) => {
    const key = courseKey(selectedCourse)
    const existing = pending.current.get(key)
    if (existing) return existing
    if (Date.now() < (nextCheckAt.current.get(key) ?? 0)) return Promise.resolve()
    dispatch({ type: "load", key })
    const request = listModules(selectedCourse.id).then(modules => {
      if (mounted.current) dispatch({ type: "loaded", key, modules })
    }, error => {
      if (mounted.current) dispatch({ type: "failed", key, message: error instanceof Error ? error.message : "Kunde inte hämta moduler." })
    }).finally(() => {
      // Throttle completed checks too, including failures and manual refreshes.
      nextCheckAt.current.set(key, Date.now() + refreshIntervalMs)
      pending.current.delete(key)
    })
    pending.current.set(key, request)
    return request
  }, [])

  const key = course ? courseKey(course) : null
  const view = key ? state.get(key) : undefined
  const modules = view?.modules ?? emptyModules
  const entries = useMemo(() => moduleTreeEntries(modules), [modules])
  const selectedIndex = Math.max(0, entries.findIndex(entry => entry.key === view?.selectedKey))
  const selectIndex = useCallback((index: number) => {
    if (key && entries[index] && !entries[index].separator) dispatch({ type: "select", key, selectedKey: entries[index].key })
  }, [entries, key])

  return { modules, entries, selectedIndex, selectIndex, status: view?.status ?? "", load }
}
