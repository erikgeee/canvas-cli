import assert from "node:assert/strict"
import test from "node:test"
import { moduleHeaderNavigationIndex, moduleNavigationIndex, moduleTreeEntries } from "./module-tree.js"

test("moduleTreeEntries groups module items as a tree", () => {
  assert.deepEqual(
    moduleTreeEntries([{ id: 1, name: "Vecka 1", items_count: 2, items: [{ id: 2, title: "Introduktion", type: "Page" }, { id: 3, title: "Övning", type: "File" }] }, { id: 4, name: "Vecka 2", items_count: 0 }]),
    [
      { key: "module:1", name: "Vecka 1 · 2 objekt", description: "" },
      { key: "item:1:2", name: "├─ Introduktion · Page", description: "", item: { id: 2, title: "Introduktion", type: "Page" } },
      { key: "item:1:3", name: "└─ Övning · File", description: "", item: { id: 3, title: "Övning", type: "File" } },
      { key: "separator:4", name: "", description: "", separator: true },
      { key: "module:4", name: "Vecka 2 · 0 objekt", description: "" },
    ],
  )
})

test("module navigation skips the visual separator", () => {
  const entries = moduleTreeEntries([{ id: 1, name: "Ett", items_count: 0 }, { id: 2, name: "Två", items_count: 0 }])
  assert.equal(moduleNavigationIndex(entries, 1, 0), 2)
  assert.equal(moduleNavigationIndex(entries, 1, 2), 0)
})

test("module header navigation uses the containing module for headers and items", () => {
  const entries = moduleTreeEntries([
    { id: 1, name: "Ett", items_count: 2, items: [{ id: 11, title: "Första", type: "Page" }, { id: 12, title: "Andra", type: "Page" }] },
    { id: 2, name: "Två", items_count: 1, items: [{ id: 21, title: "Tredje", type: "Page" }] },
    { id: 3, name: "Tre", items_count: 0 },
  ])
  assert.equal(moduleHeaderNavigationIndex(entries, 0, 1), 4)
  assert.equal(moduleHeaderNavigationIndex(entries, 2, 1), 4)
  assert.equal(moduleHeaderNavigationIndex(entries, 5, -1), 0)
  assert.equal(moduleHeaderNavigationIndex(entries, 4, 1), 7)
  assert.equal(moduleHeaderNavigationIndex(entries, 7, -1), 4)
  assert.equal(moduleHeaderNavigationIndex(entries, 1, -1), 1)
  assert.equal(moduleHeaderNavigationIndex(entries, 7, 1), 7)
})
