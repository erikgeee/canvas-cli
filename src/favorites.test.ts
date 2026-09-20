import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { favoriteKey, loadFavoritePages, saveFavoritePages, type FavoritePage } from "./favorites.js"

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
