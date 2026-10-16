import { useRenderer } from "@opentui/react"
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react"
import { resolveThemeMode, themes } from "./theme.js"

const ThemeContext = createContext(themes.dark)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const renderer = useRenderer()
  const subscribe = useCallback((onChange: () => void) => {
    renderer.on("theme_mode", onChange)
    return () => { renderer.off("theme_mode", onChange) }
  }, [renderer])
  const getSnapshot = useCallback(() => renderer.themeMode, [renderer])
  const terminalMode = useSyncExternalStore(subscribe, getSnapshot)
  const theme = themes[resolveThemeMode(terminalMode)]

  return (
    <ThemeContext.Provider value={theme}>
      <box id="canvas-theme" style={{ backgroundColor: theme.background, width: "100%", height: "100%", flexDirection: "column" }}>
        {children}
      </box>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
