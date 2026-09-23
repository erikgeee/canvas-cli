import assert from "node:assert/strict"
import test from "node:test"
import { cachedResource, loadResource, prefetchResource, reportResourceProgress, resourceKey, selectResourceForPrefetch, subscribeResourceProgress } from "./resource-cache.js"

test("selected resource waits for a free prefetch slot and replaces an abandoned selection", async t => {
  const previousUrl = process.env.CANVAS_BASE_URL
  const previousToken = process.env.CANVAS_ACCESS_TOKEN
  process.env.CANVAS_BASE_URL = "https://canvas.example"
  process.env.CANVAS_ACCESS_TOKEN = `prefetch-test-${Math.random()}`
  t.after(() => {
    if (previousUrl === undefined) delete process.env.CANVAS_BASE_URL
    else process.env.CANVAS_BASE_URL = previousUrl
    if (previousToken === undefined) delete process.env.CANVAS_ACCESS_TOKEN
    else process.env.CANVAS_ACCESS_TOKEN = previousToken
  })

  const replies: Array<() => void> = []
  const started: string[] = []
  function loader(name: string) {
    return () => {
      started.push(name)
      return new Promise<string>(resolve => replies.push(() => resolve(name)))
    }
  }
  for (const name of ["one", "two", "three"]) assert.equal(prefetchResource(resourceKey(name), loader(name)), true)
  assert.equal(prefetchResource(resourceKey("four"), loader("four")), false)
  const cancelOld = selectResourceForPrefetch(resourceKey("old"), loader("old"))
  cancelOld()
  const cancelCurrent = selectResourceForPrefetch(resourceKey("current"), loader("current"))
  replies[0]!()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(started, ["one", "two", "three", "current"])
  cancelCurrent()
  for (const reply of replies) reply()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(cachedResource<string>(resourceKey("current"))?.value, "current")
})

test("a late subscriber sees current pagination progress without duplicating the request", async () => {
  const key = resourceKey("progress-test", Math.random())
  let finish!: (value: number[]) => void
  let starts = 0
  const loader = () => {
    starts++
    return new Promise<number[]>(resolve => { finish = resolve })
  }
  const first = loadResource(key, loader)
  reportResourceProgress(key, [1, 2], true)
  const observed: Array<{ count: number; hasNext: boolean }> = []
  const unsubscribe = subscribeResourceProgress<number[]>(key, (items, hasNext) => observed.push({ count: items.length, hasNext }))
  assert.equal(loadResource(key, loader), first)
  reportResourceProgress(key, [1, 2, 3], false)
  finish([1, 2, 3])
  await first
  unsubscribe()
  assert.equal(starts, 1)
  assert.deepEqual(observed, [{ count: 2, hasNext: true }, { count: 3, hasNext: false }])
})
