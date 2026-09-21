import assert from "node:assert/strict"
import test from "node:test"
import { resolveThemeMode, themes } from "./theme.js"

function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

test("both themes keep body, status, rich text and selections readable", () => {
  for (const [mode, theme] of Object.entries(themes)) {
    const pairs: [string, string][] = [
      ...[theme.background, theme.surface, theme.activeBackground].flatMap(background =>
        [theme.text, theme.muted].map(foreground => [foreground, background] as [string, string])),
      ...[theme.accent, theme.heading, theme.code, theme.error].map(foreground => [foreground, theme.background] as [string, string]),
      [theme.selectedText, theme.selectedBackground],
      [theme.selectedMuted, theme.selectedBackground],
      [theme.selectedLinkText, theme.selectedLinkBackground],
    ]
    for (const [foreground, background] of pairs) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      const contrast = (values[0] + 0.05) / (values[1] + 0.05)
      assert.ok(contrast >= 4.5, `${mode}: ${foreground} on ${background} has only ${contrast.toFixed(2)}:1 contrast`)
    }
  }
})

test("theme follows the terminal unless explicitly overridden", () => {
  assert.equal(resolveThemeMode("light", "auto"), "light")
  assert.equal(resolveThemeMode("dark", "auto"), "dark")
  assert.equal(resolveThemeMode(null, "auto"), "dark")
  assert.equal(resolveThemeMode("dark", "light"), "light")
  assert.equal(resolveThemeMode("light", "dark"), "dark")
  assert.equal(resolveThemeMode("light", "invalid"), "light")
})
