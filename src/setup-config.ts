export function normalizeCanvasBaseUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("Canvas-adressen får inte vara tom.")

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("Canvas-adressen måste vara en fullständig webbadress, till exempel https://canvas.kth.se.")
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Canvas-adressen måste börja med https:// eller http://.")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Canvas-adressen får inte innehålla inloggning, query-parametrar eller fragment.")
  }

  return trimmed.replace(/\/+$/, "")
}

export function validateCanvasToken(value: string) {
  const token = value.trim()
  if (!token) throw new Error("Canvas-token får inte vara tom.")
  if (/\s/.test(token)) throw new Error("Canvas-token får inte innehålla blanksteg eller radbrytningar.")
  return token
}

export function envFileContents(baseUrl: string, token: string) {
  return `CANVAS_BASE_URL=${normalizeCanvasBaseUrl(baseUrl)}\nCANVAS_ACCESS_TOKEN=${validateCanvasToken(token)}\n`
}
