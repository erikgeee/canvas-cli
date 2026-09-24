import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { CanvasModuleItem } from "./canvas.js"

export type FavoritePage = {
  baseUrl: string
  courseId: string
  pageUrl: string
  title: string
}

export const favoritesPath = join(homedir(), ".local", "share", "canvas-cli", "favorites.json")

const favoriteTitleCollator = new Intl.Collator("sv", { numeric: true, sensitivity: "base" })

export function sortFavoritePages(pages: FavoritePage[]): FavoritePage[] {
  return [...pages].sort((first, second) =>
    favoriteTitleCollator.compare(first.title, second.title) ||
    first.title.localeCompare(second.title, "sv") ||
    first.baseUrl.localeCompare(second.baseUrl) ||
    first.courseId.localeCompare(second.courseId) ||
    first.pageUrl.localeCompare(second.pageUrl))
}

export function modulePageFavorite(baseUrl: string, courseId: string | number, item?: CanvasModuleItem): FavoritePage | null {
  return item?.type === "Page" && item.page_url
    ? { baseUrl, courseId: String(courseId), pageUrl: item.page_url, title: item.title }
    : null
}

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
  return sortFavoritePages(parsed.pages as FavoritePage[])
}

export async function saveFavoritePages(pages: FavoritePage[], path = favoritesPath) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ version: 1, pages: sortFavoritePages(pages) }, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" })
  await rename(temporaryPath, path)
}
