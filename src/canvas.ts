import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type CanvasCourse = {
  id: number | string
  name: string
  course_code: string
  default_view?: string
  home_page?: string
  syllabus_body?: string
}

export type CanvasTab = {
  id: string
  label: string
  html_url?: string
  hidden?: boolean
  visibility?: "public" | "members" | "admins" | "none"
}

export type CanvasModuleItem = {
  id: number | string
  title: string
  type: string
  content_id?: number | string
  page_url?: string
  external_url?: string
  html_url?: string
}

export type CanvasModule = {
  id: number | string
  name: string
  items_count: number
  state?: string
  items?: CanvasModuleItem[]
}

export type CanvasPage = {
  html_url?: string
  locked_for_user?: boolean
  lock_explanation?: string
  title: string
  body?: string
}

export type CanvasFile = {
  id: number | string
  display_name: string
  filename: string
  "content-type"?: string
  mime_class?: string
  url?: string
}

export type CanvasDiscussionTopic = {
  id: number | string
  title: string
  message?: string
  posted_at?: string
  user_name?: string
  html_url?: string
  discussion_subentry_count?: number
  unread_count?: number
  read_state?: "read" | "unread"
  locked?: boolean
  pinned?: boolean
}

export type CanvasAnnouncement = CanvasDiscussionTopic & {
  context_code: string
}

export type CanvasDiscussionEntry = {
  id: number | string
  user_id?: number | string
  message?: string
  replies?: CanvasDiscussionEntry[]
}

export type CanvasDiscussionView = {
  participants: { id: number | string; display_name: string }[]
  view: CanvasDiscussionEntry[]
}

export type CanvasAssignment = {
  id: number | string
  name: string
  description?: string
  due_at?: string
  unlock_at?: string
  lock_at?: string
  html_url?: string
  points_possible?: number
  published?: boolean
  locked_for_user?: boolean
  lock_explanation?: string
  submission?: {
    excused?: boolean
    submitted_at?: string
    workflow_state?: string
    late?: boolean
    missing?: boolean
    score?: number | null
    grade?: string | null
  }
}

const pdfCacheDirectory = join(homedir(), ".cache", "canvas-cli", "files")
const pdfCacheMaxAge = 30 * 24 * 60 * 60 * 1000

export function cachedPdfPath(file: CanvasFile) {
  // ponytail: cache by Canvas ID; include updated_at if Canvas replaces files in-place.
  return join(pdfCacheDirectory, `${encodeURIComponent(String(file.id))}.pdf`)
}

export async function cleanPdfCache(directory = pdfCacheDirectory, now = Date.now()) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
    throw error
  }

  const expired = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".pdf")).map(async (entry) => {
    const path = join(directory, entry.name)
    if ((await stat(path)).mtimeMs >= now - pdfCacheMaxAge) return 0
    await rm(path)
    return 1
  }))
  // ponytail: cleanup runs when a PDF is opened; add a scheduler only if idle cleanup matters.
  return expired.reduce<number>((total, count) => total + count, 0)
}

export function canvasBaseUrl() {
  return process.env.CANVAS_BASE_URL?.replace(/\/+$/, "") ?? ""
}

function config() {
  const baseUrl = canvasBaseUrl()
  const token = process.env.CANVAS_ACCESS_TOKEN

  if (!baseUrl || !token) {
    throw new Error("Sätt CANVAS_BASE_URL och CANVAS_ACCESS_TOKEN i .env först.")
  }

  return { baseUrl, token }
}

async function getResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, token } = config()
  let response: Response
  try {
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15000) })
  } catch {
    throw new Error("Kunde inte nå Canvas. Kontrollera anslutningen och försök igen.")
  }

  if (!response.ok) {
    throw new Error(response.status === 403 ? "Du saknar åtkomst till innehållet i Canvas (403)." : response.status === 404 ? "Innehållet finns inte eller är inte publicerat för dig i Canvas (404)." : `Canvas svarade ${response.status} ${response.statusText}`)
  }

  return response
}

async function getJson<T>(path: string): Promise<T> {
  return (await getResponse(path)).json() as Promise<T>
}

async function getPaginated<T>(path: string): Promise<T[]> {
  const { baseUrl } = config()
  const result: T[] = []
  const visited = new Set<string>()
  let next: string | undefined = path
  while (next) {
    const url = new URL(next, baseUrl)
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/v1/")) {
      throw new Error("Canvas skickade en ogiltig länk till nästa sida.")
    }
    if (visited.has(url.href)) throw new Error("Canvas upprepade samma sida i deltagarlistan.")
    visited.add(url.href)
    const response = await getResponse(url.pathname + url.search)
    result.push(...await response.json() as T[])
    next = response.headers.get("link")?.split(",").map(part => part.match(/<([^>]+)>;\s*rel="next"/)).find(Boolean)?.[1]
  }
  return result
}

export function getProfile() {
  return getJson<{ name?: string }>("/api/v1/users/self/profile")
}

export function listCourses() {
  return getJson<CanvasCourse[]>("/api/v1/users/self/favorites/courses?per_page=100")
}

export async function listRecentAnnouncements(courseIds: CanvasCourse["id"][], limit = 8) {
  if (!courseIds.length || limit <= 0) return []
  const params = new URLSearchParams({ per_page: "100", active_only: "true" })
  for (const courseId of courseIds) params.append("context_codes[]", `course_${courseId}`)
  const announcements = await getPaginated<CanvasAnnouncement>(`/api/v1/announcements?${params}`)
  return announcements
    .sort((left, right) => Date.parse(right.posted_at ?? "") - Date.parse(left.posted_at ?? ""))
    .slice(0, limit)
}

export async function markAnnouncementRead(courseId: CanvasCourse["id"], announcementId: CanvasAnnouncement["id"]) {
  await getResponse(`/api/v1/courses/${courseId}/discussion_topics/${announcementId}/read`, { method: "PUT" })
}

export function listCourseTabs(courseId: CanvasCourse["id"]) {
  return getJson<CanvasTab[]>(`/api/v1/courses/${courseId}/tabs?per_page=100`)
}

export function getCourseHome(courseId: CanvasCourse["id"]) {
  return getJson<CanvasCourse>(`/api/v1/courses/${courseId}?include[]=syllabus_body`)
}

export function getFrontPage(courseId: CanvasCourse["id"]) {
  return getJson<CanvasPage>(`/api/v1/courses/${courseId}/front_page`)
}

export function listModules(courseId: CanvasCourse["id"]) {
  return getJson<CanvasModule[]>(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`)
}

export function listDiscussionTopics(courseId: CanvasCourse["id"], announcements = false) {
  return getJson<CanvasDiscussionTopic[]>(`/api/v1/courses/${courseId}/discussion_topics?per_page=100${announcements ? "&only_announcements=true" : ""}`)
}

export function getDiscussionView(courseId: CanvasCourse["id"], topicId: CanvasDiscussionTopic["id"]) {
  return getJson<CanvasDiscussionView>(`/api/v1/courses/${courseId}/discussion_topics/${topicId}/view`)
}

export function listAssignments(courseId: CanvasCourse["id"]) {
  return getJson<CanvasAssignment[]>(`/api/v1/courses/${courseId}/assignments?include[]=submission&order_by=due_at&per_page=100`)
}

export function getPage(courseId: CanvasCourse["id"], pageUrl: string) {
  return getJson<CanvasPage>(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`)
}

export function getFile(fileId: CanvasModuleItem["content_id"]) {
  return getJson<CanvasFile>(`/api/v1/files/${fileId}`)
}

export async function downloadFile(file: CanvasFile, destination: string) {
  if (!file.url) throw new Error("Canvas-filen saknar nedladdningslänk.")

  const { baseUrl, token } = config()
  const url = new URL(file.url, baseUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Canvas-filen har en ogiltig nedladdningslänk.")

  const response = await fetch(url, { headers: url.origin === new URL(baseUrl).origin ? { Authorization: `Bearer ${token}` } : undefined })
  if (!response.ok) throw new Error(`Kunde inte hämta filen: ${response.status} ${response.statusText}`)

  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.part`
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()))
  await rename(temporary, destination)
}

export type CanvasPerson = {
  id: number | string
  name: string
  enrollments?: { type: string; role?: string }[]
}

export type CanvasEnrollment = {
  type: string
  grades?: { current_score?: number | null; current_grade?: string | null; final_score?: number | null; final_grade?: string | null }
}

export function listPeople(courseId: CanvasCourse["id"]) {
  return getPaginated<CanvasPerson>(`/api/v1/courses/${courseId}/users?include[]=enrollments&per_page=100`)
}

export function listMyEnrollments(courseId: CanvasCourse["id"]) {
  return getJson<CanvasEnrollment[]>(`/api/v1/courses/${courseId}/enrollments?user_id=self&per_page=100`)
}

export function getAssignment(courseId: CanvasCourse["id"], assignmentId: number | string) {
  return getJson<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=submission`)
}

export function getDiscussionTopic(courseId: CanvasCourse["id"], topicId: number | string) {
  return getJson<CanvasDiscussionTopic>(`/api/v1/courses/${courseId}/discussion_topics/${topicId}`)
}

export function canvasUrl(path: string) {
  const url = new URL(path, process.env.CANVAS_BASE_URL)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Endast webblänkar kan öppnas.")
  return url.href
}
