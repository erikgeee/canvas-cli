import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { favoriteKey, loadFavoritePages, saveFavoritePages, sortFavoritePages, type FavoritePage } from "./favorites.js"

const page: FavoritePage = { baseUrl: "https://canvas.example.edu", courseId: "42", pageUrl: "introduction", title: "Introduktion" }

test("favoriter sparas lokalt och kan läsas tillbaka", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-favorites-"))
  try {
    const path = join(directory, "data", "favorites.json")
    assert.deepEqual(await loadFavoritePages(path), [])
    await saveFavoritePages([page], path)
    assert.deepEqual(await loadFavoritePages(path), [page])
    assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("favoriter sorteras naturligt på svenska och med stabila identitetstiebreakers", async () => {
  const pages: FavoritePage[] = [
    { ...page, courseId: "42", title: "F10", pageUrl: "f10" },
    { ...page, courseId: "42", title: "F06", pageUrl: "f06" },
    { ...page, courseId: "42", title: "F7", pageUrl: "f7" },
    { ...page, courseId: "43", title: "Ämne 2", pageUrl: "z" },
    { ...page, courseId: "42", title: "Ämne 2", pageUrl: "b" },
  ]
  assert.deepEqual(sortFavoritePages(pages).map(item => item.title), ["F06", "F7", "F10", "Ämne 2", "Ämne 2"])

  const directory = await mkdtemp(join(tmpdir(), "canvas-favorites-"))
  try {
    const path = join(directory, "favorites.json")
    await writeFile(path, JSON.stringify({ version: 1, pages }))
    assert.deepEqual((await loadFavoritePages(path)).map(item => [item.title, item.courseId, item.pageUrl]), [
      ["F06", "42", "f06"], ["F7", "42", "f7"], ["F10", "42", "f10"], ["Ämne 2", "42", "b"], ["Ämne 2", "43", "z"],
    ])
    await saveFavoritePages(pages, path)
    assert.deepEqual((JSON.parse(await readFile(path, "utf8")).pages as FavoritePage[]).map(item => item.pageUrl), ["f06", "f7", "f10", "b", "z"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("en trasig favoritfil skrivs inte över", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-favorites-"))
  try {
    const path = join(directory, "favorites.json")
    await writeFile(path, "{broken")
    await assert.rejects(loadFavoritePages(path))
    assert.equal(await readFile(path, "utf8"), "{broken")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("samma sidnamn i olika kurser ger olika favoritnycklar", () => {
  assert.notEqual(favoriteKey(page), favoriteKey({ ...page, courseId: "43" }))
  assert.notEqual(favoriteKey(page), favoriteKey({ ...page, baseUrl: "https://other.example.edu" }))
})
