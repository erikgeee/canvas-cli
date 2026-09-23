import type { CanvasModule, CanvasModuleItem } from "./canvas.js"

export type ModuleTreeEntry = {
  key: string
  name: string
  description: string
  item?: CanvasModuleItem
  separator?: true
}

export function moduleTreeEntries(modules: CanvasModule[]): ModuleTreeEntry[] {
  return modules.flatMap((module, moduleIndex) => {
    const items = module.items ?? []
    return [
      ...(moduleIndex ? [{ key: `separator:${module.id}`, name: "", description: "", separator: true as const }] : []),
      { key: `module:${module.id}`, name: `${module.name} · ${module.items_count} objekt`, description: "" },
      ...items.map((item, index) => ({ key: `item:${module.id}:${item.id}`, name: `${index === items.length - 1 ? "└─" : "├─"} ${item.title} · ${item.type}`, description: "", item })),
    ]
  })
}

export function moduleNavigationIndex(entries: ModuleTreeEntry[], nextIndex: number, currentIndex: number) {
  if (!entries[nextIndex]?.separator) return nextIndex
  return nextIndex > currentIndex ? nextIndex + 1 : nextIndex - 1
}

export function moduleHeaderNavigationIndex(entries: ModuleTreeEntry[], currentIndex: number, direction: -1 | 1) {
  let containingHeader = currentIndex
  while (containingHeader >= 0 && !entries[containingHeader]?.key.startsWith("module:")) containingHeader--
  if (containingHeader < 0) return currentIndex

  for (let index = containingHeader + direction; index >= 0 && index < entries.length; index += direction) {
    if (entries[index].key.startsWith("module:")) return index
  }
  return currentIndex
}
