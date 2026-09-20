import type { CanvasTab } from "./canvas.js"
import type { FavoritePage } from "./favorites.js"
import { favoriteKey } from "./favorites.js"

export type CourseMenuEntry =
  | { kind: "back"; key: "back"; name: string; description: string }
  | { kind: "heading" | "separator"; key: string; name: string; description: string }
  | { kind: "favorite"; key: string; name: string; description: string; page: FavoritePage }
  | { kind: "tab"; key: string; name: string; description: string; tabIndex: number }

export function courseMenuEntries(tabs: CanvasTab[], favorites: FavoritePage[]): CourseMenuEntry[] {
  return [
    { kind: "back", key: "back", name: "← Tillbaka till kurser", description: "" },
    { kind: "separator", key: "favorites-spacer", name: "", description: "" },
    { kind: "heading", key: "favorites-heading", name: "── ★ Favoriter ────────", description: "" },
    ...(favorites.length ? favorites.map((page) => ({ kind: "favorite" as const, key: `favorite:${favoriteKey(page)}`, name: page.title, description: "", page })) : [{ kind: "heading" as const, key: "favorites-empty", name: "Inga sparade sidor", description: "" }]),
    { kind: "separator", key: "favorites-separator", name: "────────────────────", description: "" },
    ...tabs.map((tab, tabIndex) => ({ kind: "tab" as const, key: `tab:${tab.id}`, name: tab.label, description: "", tabIndex })),
  ]
}

export function courseMenuNavigationIndex(entries: CourseMenuEntry[], nextIndex: number, currentIndex: number) {
  const direction = nextIndex >= currentIndex ? 1 : -1
  let index = nextIndex
  while (entries[index]?.kind === "heading" || entries[index]?.kind === "separator") index += direction
  return entries[index] ? index : currentIndex
}
