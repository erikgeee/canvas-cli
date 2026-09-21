import { isDeepStrictEqual } from "node:util"
import type { CanvasModule } from "./canvas.js"
import { moduleTreeEntries } from "./module-tree.js"

export type ModuleView = {
  modules?: CanvasModule[]
  status: string
  selectedKey?: string
}

export type ModuleState = ReadonlyMap<string, ModuleView>
export type ModuleAction =
  | { type: "load"; key: string }
  | { type: "loaded"; key: string; modules: CanvasModule[] }
  | { type: "failed"; key: string; message: string }
  | { type: "select"; key: string; selectedKey: string }

export function moduleReducer(state: ModuleState, action: ModuleAction): ModuleState {
  const previous = state.get(action.key)
  let next: ModuleView
  if (action.type === "load") {
    // A background check must not replace the list with a loading state.
    if (previous?.modules !== undefined) return state
    next = { ...previous, status: "Laddar moduler…" }
  } else if (action.type === "loaded") {
    const modules = previous?.modules && isDeepStrictEqual(previous.modules, action.modules) ? previous.modules : action.modules
    const entries = moduleTreeEntries(modules)
    const oldEntries = moduleTreeEntries(previous?.modules ?? [])
    const oldIndex = Math.max(0, oldEntries.findIndex(entry => entry.key === previous?.selectedKey))
    const nearest = Math.min(oldIndex, entries.length - 1)
    const selectedKey = entries.some(entry => entry.key === previous?.selectedKey)
      ? previous?.selectedKey
      : (entries[nearest]?.separator ? entries[nearest + 1] ?? entries[nearest - 1] : entries[nearest])?.key
    next = { modules, selectedKey, status: modules.length ? `${modules.length} moduler laddade.` : "Inga moduler är publicerade ännu." }
  } else if (action.type === "failed") {
    next = { ...previous, status: previous?.modules !== undefined ? `Visar sparade moduler. Uppdatering misslyckades: ${action.message}` : action.message }
  } else {
    if (!previous) return state
    next = { ...previous, selectedKey: action.selectedKey }
  }
  if (previous && previous.modules === next.modules && previous.status === next.status && previous.selectedKey === next.selectedKey) return state
  return new Map(state).set(action.key, next)
}
