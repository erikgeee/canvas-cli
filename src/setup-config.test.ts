import assert from "node:assert/strict"
import test from "node:test"
import { envFileContents, normalizeCanvasBaseUrl, validateCanvasToken } from "./setup-config.js"

test("normalizeCanvasBaseUrl accepts Canvas URLs and removes trailing slashes", () => {
  assert.equal(normalizeCanvasBaseUrl(" https://canvas.kth.se/// "), "https://canvas.kth.se")
})

test("normalizeCanvasBaseUrl rejects unsafe or incomplete URLs", () => {
  assert.throws(() => normalizeCanvasBaseUrl("canvas.kth.se"), /fullständig webbadress/)
  assert.throws(() => normalizeCanvasBaseUrl("file:///tmp/canvas"), /https:\/\/ eller http:\/\//)
  assert.throws(() => normalizeCanvasBaseUrl("https://canvas.example?token=secret"), /query-parametrar/)
})

test("validateCanvasToken rejects empty tokens and whitespace", () => {
  assert.equal(validateCanvasToken(" 123~abc "), "123~abc")
  assert.throws(() => validateCanvasToken(""), /inte vara tom/)
  assert.throws(() => validateCanvasToken("token med blanksteg"), /blanksteg/)
})

test("envFileContents creates the two local environment variables", () => {
  assert.equal(
    envFileContents("https://canvas.example/", "123~abc"),
    "CANVAS_BASE_URL=https://canvas.example\nCANVAS_ACCESS_TOKEN=123~abc\n",
  )
})
