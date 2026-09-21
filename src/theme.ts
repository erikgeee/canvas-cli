export type ThemeMode = "light" | "dark"

export type Theme = {
  background: string
  surface: string
  activeBackground: string
  text: string
  muted: string
  border: string
  accent: string
  heading: string
  code: string
  error: string
  selectedBackground: string
  selectedText: string
  selectedMuted: string
  selectedLinkBackground: string
  selectedLinkText: string
}

export const themes: Record<ThemeMode, Theme> = {
  light: {
    background: "#F6F8FC",
    surface: "#FFFFFF",
    activeBackground: "#E8EDF7",
    text: "#172033",
    muted: "#4B5D75",
    border: "#7C8DA5",
    accent: "#1D4ED8",
    heading: "#754600",
    code: "#166534",
    error: "#B42318",
    selectedBackground: "#DBEAFE",
    selectedText: "#172554",
    selectedMuted: "#334E72",
    selectedLinkBackground: "#1D4ED8",
    selectedLinkText: "#FFFFFF",
  },
  dark: {
    background: "#111827",
    surface: "#1B2435",
    activeBackground: "#1C2C44",
    text: "#F3F6FB",
    muted: "#A6B4CB",
    border: "#657995",
    accent: "#89B4FA",
    heading: "#F9E2AF",
    code: "#A6E3A1",
    error: "#F38BA8",
    selectedBackground: "#315F8C",
    selectedText: "#FFFFFF",
    selectedMuted: "#D9E5F2",
    selectedLinkBackground: "#6298D2",
    selectedLinkText: "#111827",
  },
}

// CANVAS_THEME is an override for terminals that cannot report their theme.
export function resolveThemeMode(terminalMode: ThemeMode | null, preference = process.env.CANVAS_THEME): ThemeMode {
  return preference === "light" || preference === "dark" ? preference : terminalMode ?? "dark"
}
