import assert from "node:assert/strict"
import test from "node:test"
import { moduleReducer } from "./module-state.js"
import type { CanvasModule } from "./canvas.js"

const modules: CanvasModule[] = [{ id: 1, name: "Vecka 1", items_count: 2, items: [
  { id: 10, type: "Page", title: "Ett", page_url: "one" },
  { id: 20, type: "Page", title: "Två", page_url: "two" },
] }]

test("unchanged revalidation keeps cached modules and selection by reference", () => {
  const loaded = moduleReducer(new Map(), { type: "loaded", key: "course-a", modules })
  const selected = moduleReducer(loaded, { type: "select", key: "course-a", selectedKey: "item:1:20" })
  assert.equal(moduleReducer(selected, { type: "load", key: "course-a" }), selected)
  assert.equal(moduleReducer(selected, { type: "loaded", key: "course-a", modules: structuredClone(modules) }), selected)
})

test("insertions and renamed rows preserve the selection; deletion selects a remaining row", () => {
  let state = moduleReducer(new Map(), { type: "loaded", key: "course-a", modules })
  state = moduleReducer(state, { type: "select", key: "course-a", selectedKey: "item:1:20" })
  const updated = structuredClone(modules)
  updated[0].items!.unshift({ id: 30, type: "Page", title: "Ny", page_url: "new" })
  updated[0].items![2].title = "Omdöpt"
  state = moduleReducer(state, { type: "loaded", key: "course-a", modules: updated })
  assert.equal(state.get("course-a")?.selectedKey, "item:1:20")
  const removed = structuredClone(updated)
  removed[0].items = removed[0].items!.filter(item => item.id !== 20)
  state = moduleReducer(state, { type: "loaded", key: "course-a", modules: removed })
  assert.equal(state.get("course-a")?.selectedKey, "item:1:10")
})

test("failed refreshes retain data, and late responses only update their own course", () => {
  let state = moduleReducer(new Map(), { type: "loaded", key: "course-a", modules })
  state = moduleReducer(state, { type: "loaded", key: "course-b", modules: [] })
  const second = state.get("course-b")
  state = moduleReducer(state, { type: "failed", key: "course-a", message: "offline" })
  assert.equal(state.get("course-a")?.modules, modules)
  assert.match(state.get("course-a")!.status, /Visar sparade moduler/)
  assert.equal(state.get("course-b"), second)
  state = moduleReducer(state, { type: "load", key: "course-b" })
  assert.equal(state.get("course-b"), second, "an empty loaded list is also cached")
})
