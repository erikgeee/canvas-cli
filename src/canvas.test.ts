import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cachedPdfPath, cleanPdfCache, getCourseHome, listRecentAnnouncements, markAnnouncementRead } from "./canvas.js"

test("cachedPdfPath uses the Canvas file id as cache key", () => {
  assert.match(cachedPdfPath({ id: 34, display_name: "Renamed.pdf", filename: "Renamed.pdf" }), /\/\.cache\/canvas-cli\/files\/34\.pdf$/)
})

test("cleanPdfCache removes PDFs unused for 30 days", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-cli-test-"))
  const oldPdf = join(directory, "old.pdf")
  const recentPdf = join(directory, "recent.pdf")
  const now = Date.now()
  await writeFile(oldPdf, "old")
  await writeFile(recentPdf, "recent")
  await utimes(oldPdf, new Date(now - 31 * 24 * 60 * 60 * 1000), new Date(now - 31 * 24 * 60 * 60 * 1000))

  assert.equal(await cleanPdfCache(directory, now), 1)
  await assert.rejects(() => import("node:fs/promises").then(({ access }) => access(oldPdf)))
  await assert.doesNotReject(() => import("node:fs/promises").then(({ access }) => access(recentPdf)))
  await rm(directory, { recursive: true })
})

test("getCourseHome requests the Canvas-configured home page and syllabus", async (t) => {
  const baseUrl = process.env.CANVAS_BASE_URL
  const token = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = "test-token"
  t.after(() => {
    if (baseUrl === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = baseUrl
    if (token === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = token
  })
  let requestedUrl = ""
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    requestedUrl = String(url)
    return new Response(JSON.stringify({ id: 7, name: "Kurs", course_code: "KURS", home_page: "syllabus" }))
  })

  assert.equal((await getCourseHome(7)).home_page, "syllabus")
  assert.equal(requestedUrl, "https://canvas.example/api/v1/courses/7?include[]=syllabus_body")
})

test("people follows pagination and refuses credentials to an external next link", async (t) => {
  const { listPeople } = await import("./canvas.js")
  const base = process.env.CANVAS_BASE_URL
  const token = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = "test-token"
  t.after(() => {
    if (base === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = base
    if (token === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = token
  })
  const urls: string[] = []
  let external = false
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify([{ id: urls.length, name: "Test" }]), { headers: urls.length === 1 ? { link: `<https://${external ? "other.example" : "canvas.example"}/api/v1/courses/7/users?page=2>; rel="next"` } : {} })
  })
  assert.equal((await listPeople(7)).length, 2)
  assert.equal(urls.length, 2)
  urls.length = 0
  external = true
  await assert.rejects(listPeople(7), /ogiltig länk/)
  assert.equal(urls.length, 1)
})

test("recent announcements use favorite course contexts and keep the newest eight", async (t) => {
  const base = process.env.CANVAS_BASE_URL
  const token = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = "test-token"
  t.after(() => {
    if (base === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = base
    if (token === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = token
  })
  let requestedUrl = ""
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    requestedUrl = String(url)
    return new Response(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
      id: index,
      title: `Announcement ${index}`,
      context_code: index % 2 ? "course_7" : "course_9",
      posted_at: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      read_state: index === 9 ? "unread" : "read",
    }))))
  })

  const announcements = await listRecentAnnouncements([7, 9])
  const url = new URL(requestedUrl)
  assert.deepEqual(url.searchParams.getAll("context_codes[]"), ["course_7", "course_9"])
  assert.equal(url.searchParams.get("active_only"), "true")
  assert.equal(announcements.length, 8)
  assert.equal(announcements[0]?.title, "Announcement 9")
  assert.equal(announcements[0]?.read_state, "unread")
})

test("opening an unread announcement can mark it read for the current user", async (t) => {
  const base = process.env.CANVAS_BASE_URL
  const token = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = "test-token"
  t.after(() => {
    if (base === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = base
    if (token === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = token
  })
  let requestedUrl = ""
  let requestedMethod = ""
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url)
    requestedMethod = init?.method ?? "GET"
    return new Response(null, { status: 204 })
  })

  await markAnnouncementRead(7, 42)
  assert.equal(requestedUrl, "https://canvas.example/api/v1/courses/7/discussion_topics/42/read")
  assert.equal(requestedMethod, "PUT")
})
