import assert from "node:assert/strict"
import test from "node:test"
import { cachedPage, loadPage, prefetchModulePages, prefetchPage, selectPageForPrefetch } from "./page-cache.js"

function configure(t: test.TestContext) {
  const previousUrl = process.env.CANVAS_BASE_URL
  const previousToken = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = `cache-test-${Math.random()}`
  t.after(() => {
    if (previousUrl === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = previousUrl
    if (previousToken === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = previousToken
  })
}

test("page requests dedupe, revisit instantly, retain stale text and throttle refresh", async t => {
  configure(t)
  let now = 1_000_000
  t.mock.method(Date, "now", () => now)
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => Response.json({ title: "Intro", body: `<p>Version ${++calls}</p>` }))

  const first = loadPage(1, "intro")
  assert.equal(loadPage(1, "intro"), first, "the same pending request is reused")
  assert.match((await first).body ?? "", /Version 1/)
  assert.equal(cachedPage(1, "intro")?.fresh, true)
  assert.match((await loadPage(1, "intro")).body ?? "", /Version 1/)
  assert.match((await loadPage(1, "intro", true)).body ?? "", /Version 1/)
  assert.equal(calls, 1, "manual refresh follows the completed-request cooldown")

  now += 30_000
  assert.match((await loadPage(1, "intro", true)).body ?? "", /Version 2/)
  now += 5 * 60_000
  assert.equal(cachedPage(1, "intro")?.fresh, false)
  assert.match(cachedPage(1, "intro")?.page.body ?? "", /Version 2/)
  assert.match((await loadPage(1, "intro")).body ?? "", /Version 3/)
  assert.equal(calls, 3)
})

test("failed speculative request allows an explicit opening to retry without prefetch spam", async t => {
  configure(t)
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    if (calls === 1) return new Response("", { status: 503 })
    return Response.json({ title: "Recovered", body: "Available" })
  })
  prefetchPage(2, "retry")
  await new Promise<void>(resolve => setImmediate(resolve))
  prefetchPage(2, "retry")
  assert.equal(calls, 1)
  assert.equal((await loadPage(2, "retry")).title, "Recovered")
  assert.equal(calls, 2)
})

test("speculation stays bounded and pages are isolated by account", async t => {
  configure(t)
  const replies: Array<() => void> = []
  const requestedPaths: string[] = []
  let calls = 0
  t.mock.method(globalThis, "fetch", (input: string | URL | Request) => {
    calls++
    requestedPaths.push(new URL(String(input)).pathname)
    return new Promise<Response>(resolve => replies.push(() => resolve(Response.json({ title: "Page", body: "Text" }))))
  })
  prefetchModulePages(3, [{ id: 1, name: "Module", items_count: 5, items: Array.from({ length: 5 }, (_, index) => ({ id: index, type: "Page", title: "Page", page_url: `page-${index}` })) }])
  assert.equal(calls, 3)
  prefetchPage(3, "page-4")
  assert.equal(calls, 3, "extra speculative requests are skipped while all slots are busy")
  const cancelOldSelection = selectPageForPrefetch(3, "page-4")
  cancelOldSelection()
  const cancelSelection = selectPageForPrefetch(3, "page-5")
  replies[0]!()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(calls, 4, "selected page starts when a speculative slot becomes free")
  assert.ok(requestedPaths[3]?.endsWith("/page-5"), "a cancelled selection is not fetched")
  cancelSelection()
  for (const reply of replies) reply()
  await new Promise<void>(resolve => setImmediate(resolve))

  const previousAccount = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_ACCESS_TOKEN = "another-account"
  assert.equal(cachedPage(3, "page-0"), undefined)
  const request = loadPage(3, "page-0")
  assert.equal(calls, 5)
  replies[4]!()
  await request
  process.env.CANVAS_ACCESS_TOKEN = previousAccount
  assert.ok(cachedPage(3, "page-0"))
})

test("a failed refresh keeps the saved page and observes the cooldown", async t => {
  configure(t)
  let now = 1_000_000
  t.mock.method(Date, "now", () => now)
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    if (calls === 2) return new Response("", { status: 503 })
    return Response.json({ title: "Page", body: `Version ${calls}` })
  })
  await loadPage(5, "stale")
  now += 30_000
  await assert.rejects(loadPage(5, "stale", true))
  assert.equal(cachedPage(5, "stale")?.page.body, "Version 1")
  assert.equal((await loadPage(5, "stale", true)).body, "Version 1")
  assert.equal(calls, 2)
  now += 30_000
  assert.equal((await loadPage(5, "stale", true)).body, "Version 3")
})

test("large pages stay cached and requests remain deduplicated beyond the shared LRU limit", async t => {
  configure(t)
  const replies = new Map<string, () => void>()
  let calls = 0
  t.mock.method(globalThis, "fetch", (input: string | URL | Request) => {
    calls++
    const path = new URL(String(input)).pathname
    return new Promise<Response>(resolve => replies.set(path, () => resolve(Response.json({ title: "Page", body: "x".repeat(210_000) }))))
  })
  const requests = Array.from({ length: 81 }, (_, index) => loadPage(4, `page-${index}`))
  assert.equal(loadPage(4, "page-0"), requests[0], "in-flight requests survive LRU pressure")
  assert.equal(calls, 81)
  for (let index = 1; index < 81; index++) replies.get(`/api/v1/courses/4/pages/page-${index}`)!()
  await Promise.all(requests.slice(1))
  replies.get("/api/v1/courses/4/pages/page-0")!()
  await requests[0]
  assert.equal(cachedPage(4, "page-0")?.page.body?.length, 210_000)
  assert.equal(cachedPage(4, "page-1"), undefined, "the least recent settled entry is evicted")
  await loadPage(4, "page-0")
  assert.equal(calls, 81)
})
