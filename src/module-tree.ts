import type { CanvasModule, CanvasModuleItem } from "./canvas.js"

export type ModuleTreeEntry = {
  name: string
  description: string
  item?: CanvasModuleItem
  separator?: true
}

export function moduleTreeEntries(modules: CanvasModule[]): ModuleTreeEntry[] {
  return modules.flatMap((module, moduleIndex) => {
    const items = module.items ?? []
    return [
      ...(moduleIndex ? [{ name: "", description: "", separator: true as const }] : []),
      { name: `${module.name} · ${module.items_count} objekt`, description: "" },
      ...items.map((item, index) => ({ name: `${index === items.length - 1 ? "└─" : "├─"} ${item.title} · ${item.type}`, description: "", item })),
    ]
  })
}

export function moduleNavigationIndex(entries: ModuleTreeEntry[], nextIndex: number, currentIndex: number) {
  if (!entries[nextIndex]?.separator) return nextIndex
  return nextIndex > currentIndex ? nextIndex + 1 : nextIndex - 1
}
