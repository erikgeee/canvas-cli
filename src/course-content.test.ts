import assert from "node:assert/strict"
import test from "node:test"
import { gradesText, pageParts, peopleText } from "./course-content.js"

test("empty, locked and media-only pages explain what is available", () => {
  assert.match(pageParts({ title: "Tom", body: "<p>&nbsp;</p>" }, "https://canvas.example")[0].text, /tom i Canvas/)
  assert.match(pageParts({ title: "Låst", locked_for_user: true, body: "hidden", lock_explanation: "<p>Öppnar i oktober</p>" }, "https://canvas.example")[0].text, /^Öppnar i oktober$/)
  assert.match(pageParts({ title: "Video", body: '<iframe src="https://video.example"></iframe>' }, "https://canvas.example")[0].text, /Inbäddat media/)
})

test("people shows names and deduplicated translated roles without mutating the list", () => {
  const people = [{ id: 1, name: "Bo", enrollments: [{ type: "StudentEnrollment" }, { type: "StudentEnrollment" }] }, { id: 2, name: "Ada", enrollments: [{ type: "TeacherEnrollment" }] }]
  assert.equal(peopleText(people), "2 deltagare\n\nAda — Lärare\nBo — Student")
  assert.equal(people[0].name, "Bo")
  assert.match(peopleText([]), /Inga deltagare/)
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
