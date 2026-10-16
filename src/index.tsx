import { createCliRenderer } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"
import { createRoot } from "@opentui/react"
import { App } from "./app.js"
import { ThemeProvider } from "./theme-context.js"

const renderer = await createCliRenderer()
await renderer.waitForThemeMode(250)
const keymap = createDefaultOpenTuiKeymap(renderer)

createRoot(renderer).render(
  <KeymapProvider keymap={keymap}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </KeymapProvider>,
)
