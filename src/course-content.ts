import type { CanvasAssignment, CanvasEnrollment, CanvasPage, CanvasPerson } from "./canvas.js"
import { pageBodyParts, pageBodyToText, type PageTextPart } from "./html.js"

export function pageParts(page: CanvasPage, baseUrl: string): PageTextPart[] {
  if (page.locked_for_user) return [{ text: pageBodyToText(page.lock_explanation ?? "") || "Sidan är låst i Canvas." }]
  const parts = pageBodyParts(page.body ?? "", baseUrl)
  return parts.length ? parts : [{ text: "Sidan är tom i Canvas. Inget innehåll har publicerats här ännu." }]
}

export function peopleText(people: CanvasPerson[], complete = true, loading = true) {
  const roles: Record<string, string> = { StudentEnrollment: "Student", TeacherEnrollment: "Lärare", TaEnrollment: "Assistent", DesignerEnrollment: "Kursdesigner", ObserverEnrollment: "Observatör" }
  const groupNames: Record<string, string> = { Student: "Studenter", Lärare: "Lärare", Assistent: "Assistenter", Kursdesigner: "Kursdesigners", Observatör: "Observatörer" }
  const counts = new Map<string, number>()
  for (const role of Object.values(roles)) counts.set(role, 0)
  const lines: string[] = []
  let hasMultipleRoles = false

  for (const person of [...people].sort((a, b) => a.name.localeCompare(b.name, "sv"))) {
    const personRoles = new Set<string>()
    for (const enrollment of person.enrollments ?? []) {
      personRoles.add(roles[enrollment.type] ?? enrollment.role ?? enrollment.type)
    }
    if (!personRoles.size) personRoles.add("Okänd roll")
    if (personRoles.size > 1) hasMultipleRoles = true
    for (const role of personRoles) counts.set(role, (counts.get(role) ?? 0) + 1)
    lines.push(`${person.name} — ${[...personRoles].join(", ")}`)
  }

  const summary = [complete ? `Totalt: ${people.length} deltagare` : loading ? `Hittills: ${people.length} deltagare (fler laddas…)` : `Hittills: ${people.length} deltagare (ofullständig lista)`]
  const groups: string[] = []
  for (const [role, count] of counts) {
    if (count) groups.push(`${groupNames[role] ?? role}: ${count}`)
  }
  if (groups.length) summary.push(groups.join(" · "))
  if (hasMultipleRoles) summary.push("Deltagare med flera roller räknas i varje rollgrupp.")
  const participants = lines.length ? lines.join("\n") : "Inga deltagare är synliga för dig i den här kursen."
  return `${summary.join("\n")}\n\n${participants}`
}

export function gradesText(assignments: CanvasAssignment[], enrollments: CanvasEnrollment[], summaryError?: string) {
  const grades = enrollments.find(e => e.type === "StudentEnrollment")?.grades
  const summary = [
    grades?.current_grade != null && `Aktuellt kursbetyg: ${grades.current_grade}`,
    grades?.current_score != null && `Aktuellt resultat: ${grades.current_score} %`,
    grades?.final_grade != null && `Slutbetyg i Canvas: ${grades.final_grade}`,
  ].filter(Boolean).join("\n") || summaryError || "Canvas visar inget sammanlagt kursresultat ännu."
  return `${summary}\n\nUppgiftsresultat\n\n` + (assignments.length ? assignments.map(a => {
    const s = a.submission
    const result = s?.excused ? "Undantagen" : s?.grade != null || s?.score != null
      ? [s.grade != null ? `Betyg: ${s.grade}` : "", s.score != null ? `${s.score}${a.points_possible != null ? ` / ${a.points_possible}` : ""} p` : ""].filter(Boolean).join(" · ")
      : s?.workflow_state === "pending_review" ? "Väntar på granskning" : s?.submitted_at ? "Inlämnad · ej betygsatt" : "Inget publicerat resultat"
    return `${a.name}\n${result}`
  }).join("\n\n") : "Inga uppgifter är synliga för dig.")
}
