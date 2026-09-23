import assert from "node:assert/strict"
import test from "node:test"
import { gradesText, pageParts, peopleText } from "./course-content.js"

test("empty, locked and media-only pages explain what is available", () => {
  assert.match(pageParts({ title: "Tom", body: "<p>&nbsp;</p>" }, "https://canvas.example")[0].text, /tom i Canvas/)
  assert.match(pageParts({ title: "Låst", locked_for_user: true, body: "hidden", lock_explanation: "<p>Öppnar i oktober</p>" }, "https://canvas.example")[0].text, /^Öppnar i oktober$/)
  assert.match(pageParts({ title: "Video", body: '<iframe src="https://video.example"></iframe>' }, "https://canvas.example")[0].text, /Inbäddat media/)
})

test("people counts participants once per role without mutating the list", () => {
  const people = [{ id: 1, name: "Bo", enrollments: [{ type: "StudentEnrollment" }, { type: "StudentEnrollment" }] }, { id: 2, name: "Ada", enrollments: [{ type: "TeacherEnrollment" }] }]
  assert.equal(peopleText(people), "Totalt: 2 deltagare\nStudenter: 1 · Lärare: 1\n\nAda — Lärare\nBo — Student")
  assert.equal(people[0].name, "Bo")
  assert.equal(peopleText([]), "Totalt: 0 deltagare\n\nInga deltagare är synliga för dig i den här kursen.")
})

test("people includes all role groups and explains overlapping membership", () => {
  const text = peopleText([
    { id: 1, name: "Ada", enrollments: [{ type: "StudentEnrollment" }, { type: "TaEnrollment" }, { type: "TaEnrollment" }] },
    { id: 2, name: "Bo", enrollments: [{ type: "TeacherEnrollment" }] },
    { id: 3, name: "Cleo", enrollments: [{ type: "DesignerEnrollment" }] },
    { id: 4, name: "Dani", enrollments: [{ type: "ObserverEnrollment" }] },
    { id: 5, name: "Elis", enrollments: [{ type: "CustomEnrollment", role: "Gäst" }] },
    { id: 6, name: "Fran" },
  ])
  assert.match(text, /^Totalt: 6 deltagare\nStudenter: 1 · Lärare: 1 · Assistenter: 1 · Kursdesigners: 1 · Observatörer: 1 · Gäst: 1 · Okänd roll: 1\n/)
  assert.match(text, /Deltagare med flera roller räknas i varje rollgrupp\./)
  assert.match(text, /Ada — Student, Assistent/)
  assert.match(text, /Fran — Okänd roll/)
})

test("grades preserves zero, distinguishes missing results and does not invent totals", () => {
  const text = gradesText([
    { id: 1, name: "Noll", points_possible: 10, submission: { score: 0, grade: "0" } },
    { id: 2, name: "Väntar", submission: { submitted_at: "2026-09-16", grade: null, score: null } },
    { id: 3, name: "Undantag", submission: { excused: true } },
  ], [{ type: "StudentEnrollment", grades: { current_score: 0 } }])
  assert.match(text, /Aktuellt resultat: 0 %/)
  assert.match(text, /0 \/ 10 p/)
  assert.match(text, /Inlämnad · ej betygsatt/)
  assert.match(text, /Undantagen/)
  assert.match(gradesText([], []), /inget sammanlagt kursresultat/)
  assert.match(gradesText([], [], "Åtkomst nekad"), /Åtkomst nekad/)
})
