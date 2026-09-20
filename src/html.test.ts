import assert from "node:assert/strict"
import test from "node:test"
import { discussionEntriesToParts, discussionEntriesToText, pageBodyParts, pageBodyToText, pageLinks } from "./html.js"

test("pageBodyToText keeps text, lists, and links", () => {
  assert.equal(
    pageBodyToText('<h2>Hej</h2><p>Se <a href="https://example.test?a=1&amp;b=2">länken</a>.</p><ul><li>ett</li></ul>'),
    "Hej\nSe länken (https://example.test?a=1&b=2).\n• ett",
  )
})

test("pageLinks keeps safe web links and resolves relative Canvas links", () => {
  assert.deepEqual(
    pageLinks('<a href="/courses/1/pages/a">Canvas</a><a href="javascript:alert(1)">Nej</a><a href="http://[">Trasig</a>', "https://canvas.example"),
    [{ label: "Canvas", url: "https://canvas.example/courses/1/pages/a" }],
  )
})

test("pageBodyParts keeps a link in its place for inline rendering", () => {
  assert.deepEqual(
    pageBodyParts('<p>Se <a href="/courses/1/pages/a">Canvas</a>.</p>', "https://canvas.example"),
    [
      { text: "Se " },
      { text: "Canvas", link: { label: "Canvas", url: "https://canvas.example/courses/1/pages/a" } },
      { text: "." },
    ],
  )
})

test("länkad text döljer adressen men länkar utan text förblir synliga", () => {
  const parts = pageBodyParts('<p><a href="/courses/1/pages/a">Läs sidan</a> och <a href="https://example.test"></a></p>', "https://canvas.example")
  assert.equal(parts.map((part) => part.text).join(""), "Läs sidan och https://example.test/")
  assert.deepEqual(parts.filter((part) => part.link).map((part) => part.link?.url), ["https://canvas.example/courses/1/pages/a", "https://example.test/"])
})

test("discussionEntriesToText keeps authors and nested replies readable", () => {
  assert.equal(
    discussionEntriesToText([{ id: 1, user_id: 10, message: "<p>Första svaret</p>", replies: [{ id: 2, user_id: 11, message: "<p>Följdfråga</p>" }] }], [{ id: 10, display_name: "Ada" }, { id: 11, display_name: "Bo" }]),
    "Ada:\nFörsta svaret\n\n  Bo:\n  Följdfråga",
  )
})

test("table cells stay separate and embedded media does not silently disappear", () => {
  assert.equal(pageBodyToText("<table><tr><th>Namn</th><th>Tid</th></tr><tr><td>Ada</td><td>10:00</td></tr></table>"), "Namn | Tid\nAda | 10:00")
  const text = pageBodyParts('<p>Film</p><iframe src="https://video.example">fallback</iframe><img alt="Diagram" src="/image">', "https://canvas.example").map(part => part.text).join("")
  assert.match(text, /Inbäddat media/)
  assert.match(text, /Bild: Diagram/)
})

test("rubriker, betoning och listor behåller sin struktur", () => {
  const parts = pageBodyParts("<h2>Viktigt</h2><p>Vanlig <strong>fet <em>och kursiv</em></strong> text.</p><ol><li>Först</li><li>Sedan</li></ol>", "https://canvas.example")
  assert.equal(parts.map((part) => part.text).join(""), "Viktigt\n\nVanlig fet och kursiv text.\n\n1. Först\n2. Sedan")
  assert.deepEqual(parts.find((part) => part.text === "Viktigt"), { text: "Viktigt", heading: 2, bold: true })
  assert.deepEqual(parts.find((part) => part.text === "fet "), { text: "fet ", bold: true })
  assert.deepEqual(parts.find((part) => part.text === "och kursiv"), { text: "och kursiv", bold: true, italic: true })
})

test("HTML-parsning hanterar entiteter, ofullständiga taggar och osäkra länkar", () => {
  const parts = pageBodyParts('<p>Å &amp; ö <b>fet <i>kursiv</p><a href="javascript:alert(1)">inte klickbar</a><script>hemlig()</script>', "https://canvas.example")
  assert.match(parts.map((part) => part.text).join(""), /Å & ö fet kursiv/)
  assert.equal(parts.some((part) => part.link), false)
  assert.equal(parts.some((part) => part.text.includes("hemlig")), false)
})

test("vanliga inline-stilar från Canvas behåller fet och kursiv text", () => {
  const parts = pageBodyParts('<p><span style="font-weight: 700">Fet</span> och <span style="font-style: italic; text-decoration: underline">kursiv</span></p>', "https://canvas.example")
  assert.deepEqual(parts.find((part) => part.text === "Fet"), { text: "Fet", bold: true })
  assert.deepEqual(parts.find((part) => part.text === "kursiv"), { text: "kursiv", italic: true, underline: true })
})

test("diskussionssvar behåller formatering och länkar", () => {
  const parts = discussionEntriesToParts([{ id: 1, user_id: 10, message: '<p><strong>Viktigt</strong> <a href="/courses/1/pages/a">länk</a></p>' }], [{ id: 10, display_name: "Ada" }], "https://canvas.example")
  assert.deepEqual(parts[0], { text: "Ada:\n", bold: true })
  assert.deepEqual(parts.find((part) => part.text === "Viktigt"), { text: "Viktigt", bold: true })
  assert.equal(parts.find((part) => part.link)?.link?.url, "https://canvas.example/courses/1/pages/a")
})
