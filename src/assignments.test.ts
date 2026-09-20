import assert from "node:assert/strict"
import test from "node:test"
import { assignmentDescription, assignmentText } from "./assignments.js"

test("assignments show deadline, status, and readable description", () => {
  const assignment = { id: 1, name: "Lab", points_possible: 10, description: "<p>Skicka <strong>in</strong>.</p>", submission: { submitted_at: "2026-01-01T12:00:00Z", grade: "A" } }
  assert.match(assignmentDescription(assignment), /ingen deadline · 10 p · inlämnad/)
  assert.match(assignmentText(assignment), /Status: inlämnad\nBetyg: A\n\nSkicka in\./)
})
