import { getProfile, listCourses } from "./canvas.js"

try {
  const [profile, courses] = await Promise.all([getProfile(), listCourses()])

  console.log(`Token fungerar för ${profile.name ?? "din användare"}.`)
  console.log(`${courses.length} kurser hämtades.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Kunde inte kontakta Canvas.")
  process.exit(1)
}

export {}
