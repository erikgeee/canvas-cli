import assert from "node:assert/strict"
import test from "node:test"
import { moduleNavigationIndex, moduleTreeEntries } from "./module-tree.js"

test("moduleTreeEntries groups module items as a tree", () => {
  assert.deepEqual(
    moduleTreeEntries([{ id: 1, name: "Vecka 1", items_count: 2, items: [{ id: 2, title: "Introduktion", type: "Page" }, { id: 3, title: "Övning", type: "File" }] }, { id: 4, name: "Vecka 2", items_count: 0 }]),
    [
      { name: "Vecka 1 · 2 objekt", description: "" },
      { name: "├─ Introduktion · Page", description: "", item: { id: 2, title: "Introduktion", type: "Page" } },
      { name: "└─ Övning · File", description: "", item: { id: 3, title: "Övning", type: "File" } },
      { name: "", description: "", separator: true },
      { name: "Vecka 2 · 0 objekt", description: "" },
    ],
  )
})

test("module navigation skips the visual separator", () => {
  const entries = moduleTreeEntries([{ id: 1, name: "Ett", items_count: 0 }, { id: 2, name: "Två", items_count: 0 }])
  assert.equal(moduleNavigationIndex(entries, 1, 0), 2)
  assert.equal(moduleNavigationIndex(entries, 1, 2), 0)
})
