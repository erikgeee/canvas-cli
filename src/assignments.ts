import type { CanvasAssignment } from "./canvas.js"
import { pageBodyToText } from "./html.js"

function assignmentStatus(assignment: CanvasAssignment) {
  if (assignment.locked_for_user) return "låst"
  if (assignment.submission?.missing) return "saknas"
  if (assignment.submission?.late) return "försenad"
  if (assignment.submission?.submitted_at) return "inlämnad"
  return "ej inlämnad"
}

function assignmentDate(value?: string) {
  return value && !Number.isNaN(new Date(value).valueOf())
    ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "ingen deadline"
}

export function assignmentDescription(assignment: CanvasAssignment) {
  return [assignmentDate(assignment.due_at), assignment.points_possible === undefined ? undefined : `${assignment.points_possible} p`, assignmentStatus(assignment)].filter(Boolean).join(" · ")
}

export function assignmentText(assignment: CanvasAssignment) {
  const details = [
    `Deadline: ${assignmentDate(assignment.due_at)}`,
    assignment.unlock_at && `Öppnar: ${assignmentDate(assignment.unlock_at)}`,
    assignment.lock_at && `Stänger: ${assignmentDate(assignment.lock_at)}`,
    assignment.points_possible !== undefined && `Poäng: ${assignment.points_possible}`,
    `Status: ${assignmentStatus(assignment)}`,
    assignment.submission?.grade && `Betyg: ${assignment.submission.grade}`,
    assignment.lock_explanation && assignment.lock_explanation,
  ].filter(Boolean)
  const description = pageBodyToText(assignment.description ?? "")
  return `${details.join("\n")}${description ? `\n\n${description}` : ""}`
}
