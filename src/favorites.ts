import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type FavoritePage = {
  baseUrl: string
  courseId: string
  pageUrl: string
  title: string
}

export const favoritesPath = join(homedir(), ".local", "share", "canvas-cli", "favorites.json")

export function favoriteKey(page: Pick<FavoritePage, "baseUrl" | "courseId" | "pageUrl">) {
  return JSON.stringify([page.baseUrl, page.courseId, page.pageUrl])
}

export async function loadFavoritePages(path = favoritesPath): Promise<FavoritePage[]> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("pages" in parsed) || !Array.isArray(parsed.pages) || !parsed.pages.every((page: unknown) =>
    page && typeof page === "object" && "baseUrl" in page && typeof page.baseUrl === "string" && "courseId" in page && typeof page.courseId === "string" && "pageUrl" in page && typeof page.pageUrl === "string" && "title" in page && typeof page.title === "string"
  )) throw new Error("Favoritfilen har ett okänt format.")
  return parsed.pages as FavoritePage[]
}

export async function saveFavoritePages(pages: FavoritePage[], path = favoritesPath) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ version: 1, pages }, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" })
  await rename(temporaryPath, path)
}
