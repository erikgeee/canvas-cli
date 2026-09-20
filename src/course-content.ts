import type { CanvasAssignment, CanvasEnrollment, CanvasPage, CanvasPerson } from "./canvas.js"
import { pageBodyParts, pageBodyToText, type PageTextPart } from "./html.js"

export function pageParts(page: CanvasPage, baseUrl: string): PageTextPart[] {
  if (page.locked_for_user) return [{ text: pageBodyToText(page.lock_explanation ?? "") || "Sidan är låst i Canvas." }]
  const parts = pageBodyParts(page.body ?? "", baseUrl)
  return parts.length ? parts : [{ text: "Sidan är tom i Canvas. Inget innehåll har publicerats här ännu." }]
}

export function peopleText(people: CanvasPerson[]) {
  const roles: Record<string, string> = { StudentEnrollment: "Student", TeacherEnrollment: "Lärare", TaEnrollment: "Assistent", DesignerEnrollment: "Kursdesigner", ObserverEnrollment: "Observatör" }
  if (!people.length) return "Inga deltagare är synliga för dig i den här kursen."
  return `${people.length} deltagare\n\n` + [...people].sort((a, b) => a.name.localeCompare(b.name, "sv")).map(person => {
    const role = [...new Set(person.enrollments?.map(e => roles[e.type] ?? e.role ?? e.type) ?? [])].join(", ")
    return `${person.name}${role ? ` — ${role}` : ""}`
  }).join("\n")
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
