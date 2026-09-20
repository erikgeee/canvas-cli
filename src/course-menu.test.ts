import assert from "node:assert/strict"
import { test } from "node:test"
import { courseMenuEntries, courseMenuNavigationIndex } from "./course-menu.js"

test("favoriter ligger mellan tillbaka och kursflikarna", () => {
  const entries = courseMenuEntries([{ id: "home", label: "Home" }, { id: "modules", label: "Moduler" }], [{ baseUrl: "https://canvas.example.edu", courseId: "42", pageUrl: "intro", title: "Intro" }])
  assert.deepEqual(entries.map((entry) => entry.kind), ["back", "separator", "heading", "favorite", "separator", "tab", "tab"])
  assert.equal(entries[0]?.description, "")
  assert.equal(entries[1]?.name, "")
  assert.equal(entries[2]?.name, "── ★ Favoriter ────────")
  assert.equal(entries[3]?.name, "Intro")
  assert.equal(entries[3]?.description, "")
  assert.equal(entries[5]?.name, "Home")
  assert.equal(courseMenuNavigationIndex(entries, 1, 0), 3)
  assert.equal(courseMenuNavigationIndex(entries, 2, 3), 0)
  assert.equal(courseMenuNavigationIndex(entries, 4, 3), 5)
  assert.equal(courseMenuNavigationIndex(entries, 4, 5), 3)
})

test("tom favoritsektion är synlig men kan hoppas över", () => {
  const entries = courseMenuEntries([{ id: "home", label: "Home" }], [])
  assert.equal(entries[3]?.name, "Inga sparade sidor")
  assert.equal(courseMenuNavigationIndex(entries, 1, 0), 5)
  assert.equal(courseMenuNavigationIndex(entries, 4, 5), 0)
})
