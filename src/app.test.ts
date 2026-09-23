import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { CanvasModule } from "./canvas.js"
import { act, createElement } from "react"
import { createRoot } from "@opentui/react"
import { createTestRenderer } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"
import { App } from "./app.js"
import { saveFavoritePages, type FavoritePage } from "./favorites.js"
import { ThemeProvider } from "./theme-context.js"
import { themes } from "./theme.js"

async function mountApp(t: TestContext, overrides: Record<string, unknown> = {}, savedFavorites: FavoritePage[] = []) {
  const temporary = await mkdtemp(join(tmpdir(), "canvas-app-test-"))
  const favoritesFile = join(temporary, "favorites.json")
  t.after(() => rm(temporary, { recursive: true, force: true }))
  if (savedFavorites.length) await saveFavoritePages(savedFavorites, favoritesFile)
  const previous = { ...process.env }
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = `test-token-${Math.random()}`
  process.env.CANVAS_THEME = "auto"
  t.after(() => {
    for (const name of ["CANVAS_BASE_URL", "CANVAS_ACCESS_TOKEN", "CANVAS_THEME"]) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  const requested: string[] = []
  const routes: Record<string, unknown> = {
      "/api/v1/users/self/favorites/courses": [{ id: 7, name: "Testkurs", course_code: "TEST101" }],
      "/api/v1/announcements": [],
      "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "modules", label: "Moduler" }],
      "/api/v1/courses/7": { id: 7, name: "Testkurs", default_view: "wiki" },
      "/api/v1/courses/7/front_page": { title: "Välkommen", body: '<h1>Kursintroduktion</h1><p>Välkommen till kursen.</p><p><code>exempel</code> och <a href="/courses/7/pages/intro"><code>kurslänk</code></a></p>' },
      "/api/v1/courses/7/modules": [{ id: 1, name: "Första modulen", items_count: 1, items: [{ id: 10, title: "Modulsida", type: "Page", page_url: "intro" }] }],
      "/api/v1/courses/7/pages/intro": { title: "Modulsida", body: "<p>Modulens innehåll</p>" },
      ...overrides,
  }
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    requested.push(path)
    assert.ok(path in routes, `Unexpected request: ${path}`)
    if (typeof routes[path] === "function") return routes[path]()
    return Response.json(routes[path])
  })

  const setup = await createTestRenderer({ width: 120, height: 40 })
  const root = createRoot(setup.renderer)
  const keymap = createDefaultOpenTuiKeymap(setup.renderer)
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  globals.IS_REACT_ACT_ENVIRONMENT = true
  t.after(async () => {
    await act(async () => root.unmount())
    setup.renderer.destroy()
    globals.IS_REACT_ACT_ENVIRONMENT = false
  })
  await act(async () => {
    root.render(createElement(KeymapProvider, { keymap }, createElement(ThemeProvider, null, createElement(App, { favoritesFile }))))
  })
  await setup.renderOnce()
  assert.match(setup.captureCharFrame(), /Testkurs/)

  async function input(sequence: string) {
    await act(async () => setup.mockInput.pressKey(sequence))
    await setup.renderOnce()
  }
  async function waitForText(text: string) {
    const deadline = Date.now() + 1000
    do {
      // Let real file I/O finish, then let React commit before inspecting a frame.
      await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)) })
      await setup.renderOnce()
      if (setup.captureCharFrame().includes(text)) return
    } while (Date.now() < deadline)
    assert.fail(`Text did not appear: ${text}\n${setup.captureCharFrame()}`)
  }
  return { ...setup, input, waitForText, requested, routes, favoritesFile }
}

for (const [name, sequence] of [["Enter", "\r"], ["Kitty Enter", "\x1b[13u"], ["right arrow", "\x1b[C"]]) {
  test(`${name} opens the selected course and its home page`, async t => {
    const app = await mountApp(t)
    await app.input(sequence)
    assert.match(app.captureCharFrame(), /Kursmeny/)
    assert.equal(app.requested.filter(path => path.endsWith("/tabs")).length, 1)
    await app.input(sequence)
    assert.match(app.captureCharFrame(), /Kursintroduktion/)
    assert.equal(app.requested.filter(path => path.endsWith("/front_page")).length, 1)
  })
}

test("Enter opens modules and the selected module page", async t => {
  const app = await mountApp(t)
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Första modulen/)
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Modulens innehåll/)
})

test("People displays totals and role counts across all result pages", async t => {
  const students = Array.from({ length: 49 }, (_, index) => ({
    id: index + 1, name: `Student ${index + 1}`, enrollments: [{ type: "StudentEnrollment" }],
  }))
  let page = 0
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "people", label: "People" }],
    "/api/v1/courses/7/users": () => {
      page++
      if (page === 1) return Response.json([
        ...students,
        { id: 50, name: "Assistent", enrollments: [{ type: "TaEnrollment" }] },
      ], { headers: { link: '<https://canvas.example/api/v1/courses/7/users?page=2>; rel="next"' } })
      return Response.json([{ id: 51, name: "Lärare", enrollments: [{ type: "TeacherEnrollment" }] }])
    },
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  const frame = app.captureCharFrame()
  assert.match(frame, /Totalt: 51 deltagare/)
  assert.match(frame, /Studenter: 49 · Lärare: 1 · Assistenter: 1/)
  assert.equal(page, 2)
})

test("People joins selected-tab prefetch, shows honest partial rows, then caches the full list", async t => {
  const clock = mockClock(t)
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, name: `Student ${index + 1}`, enrollments: [{ type: "StudentEnrollment" }] }))
  const finalPage = Array.from({ length: 28 }, (_, index) => ({ id: index + 51, name: `Student ${index + 51}`, enrollments: [{ type: "StudentEnrollment" }] }))
  const second = Promise.withResolvers<Response>()
  let calls = 0
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "people", label: "People" }],
    "/api/v1/courses/7/users": () => {
      calls++
      if (calls === 1) return Response.json(firstPage, { headers: { link: '<https://canvas.example/api/v1/courses/7/users?page=2>; rel="next"' } })
      return second.promise
    },
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await new Promise(resolve => setTimeout(resolve, 380))
  assert.equal(calls, 2, "selected People tab starts one bounded background load")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Hittills:\s*50 deltagare/)
  assert.doesNotMatch(app.captureCharFrame(), /Totalt:\s*50 deltagare/)
  assert.equal(calls, 2, "opening joins the pending request")
  await act(async () => { second.resolve(Response.json(finalPage)) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Totalt:\s*78 deltagare/)

  await app.input("\x1b[D")
  const cachedStart = performance.now()
  await app.input("\r")
  t.diagnostic(`cached People input to rendered frame: ${(performance.now() - cachedStart).toFixed(1)} ms`)
  assert.match(app.captureCharFrame(), /Totalt:\s*78 deltagare/)
  assert.equal(calls, 2)

  clock.advance(5 * 60_000)
  const newerSecond = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/users"] = () => {
    calls++
    if (calls === 3) return Response.json(firstPage, { headers: { link: '<https://canvas.example/api/v1/courses/7/users?page=2>; rel="next"' } })
    return newerSecond.promise
  }
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Totalt:\s*78 deltagare/)
  assert.doesNotMatch(app.captureCharFrame(), /Hittills:\s*50 deltagare/)
  await act(async () => { newerSecond.resolve(Response.json([...finalPage, { id: 79, name: "Student 79", enrollments: [{ type: "StudentEnrollment" }] }])) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Totalt:\s*79 deltagare/)
})

test("People keeps a partial list visibly incomplete after a later page fails", async t => {
  const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, name: `Student ${index + 1}`, enrollments: [{ type: "StudentEnrollment" }] }))
  let calls = 0
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "people", label: "People" }],
    "/api/v1/courses/7/users": () => {
      calls++
      if (calls === 1) return Response.json(firstPage, { headers: { link: '<https://canvas.example/api/v1/courses/7/users?page=2>; rel="next"' } })
      return new Response("", { status: 503 })
    },
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  await app.waitForText("Hittills:")
  assert.match(app.captureCharFrame(), /Listan\s+är\s+ofullständig/)
  assert.match(app.captureCharFrame(), /Hittills:\s*50 deltagare/)
  assert.doesNotMatch(app.captureCharFrame(), /Totalt:\s*50 deltagare/)
  assert.equal(calls, 2)
  await app.input("r")
  assert.match(app.captureCharFrame(), /Hittills:\s*50 deltagare/)
  assert.equal(calls, 2, "failed requests observe the cooldown")
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Hittills:\s*50 deltagare/)
})

test("terminal theme responses repaint the app without losing the open course", async t => {
  const app = await mountApp(t)
  await app.input("\x1b]10;rgb:17/20/33\x07\x1b]11;rgb:f6/f8/fc\x07")
  assert.equal(app.renderer.themeMode, "light")
  const colors = () => app.captureSpans().lines.flatMap(line => line.spans).filter(span => span.text.trim())
  const hex = (rgba: { toInts(): number[] }) => "#" + rgba.toInts().slice(0, 3).map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()
  assert.ok(colors().some(span => hex(span.bg) === themes.light.selectedBackground))
  assert.ok(colors().some(span => hex(span.fg) === themes.light.muted))
  await app.input("\r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Kursintroduktion/)
  assert.ok(colors().some(span => hex(span.fg) === themes.light.heading))
  assert.ok(colors().some(span => hex(span.fg) === themes.light.code))
  await app.input("l")
  assert.ok(colors().some(span => span.text.includes("kurslänk") && hex(span.fg) === themes.light.selectedLinkText && hex(span.bg) === themes.light.selectedLinkBackground))
  await app.input("\x1b[?997;1n\x1b]10;rgb:f3/f6/fb\x07\x1b]11;rgb:11/18/27\x07")
  assert.equal(app.renderer.themeMode, "dark")
  assert.match(app.captureCharFrame(), /Kursintroduktion/)
  assert.ok(colors().some(span => hex(span.fg) === themes.dark.heading))
  assert.ok(colors().some(span => hex(span.fg) === themes.dark.code))
  assert.ok(colors().some(span => span.text.includes("kurslänk") && hex(span.fg) === themes.dark.selectedLinkText && hex(span.bg) === themes.dark.selectedLinkBackground))
  assert.ok(!colors().some(span => hex(span.bg) === themes.light.background))
})

async function openModules(app: Awaited<ReturnType<typeof mountApp>>) {
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
}

function mockClock(t: TestContext) {
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  return { advance: (milliseconds: number) => { now += milliseconds } }
}

test("rapid navigation and refresh reuse modules until the 30-second cooldown expires", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t)
  await openModules(app)
  await app.input("\x1b[B")
  const row = app.renderer.root.findDescendantById("module-row-item:1:10")
  const calls = () => app.requested.filter(path => path.endsWith("/modules")).length
  const revisit = async () => {
    await app.input("\x1b[D")
    await app.input("\x1b[C")
  }
  for (let index = 0; index < 20; index++) {
    await revisit()
    await app.input("r")
  }
  assert.equal(calls(), 1)
  clock.advance(29_999)
  await revisit()
  assert.equal(calls(), 1)
  app.routes["/api/v1/courses/7/modules"] = [{ id: 1, name: "Första modulen", items_count: 1, items: [{ id: 10, title: "Uppdaterad modulsida", type: "Page", page_url: "intro" }] }]
  clock.advance(1)
  await revisit()
  assert.equal(calls(), 2)
  assert.match(app.captureCharFrame(), /Uppdaterad modulsida/)
  assert.equal(app.renderer.root.findDescendantById("module-row-item:1:10"), row)
  await revisit()
  await app.input("r")
  assert.equal(calls(), 2)
  clock.advance(30_000)
  await app.input("r")
  assert.equal(calls(), 3)
})

test("failed initial module requests are throttled and can be retried after the cooldown", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t, { "/api/v1/courses/7/modules": () => new Response("", { status: 503 }) })
  await openModules(app)
  const calls = () => app.requested.filter(path => path.endsWith("/modules")).length
  assert.equal(calls(), 1)
  for (let index = 0; index < 5; index++) {
    await app.input("\x1b[D")
    await app.input("\x1b[C")
    await app.input("r")
  }
  assert.equal(calls(), 1)
  app.routes["/api/v1/courses/7/modules"] = [{ id: 1, name: "Återhämtad modul", items_count: 0 }]
  clock.advance(30_000)
  await app.input("r")
  assert.equal(calls(), 2)
  assert.match(app.captureCharFrame(), /Återhämtad modul/)
})

test("f favorites the selected module page without opening it, and toggles it off again", async t => {
  const app = await mountApp(t)
  await openModules(app)
  await app.input("\x1b[B")
  await app.waitForText("f: favoritmarkera sidan")
  await app.input("f")
  await app.waitForText("f: ta bort favorit")
  assert.match(app.captureCharFrame(), /Modulsida · Page ★/)
  const saved = JSON.parse(await readFile(app.favoritesFile, "utf8"))
  assert.deepEqual(saved.pages, [{ baseUrl: "https://canvas.example", courseId: "7", pageUrl: "intro", title: "Modulsida" }])
  assert.doesNotMatch(app.captureCharFrame(), /Modulens innehåll/, "favoriting keeps the module list open")
  await app.input("f")
  await app.waitForText("f: favoritmarkera sidan")
  assert.deepEqual(JSON.parse(await readFile(app.favoritesFile, "utf8")).pages, [])
})

test("restored favorites follow module order and keep the selected page as modules arrive", async t => {
  const savedFavorites = ["F10", "F06", "F09", "F07", "F08"].map(title => ({
    baseUrl: "https://canvas.example", courseId: "7", pageUrl: title.toLowerCase(), title,
  }))
  const modules: CanvasModule[] = [
    { id: 1, name: "Tidiga sidor", items_count: 2, items: ["F06", "F07"].map((title, index) => ({ id: index + 10, title, type: "Page", page_url: title.toLowerCase() })) },
    { id: 2, name: "Senare sidor", items_count: 3, items: ["F08", "F09", "F10"].map((title, index) => ({ id: index + 20, title, type: "Page", page_url: title.toLowerCase() })) },
  ]
  const pending = Promise.withResolvers<Response>()
  const app = await mountApp(t, {
    "/api/v1/courses/7/modules": () => pending.promise,
    "/api/v1/courses/7/pages/f08": { title: "F08", body: "<p>Vald favorit F08</p>" },
  }, savedFavorites)
  await app.input("\r")
  await app.waitForText("F10")
  assert.ok(app.captureCharFrame().indexOf("F10") < app.captureCharFrame().indexOf("F06"))
  await app.input("\x1b[A") // Select F08 before the module list arrives.
  await act(async () => { pending.resolve(Response.json(modules)) })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  const positions = ["F06", "F07", "F08", "F09", "F10"].map(title => frame.indexOf(title))
  assert.ok(positions.every(position => position >= 0))
  assert.deepEqual(positions, [...positions].sort((first, second) => first - second))
  assert.equal(app.requested.filter(path => path.endsWith("/modules")).length, 1)
  assert.deepEqual(JSON.parse(await readFile(app.favoritesFile, "utf8")).pages, savedFavorites)
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Vald favorit F08/)
})

test("Shift+arrows jump between module headers from items and keep ordinary movement intact", async t => {
  const modules: CanvasModule[] = [
    { id: 1, name: "Ett", items_count: 2, items: [{ id: 11, title: "A", type: "Page", page_url: "a" }, { id: 12, title: "B", type: "Page", page_url: "b" }] },
    { id: 2, name: "Två", items_count: 2, items: [{ id: 21, title: "C", type: "Page", page_url: "c" }, { id: 22, title: "D", type: "Page", page_url: "d" }] },
    { id: 3, name: "Tre", items_count: 1, items: [{ id: 31, title: "E", type: "Page", page_url: "e" }] },
  ]
  const app = await mountApp(t, { "/api/v1/courses/7/modules": modules })
  await openModules(app)
  const selected = (key: string) => {
    const row = app.renderer.root.findDescendantById(`module-row-${key}`) as BoxRenderable
    return row.backgroundColor.toInts().slice(0, 3).join(",") === "49,95,140"
  }
  assert.ok(selected("module:1"))
  await app.input("\x1b[1;2B")
  assert.ok(selected("module:2"))
  await app.input("\x1b[B")
  assert.ok(selected("item:2:21"))
  await app.input("\x1b[1;2B")
  assert.ok(selected("module:3"))
  await app.input("\x1b[1;2B")
  assert.ok(selected("module:3"), "down at the last module stays put")
  await app.input("\x1b[1;2A")
  assert.ok(selected("module:2"))
  await app.input("\x1b[B")
  await app.input("\x1b[B")
  assert.ok(selected("item:2:22"))
  await app.input("\x1b[1;2A")
  assert.ok(selected("module:1"))
  await app.input("\x1b[B")
  assert.ok(selected("item:1:11"))
  await app.input("\x1b[1;2A")
  assert.ok(selected("item:1:11"), "up at the first module stays put")
  await app.input("\x1b[A")
  assert.ok(selected("module:1"))
})

test("header jumps scroll distant modules into view", async t => {
  const modules: CanvasModule[] = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, name: `Vecka ${index + 1}`, items_count: 0,
  }))
  const app = await mountApp(t, { "/api/v1/courses/7/modules": modules })
  await openModules(app)
  for (let index = 1; index < modules.length; index++) await app.input("\x1b[1;2B")
  const list = app.renderer.root.findDescendantById("module-list") as ScrollBoxRenderable
  assert.ok(list.scrollTop > 0)
  assert.match(app.captureCharFrame(), /Vecka 25/)
  const lastRow = app.renderer.root.findDescendantById("module-row-module:25") as BoxRenderable
  assert.deepEqual(lastRow.backgroundColor.toInts().slice(0, 3), [49, 95, 140])
  await app.input("\x1b[1;2A")
  const previousRow = app.renderer.root.findDescendantById("module-row-module:24") as BoxRenderable
  assert.deepEqual(previousRow.backgroundColor.toInts().slice(0, 3), [49, 95, 140])
})

test("left/right keeps the loaded list, row instances and scroll while one background check runs", async t => {
  const clock = mockClock(t)
  const data: CanvasModule[] = [{ id: 1, name: "Lång modul", items_count: 50, items: Array.from({ length: 50 }, (_, index) => ({ id: index + 10, title: `Sida ${index}`, type: "Page", page_url: `page-${index}` })) }]
  const app = await mountApp(t, { "/api/v1/courses/7/modules": data })
  await openModules(app)
  await app.input("\x1b[B")
  const list = app.renderer.root.findDescendantById("module-list") as ScrollBoxRenderable
  const row = app.renderer.root.findDescendantById("module-row-item:1:10")
  list.scrollTo({ x: 0, y: 20 })
  await app.renderOnce()
  const scrollTop = list.scrollTop
  assert.ok(scrollTop > 0)
  clock.advance(30_000)
  const pending = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/modules"] = () => pending.promise
  for (let index = 0; index < 3; index++) {
    await app.input("\x1b[D")
    await app.input("\x1b[C")
    assert.equal(app.renderer.root.findDescendantById("module-list"), list)
    assert.equal(app.renderer.root.findDescendantById("module-row-item:1:10"), row)
    assert.equal(list.scrollTop, scrollTop)
    assert.doesNotMatch(app.captureCharFrame(), /Laddar moduler/)
  }
  assert.equal(app.requested.filter(path => path.endsWith("/modules")).length, 2)
  await act(async () => { pending.resolve(Response.json(data)) })
  await app.renderOnce()
  assert.equal(list.scrollTop, scrollTop)
  assert.equal(app.renderer.root.findDescendantById("module-row-item:1:10"), row)
})

test("background edits patch existing rows and preserve a selection moved while the request was pending", async t => {
  const clock = mockClock(t)
  const initial: CanvasModule[] = [{ id: 1, name: "Vecka 1", items_count: 2, items: [
    { id: 10, title: "Första sidan", type: "Page", page_url: "intro" },
    { id: 20, title: "Andra sidan", type: "Page", page_url: "second" },
  ] }]
  const app = await mountApp(t, { "/api/v1/courses/7/modules": initial, "/api/v1/courses/7/pages/second": { title: "Andra sidan", body: "<p>Rätt sida efter uppdatering</p>" } })
  await openModules(app)
  await app.input("\x1b[B")
  const row = app.renderer.root.findDescendantById("module-row-item:1:20") as BoxRenderable
  const list = app.renderer.root.findDescendantById("module-list")
  clock.advance(30_000)
  const pending = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/modules"] = () => pending.promise
  await app.input("\x1b[D")
  await app.input("\x1b[C")
  await app.input("\x1b[B")
  const updated = structuredClone(initial)
  updated[0].items!.unshift({ id: 30, title: "Ny sida före valet", type: "Page", page_url: "new" })
  updated[0].items![2].title = "Uppdaterad andra sida"
  updated[0].items_count = 3
  await act(async () => { pending.resolve(Response.json(updated)) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Uppdaterad andra sida/)
  assert.equal(app.renderer.root.findDescendantById("module-list"), list)
  assert.equal(app.renderer.root.findDescendantById("module-row-item:1:20"), row)
  assert.deepEqual(row.backgroundColor.toInts().slice(0, 3), [49, 95, 140])
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Rätt sida efter uppdatering/)
})

test("a failed background refresh keeps modules usable", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t)
  await openModules(app)
  await app.input("\x1b[B")
  clock.advance(30_000)
  app.routes["/api/v1/courses/7/modules"] = () => new Response("", { status: 503 })
  await app.input("\x1b[D")
  await app.input("\x1b[C")
  assert.match(app.captureCharFrame(), /Visar\s+sparade\s+moduler/)
  assert.match(app.captureCharFrame(), /Modulsida/)
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Modulens innehåll/)
})

test("a late response for another course cannot replace the current module list", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t, {
    "/api/v1/users/self/favorites/courses": [{ id: 7, name: "Testkurs", course_code: "TEST101" }, { id: 8, name: "Andra kursen", course_code: "TEST102" }],
    "/api/v1/courses/8/tabs": [{ id: "home", label: "Home" }, { id: "modules", label: "Moduler" }],
    "/api/v1/courses/8/modules": [{ id: 8, name: "Andra kursens moduler", items_count: 0 }],
  })
  await openModules(app)
  clock.advance(30_000)
  const pending = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/modules"] = () => pending.promise
  await app.input("\x1b[D")
  await app.input("\x1b[C")
  await app.input("\x1b[D")
  await app.input("\x1b[D")
  await app.input("\x1b[B")
  await openModules(app)
  assert.match(app.captureCharFrame(), /Andra kursens moduler/)
  await act(async () => { pending.resolve(Response.json([{ id: 1, name: "Första kursens nya moduler", items_count: 0 }])) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Andra kursens moduler/)
  assert.doesNotMatch(app.captureCharFrame(), /Första kursens nya moduler/)
})

test("a cached page appears immediately, revalidates when stale, and ignores late previous pages", async t => {
  const clock = mockClock(t)
  const modules: CanvasModule[] = [{ id: 1, name: "Vecka 1", items_count: 2, items: [
    { id: 10, title: "Första sidan", type: "Page", page_url: "intro" },
    { id: 20, title: "Andra sidan", type: "Page", page_url: "second" },
  ] }]
  const app = await mountApp(t, {
    "/api/v1/courses/7/modules": modules,
    "/api/v1/courses/7/pages/intro": { title: "Första sidan", body: "<p>Äldre innehåll</p>" },
    "/api/v1/courses/7/pages/second": { title: "Andra sidan", body: "<p>Andra sidans innehåll</p>" },
  })
  await openModules(app)
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Äldre innehåll/)
  const calls = () => app.requested.filter(path => path.endsWith("/pages/intro")).length
  assert.equal(calls(), 1)
  await app.input("\x1b[D")
  const cachedStart = performance.now()
  await app.input("\r")
  t.diagnostic(`cached page input to rendered frame: ${(performance.now() - cachedStart).toFixed(1)} ms`)
  assert.match(app.captureCharFrame(), /Äldre innehåll/)
  assert.equal(calls(), 1, "fresh revisit uses the cached page")

  clock.advance(5 * 60_000)
  const pending = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/pages/intro"] = () => pending.promise
  await app.input("\x1b[D")
  const staleStart = performance.now()
  await app.input("\r")
  t.diagnostic(`stale page input to rendered frame: ${(performance.now() - staleStart).toFixed(1)} ms`)
  assert.match(app.captureCharFrame(), /Äldre innehåll/)
  assert.match(app.captureCharFrame(), /Visar\s+sparad\s+sida/)
  assert.equal(calls(), 2)
  await app.input("r")
  assert.equal(calls(), 2, "refresh reuses the pending request")

  await app.input("\x1b[D")
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Andra sidans innehåll/)
  await act(async () => { pending.resolve(Response.json({ title: "Första sidan", body: "<p>Sent nytt innehåll</p>" })) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Andra sidans innehåll/)
  assert.doesNotMatch(app.captureCharFrame(), /Sent nytt innehåll/)
})

test("plain Left dismisses a pending home response", async t => {
  const pending = Promise.withResolvers<Response>()
  const app = await mountApp(t, { "/api/v1/courses/7": () => pending.promise })
  await app.input("\r")
  await app.input("\r")
  await app.input("\x1b[D")
  assert.doesNotMatch(app.captureCharFrame(), /Laddar innehåll/)
  await act(async () => { pending.resolve(Response.json({ id: 7, name: "Testkurs", default_view: "wiki" })) })
  await app.renderOnce()
  assert.doesNotMatch(app.captureCharFrame(), /Kursintroduktion|Laddar innehåll/)
  assert.equal(app.requested.filter(path => path.endsWith("/front_page")).length, 0)
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Första modulen/)
})

test("leaving a pending page keeps the module list and its refresh action", async t => {
  const clock = mockClock(t)
  const pending = Promise.withResolvers<Response>()
  const app = await mountApp(t, { "/api/v1/courses/7/pages/intro": () => pending.promise })
  await openModules(app)
  await app.input("\x1b[B")
  await app.input("\r")
  await app.input("\x1b[D")
  await act(async () => { pending.resolve(Response.json({ title: "Modulsida", body: "<p>Försenat innehåll</p>" })) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Modulsida/)
  assert.doesNotMatch(app.captureCharFrame(), /Försenat innehåll/)
  clock.advance(30_000)
  await app.input("r")
  assert.equal(app.requested.filter(path => path.endsWith("/modules")).length, 2)
})

test("background course, topic and assignment reorders retain the selected IDs", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t, {
    "/api/v1/users/self/favorites/courses": [
      { id: 7, name: "Testkurs", course_code: "ONE" },
      { id: 8, name: "Vald kurs", course_code: "TWO" },
    ],
    "/api/v1/courses/8/tabs": [{ id: "home", label: "Home" }, { id: "discussions", label: "Discussions" }, { id: "assignments", label: "Assignments" }],
    "/api/v1/courses/8/discussion_topics": [
      { id: 10, title: "Första ämnet", message: "Text" },
      { id: 20, title: "Valt ämne", message: "Text" },
    ],
    "/api/v1/courses/8/discussion_topics/20/view": { participants: [], view: [] },
    "/api/v1/courses/8/assignments": [
      { id: 10, name: "Första uppgiften", description: "Text" },
      { id: 20, name: "Vald uppgift", description: "Text" },
    ],
    "/api/v1/courses/8/assignments/20": { id: 20, name: "Vald uppgift", description: "Text" },
  })
  await app.input("\x1b[B")
  clock.advance(30_000)
  app.routes["/api/v1/users/self/favorites/courses"] = [
    { id: 9, name: "Ny kurs", course_code: "NEW" },
    { id: 7, name: "Testkurs", course_code: "ONE" },
    { id: 8, name: "Vald kurs", course_code: "TWO" },
  ]
  await app.input("r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Vald kurs/)

  await app.input("\x1b[B")
  await app.input("\r")
  await app.input("\x1b[B")
  clock.advance(30_000)
  app.routes["/api/v1/courses/8/discussion_topics"] = [
    { id: 30, title: "Nytt ämne", message: "Text" },
    { id: 10, title: "Första ämnet", message: "Text" },
    { id: 20, title: "Valt ämne", message: "Text" },
  ]
  await app.input("r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Valt ämne/)
  await app.input("\x1b[D")
  await app.input("\x1b[D")

  await app.input("\x1b[B")
  await app.input("\r")
  await app.input("\x1b[B")
  clock.advance(30_000)
  app.routes["/api/v1/courses/8/assignments"] = [
    { id: 30, name: "Ny uppgift", description: "Text" },
    { id: 10, name: "Första uppgiften", description: "Text" },
    { id: 20, name: "Vald uppgift", description: "Text" },
  ]
  await app.input("r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Vald uppgift/)
})

test("course tab reordering keeps refresh on the selected tab", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [
      { id: "home", label: "Home" },
      { id: "syllabus", label: "Kursöversikt" },
      { id: "assignments", label: "Uppgifter" },
    ],
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  await app.input("\x1b[D")
  clock.advance(30_000)
  app.routes["/api/v1/courses/7/tabs"] = [
    { id: "home", label: "Home" },
    { id: "assignments", label: "Uppgifter" },
    { id: "syllabus", label: "Kursöversikt" },
  ]
  await app.input("r")
  clock.advance(30_000)
  await app.input("r")
  assert.equal(app.requested.filter(path => path.endsWith("/assignments")).length, 0)
  assert.equal(app.requested.filter(path => path.endsWith("/tabs")).length, 3)
})

test("a read announcement stays read when cached and refreshed lists still say unread", async t => {
  const clock = mockClock(t)
  const unread = { id: 10, title: "Meddelande", context_code: "course_7", message: "Text", read_state: "unread", unread_count: 1, posted_at: "2026-09-23T09:00:00Z" }
  const app = await mountApp(t, {
    "/api/v1/announcements": [unread],
    "/api/v1/courses/7/discussion_topics/10/read": {},
  })
  await app.input("\t")
  await app.input("\r")
  await app.input("\x1b[D")
  await app.input("\x1b[D")
  await app.waitForText("Meddelande")
  assert.match(app.captureCharFrame(), /○\s+Meddelande/)
  clock.advance(60_000)
  await app.input("r")
  assert.match(app.captureCharFrame(), /○\s+Meddelande/)
})

test("home revisit is immediate and an expired front page updates in place", async t => {
  const clock = mockClock(t)
  const app = await mountApp(t)
  await app.input("\r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Kursintroduktion/)
  const calls = () => app.requested.filter(path => path.endsWith("/front_page")).length
  assert.equal(calls(), 1)
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Kursintroduktion/)
  assert.equal(calls(), 1)

  clock.advance(5 * 60_000)
  const pending = Promise.withResolvers<Response>()
  app.routes["/api/v1/courses/7/front_page"] = () => pending.promise
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Kursintroduktion/)
  assert.match(app.captureCharFrame(), /Visar\s+sparad\s+startsida/)
  assert.equal(calls(), 2)
  await act(async () => { pending.resolve(Response.json({ title: "Välkommen", body: "<p>Ny kursintroduktion</p>" })) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Ny kursintroduktion/)
})

test("cached assignment list and grades reopen without duplicate requests", async t => {
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "assignments", label: "Uppgifter" }, { id: "grades", label: "Betyg" }],
    "/api/v1/courses/7/assignments": [{ id: 5, name: "Inlämning", description: "<p>Detaljer</p>", points_possible: 10, submission: { grade: "A", score: 10 } }],
    "/api/v1/courses/7/enrollments": [{ type: "StudentEnrollment", grades: { current_grade: "A", current_score: 100 } }],
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Inlämning/)
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Inlämning/)
  assert.doesNotMatch(app.captureCharFrame(), /Laddar uppgifter/)
  assert.equal(app.requested.filter(path => path.endsWith("/assignments")).length, 1)
  await app.input("\x1b[D")
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Aktuellt kursbetyg:\s*A/)
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Aktuellt kursbetyg:\s*A/)
  assert.equal(app.requested.filter(path => path.endsWith("/assignments")).length, 1)
  assert.equal(app.requested.filter(path => path.endsWith("/enrollments")).length, 1)
})

test("discussion text appears before replies and saved replies reopen immediately", async t => {
  const pending = Promise.withResolvers<Response>()
  const app = await mountApp(t, {
    "/api/v1/courses/7/tabs": [{ id: "home", label: "Home" }, { id: "discussions", label: "Diskussioner" }],
    "/api/v1/courses/7/discussion_topics": [{ id: 22, title: "Diskussionsämne", message: "<p>Grundtext</p>" }],
    "/api/v1/courses/7/discussion_topics/22/view": () => pending.promise,
  })
  await app.input("\r")
  await app.input("\x1b[B")
  await app.input("\r")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Grundtext/)
  assert.match(app.captureCharFrame(), /Hämtar\s+svar/)
  await act(async () => { pending.resolve(Response.json({ participants: [{ id: 3, display_name: "Svarare" }], view: [{ id: 9, user_id: 3, message: "<p>Färdigt svar</p>" }] })) })
  await app.renderOnce()
  assert.match(app.captureCharFrame(), /Färdigt svar/)
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Färdigt svar/)
  assert.equal(app.requested.filter(path => path.endsWith("/view")).length, 1)
})

test("module file metadata reopens from cache without another Canvas call", async t => {
  const app = await mountApp(t, {
    "/api/v1/courses/7/modules": [{ id: 1, name: "Filer", items_count: 1, items: [{ id: 11, title: "Formelblad", type: "File", content_id: 91 }] }],
    "/api/v1/files/91": { id: 91, display_name: "Formelblad", filename: "formelblad.pdf", "content-type": "application/pdf" },
  })
  await openModules(app)
  await app.input("\x1b[B")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Öppna i Okular/)
  await app.input("\x1b[D")
  await app.input("\r")
  assert.match(app.captureCharFrame(), /Öppna i Okular/)
  assert.equal(app.requested.filter(path => path.endsWith("/files/91")).length, 1)
})
