import { type ScrollBoxRenderable, type SelectKeyBinding, type TextRenderable } from "@opentui/core"
import { spawn } from "node:child_process"
import { access, utimes } from "node:fs/promises"
import { useBindings } from "@opentui/keymap/react"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { canvasBaseUrl, canvasUrl, getAssignment, getDiscussionTopic, listPeople, listMyEnrollments, cachedPdfPath, cleanPdfCache, downloadFile, getCourseHome, getDiscussionView, getFile, getFrontPage, listAssignments, listCourses, listCourseTabs, listDiscussionTopics, listRecentAnnouncements, markAnnouncementRead, type CanvasAnnouncement, type CanvasAssignment, type CanvasCourse, type CanvasDiscussionTopic, type CanvasDiscussionView, type CanvasEnrollment, type CanvasFile, type CanvasModuleItem, type CanvasPage, type CanvasPerson, type CanvasTab } from "./canvas.js"
import { gradesText, pageParts, peopleText } from "./course-content.js"
import { assignmentDescription, assignmentText } from "./assignments.js"
import { discussionEntriesToParts, pageBodyParts, pageBodyToText, type PageLink, type PageTextPart } from "./html.js"
import { moduleHeaderNavigationIndex, moduleNavigationIndex } from "./module-tree.js"
import { courseMenuEntries, courseMenuNavigationIndex } from "./course-menu.js"
import { useModules } from "./use-modules.js"
import { cachedPage, loadPage, prefetchNextPages, selectPageForPrefetch } from "./page-cache.js"
import { allowExplicitRetryAfterPrefetchFailure, cachedResource, loadResource, reportResourceProgress, resourceKey, selectResourceForPrefetch, subscribeResourceProgress } from "./resource-cache.js"
import { useTheme } from "./theme-context.js"
import { type Theme } from "./theme.js"
import { modulePageFavorite, favoriteKey, loadFavoritePages, saveFavoritePages, type FavoritePage } from "./favorites.js"

const selectKeyBindings: SelectKeyBinding[] = [
  { name: "up", action: "move-up" },
  { name: "k", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "j", action: "move-down" },
  { name: "up", shift: true, action: "move-up-fast" },
  { name: "down", shift: true, action: "move-down-fast" },
  { name: "right", action: "select-current" },
  { name: "return", action: "select-current" },
]

const thickOptionHeight = 4

function sidebarOptionName(name: string, selected: boolean) {
  if (!selected) return name
  const contentWidth = 21
  const content = name.length > contentWidth ? `${name.slice(0, contentWidth - 1)}…` : name
  return `│ ${content.padEnd(contentWidth)} │`
}

const selectTheme = (theme: Theme, active: boolean, { compact = false, itemSpacing = 0 }: { compact?: boolean; itemSpacing?: number } = {}) => ({
  backgroundColor: active ? theme.activeBackground : undefined,
  textColor: theme.text,
  focusedBackgroundColor: active ? theme.activeBackground : undefined,
  focusedTextColor: theme.text,
  selectedBackgroundColor: theme.selectedBackground,
  selectedTextColor: theme.selectedText,
  descriptionColor: theme.muted,
  selectedDescriptionColor: theme.selectedMuted,
  showDescription: !compact,
  showSelectionIndicator: !compact,
  itemSpacing,
})

type Content =
  | { kind: "loading"; title: string }
  | { kind: "page"; url?: string; title: string; text: string; parts: PageTextPart[]; links: PageLink[]; status?: string }
  | { kind: "discussion"; title: string; text: string; parts: PageTextPart[]; links: PageLink[]; url?: string; status?: string }
  | { kind: "assignment"; title: string; text: string; parts: PageTextPart[]; links: PageLink[]; url?: string; status?: string }
  | { kind: "file"; title: string; file: CanvasFile; url?: string }
  | { kind: "external"; title: string; url?: string; message?: string }
  | { kind: "error"; title: string; message: string; url?: string }

function pageContent(page: CanvasPage, url?: string): Extract<Content, { kind: "page" }> {
  const parts = pageParts(page, process.env.CANVAS_BASE_URL ?? "")
  return { kind: "page", title: page.title, url: page.html_url ?? url, text: parts.map(part => part.text).join(""), parts, links: parts.flatMap((part) => part.link ?? []) }
}

function assignmentContent(assignment: CanvasAssignment): Extract<Content, { kind: "assignment" }> {
  const parts = pageBodyParts(assignment.description ?? "", process.env.CANVAS_BASE_URL ?? "")
  const text = assignmentText(assignment)
  const description = pageBodyToText(assignment.description ?? "")
  const details = description && text.endsWith(description) ? text.slice(0, -description.length).trimEnd() : text
  return { kind: "assignment", title: assignment.name, text, parts: [...(details ? [{ text: `${details}${parts.length ? "\n\n" : ""}` }] : []), ...parts], links: parts.flatMap((part) => part.link ?? []), url: assignment.html_url }
}

function retainedIndex<T extends { id: number | string }>(previous: T[], next: T[], index: number) {
  const selectedId = previous[index]?.id
  if (selectedId !== undefined) {
    const matchingIndex = next.findIndex(item => String(item.id) === String(selectedId))
    if (matchingIndex >= 0) return matchingIndex
  }
  return Math.max(0, Math.min(index, Math.max(0, next.length - 1)))
}

function topicDescription(topic: CanvasDiscussionTopic) {
  const date = topic.posted_at && !Number.isNaN(new Date(topic.posted_at).valueOf())
    ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(topic.posted_at))
    : "odaterad"
  const status = [topic.pinned && "fäst", topic.unread_count ? `${topic.unread_count} olästa` : "läst", topic.locked && "låst"].filter(Boolean).join(" · ")
  return [date, topic.user_name ?? "okänd avsändare", `${topic.discussion_subentry_count ?? 0} svar`, status].filter(Boolean).join(" · ")
}

function announcementDescription(announcement: CanvasAnnouncement, courses: CanvasCourse[]) {
  const courseId = announcement.context_code.replace(/^course_/, "")
  const course = courses.find((candidate) => String(candidate.id) === courseId)
  const date = announcement.posted_at && !Number.isNaN(new Date(announcement.posted_at).valueOf())
    ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(announcement.posted_at))
    : "odaterad"
  return `${course?.course_code ?? "Okänd kurs"} · ${date}`
}

function ThickOptionCard({ id, title, description, selected, active = true }: { id: string; title: string; description: string; selected: boolean; active?: boolean }) {
  const theme = useTheme()
  return (
    <box
      id={id}
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: selected ? (active ? theme.accent : theme.muted) : theme.border,
        backgroundColor: selected ? theme.selectedBackground : theme.surface,
        flexDirection: "column",
        width: "100%",
        height: thickOptionHeight,
        paddingX: 1,
        marginBottom: 1,
      }}
    >
      <text fg={selected ? theme.selectedText : theme.text} wrapMode="none" style={{ height: 1, overflow: "hidden" }}><b>{title}</b></text>
      <text fg={selected ? theme.selectedMuted : theme.muted} wrapMode="none" style={{ height: 1, overflow: "hidden" }}>{description}</text>
    </box>
  )
}

function CompactOptionRow({ id, name, selected, active, separator = false }: { id: string; name: string; selected: boolean; active: boolean; separator?: boolean }) {
  const theme = useTheme()
  const backgroundColor = separator ? undefined : selected ? theme.selectedBackground : active ? theme.activeBackground : undefined
  return (
    <box id={id} style={{ width: "100%", height: 1, flexShrink: 0, backgroundColor, overflow: "hidden" }}>
      <text fg={selected ? theme.selectedText : separator ? theme.muted : theme.text} wrapMode="none">{` ${name}`}</text>
    </box>
  )
}

function StatusLine({ text }: { text: string }) {
  const theme = useTheme()
  return (
    <box style={{ width: "100%", height: 1, flexShrink: 0, overflow: "hidden" }}>
      <text fg={theme.muted} wrapMode="none">{text.replaceAll(" ", "\u00A0")}</text>
    </box>
  )
}

function keepItemInView(scrollbox: ScrollBoxRenderable | null, itemId: string, index: number, itemCount: number) {
  if (!scrollbox || scrollbox.viewport.height <= 0) return
  if (index === 0) return scrollbox.scrollTo({ x: 0, y: 0 })
  if (index === itemCount - 1) {
    return scrollbox.scrollTo({ x: 0, y: Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height) })
  }
  scrollbox.scrollChildIntoView(itemId)
}

function openInBrowser(url: string) {
  const parsed = new URL(canvasUrl(url))
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Endast webblänkar kan öppnas.")

  const browser = spawn("xdg-open", [parsed.href], { detached: true, stdio: "ignore" })
  browser.unref()
}

function openInOkular(path: string) {
  const okular = spawn("okular", [path], { detached: true, stdio: "ignore" })
  okular.unref()
}

export function App({ favoritesFile }: { favoritesFile?: string }) {
  const renderer = useRenderer()
  const theme = useTheme()
  const scrollbarOptions = { trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.activeBackground } }
  const [courses, setCourses] = useState<CanvasCourse[]>([])
  const [courseIndex, setCourseIndex] = useState(0)
  const coursesRef = useRef(courses)
  coursesRef.current = courses
  const [status, setStatus] = useState("Laddar kurser…")
  const [recentAnnouncements, setRecentAnnouncements] = useState<CanvasAnnouncement[]>([])
  const [announcementStatus, setAnnouncementStatus] = useState("Laddar announcements…")
  const [announcementIndex, setAnnouncementIndex] = useState(0)
  const [startFocus, setStartFocus] = useState<"courses" | "announcements">("courses")
  const [course, setCourse] = useState<CanvasCourse | null>(null)
  const [tabs, setTabs] = useState<CanvasTab[]>([])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const [tabStatus, setTabStatus] = useState("")
  const [tabIndex, setTabIndex] = useState(0)
  const { modules, entries: moduleEntries, status: modulesStatus, selectedIndex: moduleIndex, selectIndex: setModuleIndex, load: loadModules } = useModules(course)
  const [topics, setTopics] = useState<CanvasDiscussionTopic[]>([])
  const topicsRef = useRef(topics)
  topicsRef.current = topics
  const [topicsStatus, setTopicsStatus] = useState("")
  const [topicIndex, setTopicIndex] = useState(0)
  const [assignments, setAssignments] = useState<CanvasAssignment[]>([])
  const assignmentsRef = useRef(assignments)
  assignmentsRef.current = assignments
  const [assignmentsStatus, setAssignmentsStatus] = useState("")
  const [assignmentIndex, setAssignmentIndex] = useState(0)
  const [linkIndex, setLinkIndex] = useState(0)
  const [linkViewport, setLinkViewport] = useState("")
  const [focus, setFocus] = useState<"menu" | "modules" | "topics" | "assignments" | "content" | "links">("menu")
  const [contentSource, setContentSource] = useState<"home" | "modules" | "topics" | "assignments">("modules")
  const [content, setContent] = useState<Content | null>(null)
  const [homeView, setHomeView] = useState("")
  const [favorites, setFavorites] = useState<FavoritePage[]>([])
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [favoriteStatus, setFavoriteStatus] = useState("")
  const [currentFavorite, setCurrentFavorite] = useState<FavoritePage | null>(null)
  const [menuSelection, setMenuSelection] = useState("tab:home")
  const retryContent = useRef<(() => void) | null>(null)
  const contentRequest = useRef(0)
  const courseNavigation = useRef(0)
  const coursesRequest = useRef(0)
  const announcementsRequest = useRef(0)
  const tabsRequest = useRef(0)
  const topicsRequest = useRef(0)
  const assignmentsRequest = useRef(0)
  const readAnnouncements = useRef(new Set<string>())
  const incompletePeople = useRef(new Map<string, CanvasPerson[]>())
  const favoriteSaving = useRef(false)
  const contentScrollRef = useRef<ScrollBoxRenderable>(null)
  const menuScrollRef = useRef<ScrollBoxRenderable>(null)
  const moduleScrollRef = useRef<ScrollBoxRenderable>(null)
  const lastModuleSelection = useRef<string | null>(null)
  const lastModuleViewport = useRef<ScrollBoxRenderable | null>(null)
  const courseScrollRef = useRef<ScrollBoxRenderable>(null)
  const announcementScrollRef = useRef<ScrollBoxRenderable>(null)
  const topicScrollRef = useRef<ScrollBoxRenderable>(null)
  const assignmentScrollRef = useRef<ScrollBoxRenderable>(null)
  const contentTextRef = useRef<TextRenderable>(null)

  const loadCourses = useCallback(async (refresh = false) => {
    const request = ++coursesRequest.current
    const key = resourceKey("favorite-courses")
    const saved = cachedResource<CanvasCourse[]>(key)
    const showCourses = (loadedCourses: CanvasCourse[], savedCopy = false) => {
      if (request !== coursesRequest.current) return
      const previousCourses = coursesRef.current
      setCourses(loadedCourses)
      setCourseIndex(index => retainedIndex(previousCourses, loadedCourses, index))
      setStatus(`${loadedCourses.length} kurser laddade.${savedCopy ? " Kontrollerar Canvas…" : ""}`)
    }
    const loadAnnouncements = async (availableCourses: CanvasCourse[]) => {
      const announcementRequest = ++announcementsRequest.current
      const ids = availableCourses.map(item => String(item.id)).sort()
      const announcementKey = resourceKey("recent-announcements", 8, ...ids)
      const stored = cachedResource<CanvasAnnouncement[]>(announcementKey)
      const showAnnouncements = (items: CanvasAnnouncement[], savedCopy = false) => {
        if (request !== coursesRequest.current || announcementRequest !== announcementsRequest.current) return
        const visible = items.map(item => readAnnouncements.current.has(resourceKey("announcement-read", item.context_code, String(item.id)))
          ? { ...item, read_state: "read" as const, unread_count: 0 } : item)
        setRecentAnnouncements(visible)
        setAnnouncementIndex((index) => Math.max(0, Math.min(index, Math.max(0, visible.length - 1))))
        setAnnouncementStatus(savedCopy ? "Visar sparade announcements · kontrollerar Canvas…" : visible.length ? "" : "Inga announcements de senaste 14 dagarna.")
      }
      if (stored) showAnnouncements(stored.value, !stored.fresh || refresh)
      else if (request === coursesRequest.current && announcementRequest === announcementsRequest.current) setAnnouncementStatus("Laddar announcements…")
      try {
        const items = await loadResource(announcementKey, () => listRecentAnnouncements(availableCourses.map(item => item.id), 8), refresh, 60_000)
        showAnnouncements(items)
      } catch (error) {
        if (request !== coursesRequest.current || announcementRequest !== announcementsRequest.current) return
        if (!stored) setRecentAnnouncements([])
        setAnnouncementStatus(`${stored ? "Visar sparade announcements · " : ""}${error instanceof Error ? error.message : "Kunde inte hämta announcements."}`)
      }
    }
    if (saved) {
      showCourses(saved.value, !saved.fresh || refresh)
      void loadAnnouncements(saved.value)
    } else setStatus("Laddar kurser…")
    try {
      const loadedCourses = await loadResource(key, listCourses, refresh)
      if (request !== coursesRequest.current) return
      showCourses(loadedCourses)
      await loadAnnouncements(loadedCourses)
    } catch (error) {
      if (request !== coursesRequest.current) return
      setStatus(`${saved ? "Visar sparade kurser · " : ""}${error instanceof Error ? error.message : "Kunde inte hämta kurser."}`)
      if (!saved) {
        setRecentAnnouncements([])
        setAnnouncementStatus("Announcements kunde inte laddas utan kurser.")
      }
    }
  }, [])

  const loadTabs = useCallback(async (selectedCourse: CanvasCourse, refresh = false) => {
    const request = ++tabsRequest.current
    const navigation = courseNavigation.current
    const key = resourceKey("tabs", String(selectedCourse.id))
    const stored = cachedResource<CanvasTab[]>(key)
    const showTabs = (items: CanvasTab[], savedCopy = false) => {
      if (request !== tabsRequest.current || navigation !== courseNavigation.current) return
      const visibleTabs = items.filter(tab => !tab.hidden && tab.visibility !== "none")
      const previousTabs = tabsRef.current
      tabsRef.current = visibleTabs
      setTabs(visibleTabs)
      setTabIndex(index => retainedIndex(previousTabs, visibleTabs, index))
      setTabStatus(`${visibleTabs.length} navigeringslänkar.${savedCopy ? " Kontrollerar Canvas…" : ""}`)
    }
    if (stored) showTabs(stored.value, !stored.fresh || refresh)
    else setTabStatus("Laddar kursmeny…")
    try {
      const loadedTabs = await loadResource(key, () => listCourseTabs(selectedCourse.id), refresh)
      showTabs(loadedTabs)
    } catch (error) {
      if (request === tabsRequest.current && navigation === courseNavigation.current) setTabStatus(`${stored ? "Visar sparad kursmeny · " : ""}${error instanceof Error ? error.message : "Kunde inte hämta kursmenyn."}`)
    }
  }, [])

  const loadTopics = useCallback(async (selectedCourse: CanvasCourse, announcements: boolean, refresh = false) => {
    const request = ++topicsRequest.current
    const navigation = courseNavigation.current
    const key = resourceKey(announcements ? "course-announcements" : "discussions", String(selectedCourse.id))
    const stored = cachedResource<CanvasDiscussionTopic[]>(key)
    const showTopics = (items: CanvasDiscussionTopic[], savedCopy = false) => {
      if (request !== topicsRequest.current || navigation !== courseNavigation.current) return
      const previousTopics = topicsRef.current
      setTopics(items)
      setTopicIndex(index => retainedIndex(previousTopics, items, index))
      setTopicsStatus(items.length ? `${items.length} inlägg laddade.${savedCopy ? " Kontrollerar Canvas…" : ""}` : "Inga inlägg ännu.")
    }
    if (stored) showTopics(stored.value, !stored.fresh || refresh)
    else { setTopics([]); setTopicsStatus("Laddar inlägg…") }
    try {
      const loadedTopics = await loadResource(key, () => listDiscussionTopics(selectedCourse.id, announcements), refresh, announcements ? 60_000 : 5 * 60_000)
      showTopics(loadedTopics)
    } catch (error) {
      if (request === topicsRequest.current && navigation === courseNavigation.current) setTopicsStatus(`${stored ? "Visar sparade inlägg · " : ""}${error instanceof Error ? error.message : "Kunde inte hämta inlägg."}`)
    }
  }, [])

  const loadAssignments = useCallback(async (selectedCourse: CanvasCourse, refresh = false) => {
    const request = ++assignmentsRequest.current
    const navigation = courseNavigation.current
    const key = resourceKey("assignments", String(selectedCourse.id))
    const stored = cachedResource<CanvasAssignment[]>(key)
    const showAssignments = (items: CanvasAssignment[], savedCopy = false) => {
      if (request !== assignmentsRequest.current || navigation !== courseNavigation.current) return
      const previousAssignments = assignmentsRef.current
      setAssignments(items)
      setAssignmentIndex(index => retainedIndex(previousAssignments, items, index))
      setAssignmentsStatus(items.length ? `${items.length} uppgifter laddade.${savedCopy ? " Kontrollerar Canvas…" : ""}` : "Inga uppgifter ännu.")
    }
    if (stored) showAssignments(stored.value, !stored.fresh || refresh)
    else { setAssignments([]); setAssignmentsStatus("Laddar uppgifter…") }
    try {
      const loadedAssignments = await loadResource(key, () => listAssignments(selectedCourse.id), refresh)
      showAssignments(loadedAssignments)
    } catch (error) {
      if (request === assignmentsRequest.current && navigation === courseNavigation.current) setAssignmentsStatus(`${stored ? "Visar sparade uppgifter · " : ""}${error instanceof Error ? error.message : "Kunde inte hämta uppgifter."}`)
    }
  }, [])

  const loadDiscussion = useCallback(async (selectedCourse: CanvasCourse, topic: CanvasDiscussionTopic, refresh = false) => {
    const request = ++contentRequest.current
    retryContent.current = () => void loadDiscussion(selectedCourse, topic, true)
    const messageParts = pageBodyParts(topic.message ?? "", process.env.CANVAS_BASE_URL ?? "")
    const message = messageParts.map((part) => part.text).join("") || "Inlägget saknar textinnehåll."
    const parts = messageParts.length ? messageParts : [{ text: message }]
    const links = messageParts.flatMap((part) => part.link ?? [])
    const key = resourceKey("discussion-view", String(selectedCourse.id), String(topic.id))
    const saved = cachedResource<CanvasDiscussionView>(key)
    const showDiscussion = (view?: CanvasDiscussionView, status?: string) => {
      if (request !== contentRequest.current) return
      const replies = view ? discussionEntriesToParts(view.view, view.participants, process.env.CANVAS_BASE_URL ?? "") : []
      const allParts = replies.length ? [...parts, { text: "\n\nSvar\n\n", heading: 2, bold: true }, ...replies] : parts
      setContent({ kind: "discussion", title: topic.title, text: allParts.map(part => part.text).join(""), parts: allParts, links: allParts.flatMap(part => part.link ?? []), url: topic.html_url, status })
    }
    showDiscussion(saved?.value, saved ? !saved.fresh || refresh ? "Visar sparade svar · kontrollerar Canvas…" : undefined : "Hämtar svar…")

    try {
      const view = await loadResource(key, () => getDiscussionView(selectedCourse.id, topic.id), refresh)
      if (request !== contentRequest.current) return
      showDiscussion(view)
    } catch (error) {
      if (request !== contentRequest.current) return
      const reason = error instanceof Error ? error.message : "Svar kunde inte hämtas."
      if (saved) showDiscussion(saved.value, `Visar sparade svar · uppdatering misslyckades: ${reason}`)
      else setContent({ kind: "discussion", title: topic.title, text: `${message}\n\nSvar kunde inte hämtas: ${reason}`, parts: [...parts, { text: `\n\nSvar kunde inte hämtas: ${reason}` }], links, url: topic.html_url })
    }
  }, [])

  const loadAssignment = useCallback(async (assignment: CanvasAssignment) => {
    contentRequest.current++
    retryContent.current = () => void loadAssignment(assignment)
    setContent(assignmentContent(assignment))
  }, [])

  const loadHome = useCallback(async (selectedCourse: CanvasCourse, homeTab: CanvasTab, refresh = false) => {
    const request = ++contentRequest.current
    retryContent.current = () => void loadHome(selectedCourse, homeTab, true)
    setContentSource("home")
    setFocus("content")
    const infoKey = resourceKey("course-info", String(selectedCourse.id))
    const frontKey = resourceKey("front-page", String(selectedCourse.id))
    const savedInfo = cachedResource<CanvasCourse>(infoKey)
    let hadUsableSnapshot = false

    const showHome = (home: CanvasCourse, checking = false) => {
      if (request !== contentRequest.current) return
      const view = home.default_view ?? home.home_page ?? "wiki"
      setHomeView(view)
      if (view === "modules") {
        hadUsableSnapshot = true
        setContent(null)
        setFocus("modules")
        void loadModules(selectedCourse)
      } else if (view === "assignments") {
        hadUsableSnapshot = true
        setContent(null)
        setFocus("assignments")
        void loadAssignments(selectedCourse, refresh)
      } else if (view === "feed") {
        hadUsableSnapshot = true
        setContent(null)
        setFocus("topics")
        void loadTopics(selectedCourse, true, refresh)
      } else if (view === "syllabus") {
        hadUsableSnapshot = true
        setContent({ ...pageContent({ title: "Kursplan", body: home.syllabus_body }, `/courses/${selectedCourse.id}/assignments/syllabus`), status: checking ? "Visar sparad kursplan · kontrollerar Canvas…" : undefined })
      } else {
        const savedFront = cachedResource<CanvasPage>(frontKey)
        if (savedFront) {
          hadUsableSnapshot = true
          setContent({ ...pageContent(savedFront.value, `/courses/${selectedCourse.id}`), status: checking || !savedFront.fresh ? "Visar sparad startsida · kontrollerar Canvas…" : undefined })
        } else setContent({ kind: "loading", title: homeTab.label })
      }
    }
    if (savedInfo) showHome(savedInfo.value, !savedInfo.fresh || refresh)
    else setContent({ kind: "loading", title: homeTab.label })

    try {
      const home = await loadResource(infoKey, () => getCourseHome(selectedCourse.id), refresh)
      if (request !== contentRequest.current) return
      const view = home.default_view ?? home.home_page ?? "wiki"
      if (view === "modules" || view === "assignments" || view === "feed" || view === "syllabus") {
        showHome(home)
        return
      }
      showHome(home, !cachedResource<CanvasCourse>(infoKey)?.fresh)
      const frontPage = await loadResource(frontKey, () => getFrontPage(selectedCourse.id), refresh)
      if (request !== contentRequest.current) return
      const latest = cachedResource<CanvasPage>(frontKey)
      setContent({ ...pageContent(frontPage, `/courses/${selectedCourse.id}`), status: latest && !latest.fresh ? "Visar sparad startsida · nästa kontroll är tillgänglig om en stund." : undefined })
      setContentSource("home")
      setFocus("content")
    } catch (error) {
      if (request !== contentRequest.current) return
      const message = error instanceof Error ? error.message : "Kunde inte hämta startsidan."
      if (hadUsableSnapshot) {
        setContent(current => current?.kind === "page" ? { ...current, status: `Visar sparad startsida · uppdatering misslyckades: ${message}` } : current)
      } else {
        setContent({ kind: "error", title: homeTab.label, url: homeTab.html_url, message })
        setContentSource("home")
        setFocus("content")
      }
    }
  }, [loadAssignments, loadModules, loadTopics])

  const loadContent = useCallback(async (selectedCourse: CanvasCourse, item: CanvasModuleItem, refresh = false) => {
    const request = ++contentRequest.current
    retryContent.current = () => void loadContent(selectedCourse, item, true)
    const pageUrl = item.type === "Page" ? item.page_url : undefined
    const storedPage = pageUrl ? cachedPage(selectedCourse.id, pageUrl) : undefined
    let savedContent: Content | undefined
    if (storedPage) {
      const cachedContent = pageContent(storedPage.page, item.html_url ?? `/courses/${selectedCourse.id}/pages/${pageUrl}`)
      savedContent = { ...cachedContent, status: !storedPage.fresh || refresh ? "Visar sparad sida · kontrollerar Canvas…" : undefined }
      setContent(savedContent)
    } else {
      setContent({ kind: "loading", title: item.title })
    }

    try {
      if (pageUrl) {
        prefetchNextPages(selectedCourse.id, pageUrl, modules)
        if (!storedPage?.fresh || refresh) {
          const page = await loadPage(selectedCourse.id, pageUrl, refresh)
          if (request !== contentRequest.current) return
          const latest = cachedPage(selectedCourse.id, pageUrl)
          const status = latest && !latest.fresh ? "Visar sparad sida · nästa kontroll är tillgänglig om en stund." : undefined
          setContent({ ...pageContent(page, item.html_url ?? `/courses/${selectedCourse.id}/pages/${pageUrl}`), status })
        }
      } else if (item.type === "Assignment" && item.content_id) {
        const key = resourceKey("assignment", String(selectedCourse.id), String(item.content_id))
        const saved = cachedResource<CanvasAssignment>(key)
        if (saved) {
          savedContent = { ...assignmentContent(saved.value), status: !saved.fresh || refresh ? "Visar sparad uppgift · kontrollerar Canvas…" : undefined }
          setContent(savedContent)
        }
        const assignment = await loadResource(key, () => getAssignment(selectedCourse.id, item.content_id!), refresh)
        if (request !== contentRequest.current) return
        setContent(assignmentContent(assignment))
      } else if (item.type === "Discussion" && item.content_id) {
        const key = resourceKey("discussion-topic", String(selectedCourse.id), String(item.content_id))
        const saved = cachedResource<CanvasDiscussionTopic>(key)
        let activeRequest = request
        if (saved) {
          void loadDiscussion(selectedCourse, saved.value, refresh)
          activeRequest = contentRequest.current
          retryContent.current = () => void loadContent(selectedCourse, item, true)
        }
        const topic = await loadResource(key, () => getDiscussionTopic(selectedCourse.id, item.content_id!), refresh)
        if (activeRequest !== contentRequest.current) return
        if (!saved || topic !== saved.value) {
          void loadDiscussion(selectedCourse, topic, refresh)
          retryContent.current = () => void loadContent(selectedCourse, item, true)
        }
      } else if (item.type === "File" && item.content_id) {
        const key = resourceKey("file", String(item.content_id))
        const saved = cachedResource<CanvasFile>(key)
        if (saved) {
          savedContent = { kind: "file", title: item.title, url: item.html_url, file: saved.value }
          setContent(savedContent)
        }
        const file = await loadResource(key, () => getFile(item.content_id!), refresh)
        if (request !== contentRequest.current) return
        setContent({ kind: "file", title: item.title, url: item.html_url, file })
      } else if (item.type === "ExternalUrl") {
        setContent({ kind: "external", title: item.title, url: item.external_url })
      } else {
        setContent({ kind: "external", title: item.title, url: item.html_url, message: "Det här innehållet visas i Canvas. Öppna det i webbläsaren." })
      }
    } catch (error) {
      if (request !== contentRequest.current) return
      const message = error instanceof Error ? error.message : "Kunde inte hämta innehållet."
      if (storedPage && pageUrl) {
        setContent({ ...pageContent(storedPage.page, item.html_url ?? `/courses/${selectedCourse.id}/pages/${pageUrl}`), status: `Visar sparad sida · uppdatering misslyckades: ${message}` })
      } else if (savedContent) {
        setContent(savedContent.kind === "assignment" ? { ...savedContent, status: `Visar sparad uppgift · uppdatering misslyckades: ${message}` } : savedContent)
      } else {
        setContent({ kind: "error", title: item.title, url: item.html_url, message })
      }
    }
  }, [loadDiscussion, modules])

  const loadStandardTab = useCallback(async (selectedCourse: CanvasCourse, selectedTab: CanvasTab, refresh = false) => {
    const request = ++contentRequest.current
    retryContent.current = () => void loadStandardTab(selectedCourse, selectedTab, true)
    setContentSource("home")
    setFocus("content")
    setLinkIndex(0)
    const url = selectedTab.html_url
    let hasSavedContent = false
    const showText = (text: string, status?: string) => {
      if (request === contentRequest.current) setContent({ kind: "page", title: selectedTab.label, text, parts: [{ text }], links: [], url, status })
    }
    try {
      if (selectedTab.id === "people") {
        const key = resourceKey("people", String(selectedCourse.id))
        const saved = cachedResource<CanvasPerson[]>(key)
        let partial = incompletePeople.current.get(key)
        if (saved) showText(peopleText(saved.value), !saved.fresh || refresh ? "Visar sparade deltagare · kontrollerar Canvas…" : undefined)
        else if (partial) showText(peopleText(partial, false, false), "Listan är ofullständig · försöker hämta resten…")
        else setContent({ kind: "loading", title: selectedTab.label })
        const unsubscribe = saved ? () => {} : subscribeResourceProgress<CanvasPerson[]>(key, (items, hasNext) => {
          partial = items
          incompletePeople.current.delete(key)
          incompletePeople.current.set(key, items)
          while (incompletePeople.current.size > 10) {
            const oldest = incompletePeople.current.keys().next().value
            if (oldest === undefined) break
            incompletePeople.current.delete(oldest)
          }
          if (request !== contentRequest.current) return
          showText(peopleText(items, !hasNext), hasNext ? "Laddar fler deltagare…" : undefined)
        })
        try {
          const people = await loadResource(key, () => listPeople(selectedCourse.id, (items, hasNext) => reportResourceProgress(key, items, hasNext)), refresh)
          incompletePeople.current.delete(key)
          showText(peopleText(people))
        } catch (error) {
          const message = error instanceof Error ? error.message : "Kunde inte hämta alla deltagare."
          if (saved) showText(peopleText(saved.value), `Visar sparade deltagare · uppdatering misslyckades: ${message}`)
          else if (partial) showText(peopleText(partial, false, false), `Listan är ofullständig: ${message} Tryck r för att försöka igen.`)
          else throw error
        } finally {
          unsubscribe()
        }
      } else if (selectedTab.id === "grades") {
        const assignmentsKey = resourceKey("assignments", String(selectedCourse.id))
        const enrollmentsKey = resourceKey("enrollments", String(selectedCourse.id))
        const savedAssignments = cachedResource<CanvasAssignment[]>(assignmentsKey)
        const savedEnrollments = cachedResource<CanvasEnrollment[]>(enrollmentsKey)
        if (savedAssignments && savedEnrollments) {
          hasSavedContent = true
          showText(gradesText(savedAssignments.value, savedEnrollments.value), !savedAssignments.fresh || !savedEnrollments.fresh || refresh ? "Visar sparade resultat · kontrollerar Canvas…" : undefined)
        }
        else setContent({ kind: "loading", title: selectedTab.label })
        const [assignments, enrollments] = await Promise.all([
          loadResource(assignmentsKey, () => listAssignments(selectedCourse.id), refresh),
          loadResource(enrollmentsKey, () => listMyEnrollments(selectedCourse.id), refresh).then(value => ({ value, error: undefined as string | undefined }), error => ({ value: savedEnrollments?.value ?? [], error: `Kursresultatet kunde inte hämtas: ${error instanceof Error ? error.message : "okänt fel"}` })),
        ])
        showText(gradesText(assignments, enrollments.value, enrollments.error), enrollments.error && savedEnrollments ? "Visar sparat kursresultat · uppdatering misslyckades." : undefined)
      } else if (selectedTab.id === "syllabus") {
        const key = resourceKey("course-info", String(selectedCourse.id))
        const saved = cachedResource<CanvasCourse>(key)
        if (saved) {
          hasSavedContent = true
          if (request === contentRequest.current) setContent({ ...pageContent({ title: "Kursöversikt", body: saved.value.syllabus_body }, url), status: !saved.fresh || refresh ? "Visar sparad kursöversikt · kontrollerar Canvas…" : undefined })
        } else setContent({ kind: "loading", title: selectedTab.label })
        const home = await loadResource(key, () => getCourseHome(selectedCourse.id), refresh)
        if (request === contentRequest.current) setContent(pageContent({ title: "Kursöversikt", body: home.syllabus_body }, url))
      } else {
        setContent({ kind: "external", title: selectedTab.label, url, message: "Den här kursfunktionen öppnas i webbläsaren. Där kan Canvas hantera eventuell inloggning och externa verktyg." })
      }
    } catch (error) {
      if (request !== contentRequest.current) return
      const message = error instanceof Error ? error.message : "Kunde inte hämta innehållet."
      if (hasSavedContent) setContent(current => current?.kind === "page" ? { ...current, status: `Visar sparat innehåll · uppdatering misslyckades: ${message}` } : current)
      else setContent({ kind: "error", title: selectedTab.label, url, message })
    }
  }, [])

  const openCourse = useCallback(
    (index: number) => {
      const selectedCourse = courses[index]
      if (!selectedCourse) return

      courseNavigation.current++
      contentRequest.current++
      setHomeView("")
      retryContent.current = null
      setCourse(selectedCourse)
      tabsRef.current = []
      setTabs([])
      setTabIndex(0)
      setTopics([])
      setTopicsStatus("")
      setTopicIndex(0)
      setAssignments([])
      setAssignmentsStatus("")
      setAssignmentIndex(0)
      setLinkIndex(0)
      setFocus("menu")
      setContent(null)
      setCurrentFavorite(null)
      setMenuSelection("tab:home")
      void loadTabs(selectedCourse)
    },
    [courses, loadTabs],
  )

  const openRecentAnnouncement = useCallback((index: number) => {
    const announcement = recentAnnouncements[index]
    if (!announcement) return
    const courseId = announcement.context_code.replace(/^course_/, "")
    const selectedCourseIndex = courses.findIndex((candidate) => String(candidate.id) === courseId)
    if (selectedCourseIndex < 0) return

    const parts = pageBodyParts(announcement.message ?? "", canvasBaseUrl())
    openCourse(selectedCourseIndex)
    contentRequest.current++
    setContentSource("home")
    setCurrentFavorite(null)
    setLinkIndex(0)
    setFocus("content")
    setContent({
      kind: "discussion",
      title: announcement.title,
      text: parts.map((part) => part.text).join(""),
      parts,
      links: parts.flatMap((part) => part.link ?? []),
      url: announcement.html_url,
    })
    if (announcement.read_state === "unread" || (announcement.unread_count ?? 0) > 0) {
      const selectedCourse = courses[selectedCourseIndex]
      if (selectedCourse) void markAnnouncementRead(selectedCourse.id, announcement.id).then(() => {
        readAnnouncements.current.add(resourceKey("announcement-read", announcement.context_code, String(announcement.id)))
        setRecentAnnouncements((items) => items.map((item) => item.context_code === announcement.context_code && item.id === announcement.id
          ? { ...item, read_state: "read", unread_count: 0 }
          : item))
      }, (error) => {
        setStatus(`Kunde inte markera announcement som läst: ${error instanceof Error ? error.message : "okänt fel"}`)
      })
    }
  }, [courses, openCourse, recentAnnouncements])

  const openTopic = useCallback((index: number) => {
    const topic = topics[index]
    if (!course || !topic) return

    setFocus("content")
    setContentSource("topics")
    setCurrentFavorite(null)
    setLinkIndex(0)
    void loadDiscussion(course, topic)
  }, [course, loadDiscussion, topics])

  const openAssignment = useCallback((index: number) => {
    const assignment = assignments[index]
    if (!course || !assignment) return

    setFocus("content")
    setContentSource("assignments")
    setCurrentFavorite(null)
    setLinkIndex(0)
    void loadAssignment(assignment)
    const request = contentRequest.current
    const item: CanvasModuleItem = { id: assignment.id, content_id: assignment.id, title: assignment.name, type: "Assignment", html_url: assignment.html_url }
    retryContent.current = () => void loadContent(course, item, true)
    const key = resourceKey("assignment", String(course.id), String(assignment.id))
    const saved = cachedResource<CanvasAssignment>(key)
    if (saved) setContent({ ...assignmentContent(saved.value), status: saved.fresh ? undefined : "Visar sparad uppgift · kontrollerar Canvas…" })
    void loadResource(key, () => getAssignment(course.id, assignment.id)).then(detail => {
      if (request === contentRequest.current) setContent(assignmentContent(detail))
    }, error => {
      if (request === contentRequest.current) setContent(current => current?.kind === "assignment"
        ? { ...current, status: `Detaljer kunde inte uppdateras: ${error instanceof Error ? error.message : "okänt fel"}` } : current)
    })
  }, [assignments, course, loadAssignment, loadContent])

  useEffect(() => {
    void loadCourses()
  }, [loadCourses])

  useEffect(() => {
    if (course || !courses[courseIndex]) return
    keepItemInView(courseScrollRef.current, `course-card-${courseIndex}`, courseIndex, courses.length)
  }, [course, courseIndex, courses])

  useEffect(() => {
    if (course || startFocus !== "announcements" || !recentAnnouncements[announcementIndex]) return
    keepItemInView(announcementScrollRef.current, `recent-announcement-card-${announcementIndex}`, announcementIndex, recentAnnouncements.length)
  }, [announcementIndex, course, recentAnnouncements, startFocus])

  useEffect(() => {
    if (focus === "topics" && topics[topicIndex]) keepItemInView(topicScrollRef.current, `topic-card-${topicIndex}`, topicIndex, topics.length)
  }, [focus, topicIndex, topics])

  useEffect(() => {
    if (focus === "assignments" && assignments[assignmentIndex]) keepItemInView(assignmentScrollRef.current, `assignment-card-${assignmentIndex}`, assignmentIndex, assignments.length)
  }, [assignmentIndex, assignments, focus])

  useEffect(() => {
    void loadFavoritePages(favoritesFile).then((pages) => {
      setFavorites(pages)
      setFavoritesLoaded(true)
    }, (error) => setFavoriteStatus(`Kunde inte läsa favoriter: ${error instanceof Error ? error.message : "okänt fel"}`))
  }, [favoritesFile])

  const toggleFavorite = useCallback(async (page: FavoritePage) => {
    if (!favoritesLoaded || favoriteSaving.current) return
    favoriteSaving.current = true
    const key = favoriteKey(page)
    const next = favorites.some((page) => favoriteKey(page) === key)
      ? favorites.filter((page) => favoriteKey(page) !== key)
      : [...favorites, page]
    try {
      await saveFavoritePages(next, favoritesFile)
      setFavorites(next)
      setFavoriteStatus("")
      if (!next.some((page) => favoriteKey(page) === key)) setMenuSelection((selection) => selection === `favorite:${key}` ? `tab:${tabs[tabIndex]?.id ?? "home"}` : selection)
    } catch (error) {
      setFavoriteStatus(`Kunde inte spara favoriten: ${error instanceof Error ? error.message : "okänt fel"}`)
    } finally {
      favoriteSaving.current = false
    }
  }, [favorites, favoritesFile, favoritesLoaded, tabIndex, tabs])

  const courseFavorites = useMemo(() => {
    if (!course) return []
    const pages = favorites.filter((page) => page.baseUrl === canvasBaseUrl() && page.courseId === String(course.id))
    const moduleOrder = new Map<string, number>()
    for (let index = 0; index < moduleEntries.length; index++) {
      const pageUrl = moduleEntries[index].item?.page_url
      if (pageUrl && !moduleOrder.has(pageUrl)) moduleOrder.set(pageUrl, index)
    }
    return pages.sort((first, second) =>
      (moduleOrder.get(first.pageUrl) ?? Number.MAX_SAFE_INTEGER) - (moduleOrder.get(second.pageUrl) ?? Number.MAX_SAFE_INTEGER))
  }, [course, favorites, moduleEntries])

  useEffect(() => {
    if (course && favoritesLoaded && courseFavorites.length) void loadModules(course)
  }, [course, courseFavorites.length, favoritesLoaded, loadModules])
  const menuEntries = useMemo(() => courseMenuEntries(tabs, courseFavorites), [courseFavorites, tabs])
  const favoriteKeys = useMemo(() => new Set(courseFavorites.map(favoriteKey)), [courseFavorites])
  const favoriteTarget = useMemo(() => course && focus === "modules"
    ? modulePageFavorite(canvasBaseUrl(), course.id, moduleEntries[moduleIndex]?.item)
    : focus === "content" || focus === "links" ? currentFavorite : null,
    [course, currentFavorite, focus, moduleEntries, moduleIndex])
  const matchingMenuIndex = menuEntries.findIndex((entry) => entry.key === menuSelection)
  const selectedMenuIndex = Math.max(0, matchingMenuIndex >= 0 ? matchingMenuIndex : menuEntries.findIndex((entry) => entry.kind === "tab" && entry.tabIndex === tabIndex))

  const openTab = useCallback((index: number) => {
    if (!course) return
    const entry = menuEntries[index]
    if (!entry) return
    if (entry.kind === "back") {
      courseNavigation.current++
      contentRequest.current++
      retryContent.current = null
      return setCourse(null)
    }
    if (entry.kind === "favorite") {
      setMenuSelection(entry.key)
      setCurrentFavorite(entry.page)
      setContentSource("home")
      setFocus("content")
      setLinkIndex(0)
      void loadContent(course, { id: entry.page.pageUrl, title: entry.page.title, type: "Page", page_url: entry.page.pageUrl })
      return
    }
    if (entry.kind !== "tab") return

    const selectedTab = tabs[entry.tabIndex]
    if (!selectedTab) return

    contentRequest.current++
    setContent(null)
    setCurrentFavorite(null)
    retryContent.current = null
    setTabIndex(entry.tabIndex)
    setMenuSelection(entry.key)
    setTopicIndex(0)
    setAssignmentIndex(0)
    if (selectedTab.id === "home") {
      void loadHome(course, selectedTab)
    } else if (selectedTab.id === "modules") {
      setFocus("modules")
      void loadModules(course)
    } else if (selectedTab.id === "announcements" || selectedTab.id === "discussions") {
      setFocus("topics")
      void loadTopics(course, selectedTab.id === "announcements")
    } else if (selectedTab.id === "assignments") {
      setFocus("assignments")
      void loadAssignments(course)
    } else {
      void loadStandardTab(course, selectedTab)
    }
  }, [course, loadAssignments, loadContent, loadHome, loadModules, loadStandardTab, loadTopics, menuEntries, tabs])

  const openModuleEntry = useCallback((index: number) => {
    const entry = moduleEntries[index]
    if (!course || !entry?.item) return

    setFocus("content")
    setContentSource("modules")
    setCurrentFavorite(modulePageFavorite(canvasBaseUrl(), course.id, entry.item))
    setLinkIndex(0)
    void loadContent(course, entry.item)
  }, [course, loadContent, moduleEntries])

  const moveMenuSelection = useCallback((direction: -1 | 1) => {
    const nextIndex = courseMenuNavigationIndex(menuEntries, selectedMenuIndex + direction, selectedMenuIndex)
    const entry = menuEntries[nextIndex]
    if (entry) setMenuSelection(entry.key)
  }, [menuEntries, selectedMenuIndex])

  const moveModuleSelection = useCallback((direction: -1 | 1) => {
    const nextIndex = moduleNavigationIndex(moduleEntries, moduleIndex + direction, moduleIndex)
    if (moduleEntries[nextIndex]) setModuleIndex(nextIndex)
  }, [moduleEntries, moduleIndex, setModuleIndex])

  const moveModuleHeader = useCallback((direction: -1 | 1) => {
    const nextIndex = moduleHeaderNavigationIndex(moduleEntries, moduleIndex, direction)
    if (nextIndex !== moduleIndex) setModuleIndex(nextIndex)
  }, [moduleEntries, moduleIndex, setModuleIndex])

  useEffect(() => {
    if (course && menuEntries[selectedMenuIndex]) keepItemInView(menuScrollRef.current, `menu-row-${selectedMenuIndex}`, selectedMenuIndex, menuEntries.length)
  }, [course, menuEntries, selectedMenuIndex])

  useEffect(() => {
    if (!course) return
    let cancelPrefetch = () => {}
    const selectedMenuEntry = focus === "menu" ? menuEntries[selectedMenuIndex] : undefined
    const selectedTab = selectedMenuEntry?.kind === "tab" ? tabs[selectedMenuEntry.tabIndex] : undefined
    const delay = selectedTab?.id === "people" ? 350 : 120
    const timer = setTimeout(() => {
      if (focus === "modules") {
        const item = moduleEntries[moduleIndex]?.item
        if (!item) return
        if (item.type === "Page" && item.page_url) {
          cancelPrefetch = selectPageForPrefetch(course.id, item.page_url)
        } else if (item.type === "Assignment" && item.content_id) {
          const key = resourceKey("assignment", String(course.id), String(item.content_id))
          cancelPrefetch = selectResourceForPrefetch(key, () => getAssignment(course.id, item.content_id!))
        } else if (item.type === "Discussion" && item.content_id) {
          const key = resourceKey("discussion-topic", String(course.id), String(item.content_id))
          cancelPrefetch = selectResourceForPrefetch(key, () => getDiscussionTopic(course.id, item.content_id!))
        } else if (item.type === "File" && item.content_id) {
          const key = resourceKey("file", String(item.content_id))
          cancelPrefetch = selectResourceForPrefetch(key, () => getFile(item.content_id!))
        }
        return
      }
      if (selectedMenuEntry?.kind === "favorite") {
        cancelPrefetch = selectPageForPrefetch(course.id, selectedMenuEntry.page.pageUrl)
        return
      }
      if (!selectedTab) return
      const id = String(course.id)
      if (selectedTab.id === "home") {
        const key = resourceKey("home-warm", id)
        cancelPrefetch = selectResourceForPrefetch(key, async () => {
          const infoKey = resourceKey("course-info", id)
          const frontKey = resourceKey("front-page", id)
          try {
            const info = await loadResource(infoKey, () => getCourseHome(course.id))
            const view = info.default_view ?? info.home_page ?? "wiki"
            if (view !== "modules" && view !== "assignments" && view !== "feed" && view !== "syllabus") {
              await loadResource(frontKey, () => getFrontPage(course.id))
            }
          } catch (error) {
            allowExplicitRetryAfterPrefetchFailure(infoKey)
            allowExplicitRetryAfterPrefetchFailure(frontKey)
            throw error
          }
        })
      } else if (selectedTab.id === "modules") {
        const key = resourceKey("modules-warm", id)
        cancelPrefetch = selectResourceForPrefetch(key, () => loadModules(course), 30_000)
      } else if (selectedTab.id === "people") {
        const key = resourceKey("people", id)
        cancelPrefetch = selectResourceForPrefetch(key, () => listPeople(course.id, (items, hasNext) => reportResourceProgress(key, items, hasNext)))
      } else if (selectedTab.id === "assignments") {
        const key = resourceKey("assignments", id)
        cancelPrefetch = selectResourceForPrefetch(key, () => listAssignments(course.id))
      } else if (selectedTab.id === "announcements" || selectedTab.id === "discussions") {
        const announcements = selectedTab.id === "announcements"
        const key = resourceKey(announcements ? "course-announcements" : "discussions", id)
        cancelPrefetch = selectResourceForPrefetch(key, () => listDiscussionTopics(course.id, announcements), announcements ? 60_000 : 5 * 60_000)
      } else if (selectedTab.id === "syllabus") {
        const key = resourceKey("course-info", id)
        cancelPrefetch = selectResourceForPrefetch(key, () => getCourseHome(course.id))
      } else if (selectedTab.id === "grades") {
        const key = resourceKey("grades-warm", id)
        cancelPrefetch = selectResourceForPrefetch(key, async () => {
          const assignmentsKey = resourceKey("assignments", id)
          const enrollmentsKey = resourceKey("enrollments", id)
          try {
            await loadResource(assignmentsKey, () => listAssignments(course.id))
            await loadResource(enrollmentsKey, () => listMyEnrollments(course.id))
          } catch (error) {
            allowExplicitRetryAfterPrefetchFailure(assignmentsKey)
            allowExplicitRetryAfterPrefetchFailure(enrollmentsKey)
            throw error
          }
        })
      }
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelPrefetch()
    }
  }, [course, focus, loadModules, menuEntries, moduleEntries, moduleIndex, selectedMenuIndex, tabs])

  useEffect(() => {
    const entry = moduleEntries[moduleIndex]
    if (!course || focus !== "modules" || !entry) return
    const selection = `${course.id}:${entry.key}`
    if (lastModuleSelection.current === selection && lastModuleViewport.current === moduleScrollRef.current) return
    lastModuleSelection.current = selection
    lastModuleViewport.current = moduleScrollRef.current
    keepItemInView(moduleScrollRef.current, `module-row-${entry.key}`, moduleIndex, moduleEntries.length)
  }, [course, focus, moduleEntries, moduleIndex])

  useEffect(() => {
    if (focus !== "links" || !content || !("parts" in content)) {
      setLinkViewport("")
      return
    }
    const scrollbox = contentScrollRef.current
    const link = scrollbox?.content.findDescendantById(`canvas-link-${linkIndex}`)
    if (!scrollbox || !link) return setLinkViewport("länken layoutas…")

    const outside = link.y < scrollbox.viewport.y || link.y + link.height > scrollbox.viewport.y + scrollbox.viewport.height
    if (outside) scrollbox.scrollChildIntoView(link.id)
    setLinkViewport(outside ? "UTANFÖR vyn → flyttad" : "synlig")
  }, [content, focus, linkIndex])

  useBindings(
    () => ({
      commands: [
        { name: "app.refresh", run: () => content && retryContent.current ? retryContent.current() : course && tabs[tabIndex]?.id === "home" ? loadHome(course, tabs[tabIndex], true) : course && tabs[tabIndex]?.id === "modules" ? loadModules(course) : course && (tabs[tabIndex]?.id === "announcements" || tabs[tabIndex]?.id === "discussions") ? loadTopics(course, tabs[tabIndex]?.id === "announcements", true) : course && tabs[tabIndex]?.id === "assignments" ? loadAssignments(course, true) : course ? loadTabs(course, true) : loadCourses(true) },
        {
          name: "app.back",
          run: () => {
            if (course && focus === "links") {
              setFocus("content")
            } else if (course && focus === "content") {
              contentRequest.current++
              retryContent.current = null
              setContent(null)
              setFocus(contentSource === "home" ? "menu" : contentSource)
              if (menuSelection.startsWith("favorite:")) setMenuSelection(`tab:${tabs[tabIndex]?.id ?? "home"}`)
            } else if (course && (focus === "modules" || focus === "topics" || focus === "assignments")) {
              contentRequest.current++
              retryContent.current = null
              setFocus("menu")
            } else {
              courseNavigation.current++
              contentRequest.current++
              retryContent.current = null
              setCourse(null)
            }
          },
        },
        { name: "app.links", run: () => {
          if ((content?.kind !== "page" && content?.kind !== "discussion" && content?.kind !== "assignment") || !content.links.length) return
          if (focus === "links") return setFocus("content")
          setLinkIndex((index) => Math.min(index, content.links.length - 1))
          setFocus("links")
        } },
        { name: "app.previousLink", run: () => focus === "links" && setLinkIndex((index) => Math.max(0, index - 1)) },
        { name: "app.nextLink", run: () => focus === "links" && content && "links" in content && setLinkIndex((index) => Math.min(content.links.length - 1, index + 1)) },
        { name: "app.openLink", run: () => {
          if (focus !== "links" || !content || !("links" in content)) return
          const link = content.links[linkIndex]
          if (!link) return
          try {
            openInBrowser(link.url)
          } catch (error) {
            setContent({ kind: "error", title: content.title, message: error instanceof Error ? error.message : "Kunde inte öppna länken." })
          }
        } },
        { name: "app.openCanvas", run: () => {
          if (!content || !("url" in content) || !content.url) return
          try {
            openInBrowser(content.url)
          } catch (error) {
            setContent({ kind: "error", title: content.title, message: error instanceof Error ? error.message : "Kunde inte öppna Canvas." })
          }
        } },
        { name: "app.favorite", run: () => { if (favoriteTarget) void toggleFavorite(favoriteTarget) } },
        { name: "app.toggleStartFocus", run: () => { if (!course) setStartFocus((current) => current === "courses" ? "announcements" : "courses") } },
        { name: "app.previousCourse", run: () => !course && startFocus === "courses" && setCourseIndex((index) => Math.max(0, index - 1)) },
        { name: "app.nextCourse", run: () => !course && startFocus === "courses" && setCourseIndex((index) => Math.min(Math.max(0, courses.length - 1), index + 1)) },
        { name: "app.openCourse", run: () => { if (!course && startFocus === "courses") openCourse(courseIndex) } },
        { name: "app.previousRecentAnnouncement", run: () => !course && startFocus === "announcements" && setAnnouncementIndex((index) => Math.max(0, index - 1)) },
        { name: "app.nextRecentAnnouncement", run: () => !course && startFocus === "announcements" && setAnnouncementIndex((index) => Math.min(Math.max(0, recentAnnouncements.length - 1), index + 1)) },
        { name: "app.openRecentAnnouncement", run: () => { if (!course && startFocus === "announcements") openRecentAnnouncement(announcementIndex) } },
        { name: "app.previousTopic", run: () => focus === "topics" && setTopicIndex((index) => Math.max(0, index - 1)) },
        { name: "app.nextTopic", run: () => focus === "topics" && setTopicIndex((index) => Math.min(Math.max(0, topics.length - 1), index + 1)) },
        { name: "app.openTopic", run: () => { if (focus === "topics") openTopic(topicIndex) } },
        { name: "app.previousAssignment", run: () => focus === "assignments" && setAssignmentIndex((index) => Math.max(0, index - 1)) },
        { name: "app.nextAssignment", run: () => focus === "assignments" && setAssignmentIndex((index) => Math.min(Math.max(0, assignments.length - 1), index + 1)) },
        { name: "app.openAssignment", run: () => { if (focus === "assignments") openAssignment(assignmentIndex) } },
        { name: "app.previousMenuEntry", run: () => focus === "menu" && moveMenuSelection(-1) },
        { name: "app.nextMenuEntry", run: () => focus === "menu" && moveMenuSelection(1) },
        { name: "app.openMenuEntry", run: () => { if (focus === "menu") openTab(selectedMenuIndex) } },
        { name: "app.previousModuleEntry", run: () => focus === "modules" && moveModuleSelection(-1) },
        { name: "app.nextModuleEntry", run: () => focus === "modules" && moveModuleSelection(1) },
        { name: "app.previousModuleHeader", run: () => focus === "modules" && moveModuleHeader(-1) },
        { name: "app.nextModuleHeader", run: () => focus === "modules" && moveModuleHeader(1) },
        { name: "app.openModuleEntry", run: () => { if (focus === "modules") openModuleEntry(moduleIndex) } },
        { name: "app.quit", run: () => renderer.destroy() },
      ],
      bindings: [
        { key: "r", cmd: "app.refresh" },
        { key: "left", cmd: "app.back" },
        { key: "escape", cmd: "app.back" },
        { key: "q", cmd: "app.quit" },
        { key: "l", cmd: "app.links" },
        { key: "o", cmd: "app.openCanvas" },
        { key: "f", cmd: "app.favorite" },
        ...(!course ? [{ key: "tab", cmd: "app.toggleStartFocus" }] : []),
        ...(!course && startFocus === "courses" ? [
          { key: "up", cmd: "app.previousCourse" },
          { key: "k", cmd: "app.previousCourse" },
          { key: "down", cmd: "app.nextCourse" },
          { key: "j", cmd: "app.nextCourse" },
          { key: "right", cmd: "app.openCourse" },
          { key: "return", cmd: "app.openCourse" },
        ] : []),
        ...(!course && startFocus === "announcements" ? [
          { key: "up", cmd: "app.previousRecentAnnouncement" },
          { key: "k", cmd: "app.previousRecentAnnouncement" },
          { key: "down", cmd: "app.nextRecentAnnouncement" },
          { key: "j", cmd: "app.nextRecentAnnouncement" },
          { key: "right", cmd: "app.openRecentAnnouncement" },
          { key: "return", cmd: "app.openRecentAnnouncement" },
        ] : []),
        ...(course && focus === "topics" ? [
          { key: "up", cmd: "app.previousTopic" },
          { key: "k", cmd: "app.previousTopic" },
          { key: "down", cmd: "app.nextTopic" },
          { key: "j", cmd: "app.nextTopic" },
          { key: "right", cmd: "app.openTopic" },
          { key: "return", cmd: "app.openTopic" },
        ] : []),
        ...(course && focus === "assignments" ? [
          { key: "up", cmd: "app.previousAssignment" },
          { key: "k", cmd: "app.previousAssignment" },
          { key: "down", cmd: "app.nextAssignment" },
          { key: "j", cmd: "app.nextAssignment" },
          { key: "right", cmd: "app.openAssignment" },
          { key: "return", cmd: "app.openAssignment" },
        ] : []),
        ...(course && focus === "menu" ? [
          { key: "up", cmd: "app.previousMenuEntry" },
          { key: "k", cmd: "app.previousMenuEntry" },
          { key: "down", cmd: "app.nextMenuEntry" },
          { key: "j", cmd: "app.nextMenuEntry" },
          { key: "right", cmd: "app.openMenuEntry" },
          { key: "return", cmd: "app.openMenuEntry" },
        ] : []),
        ...(course && focus === "modules" ? [
          { key: "shift+up", cmd: "app.previousModuleHeader" },
          { key: "shift+down", cmd: "app.nextModuleHeader" },
          { key: "up", cmd: "app.previousModuleEntry" },
          { key: "k", cmd: "app.previousModuleEntry" },
          { key: "down", cmd: "app.nextModuleEntry" },
          { key: "j", cmd: "app.nextModuleEntry" },
          { key: "right", cmd: "app.openModuleEntry" },
          { key: "return", cmd: "app.openModuleEntry" },
        ] : []),
        ...(course && focus === "links" ? [
          { key: "up", cmd: "app.previousLink" },
          { key: "k", cmd: "app.previousLink" },
          { key: "down", cmd: "app.nextLink" },
          { key: "j", cmd: "app.nextLink" },
          { key: "right", cmd: "app.openLink" },
          { key: "return", cmd: "app.openLink" },
        ] : []),
      ],
    }),
    [announcementIndex, assignments.length, assignmentIndex, content, contentSource, course, courseIndex, courses.length, currentFavorite, favoriteTarget, focus, linkIndex, loadAssignments, loadCourses, loadHome, loadModules, loadTabs, loadTopics, menuSelection, moduleIndex, moveMenuSelection, moveModuleHeader, moveModuleSelection, openAssignment, openCourse, openModuleEntry, openRecentAnnouncement, openTab, openTopic, recentAnnouncements.length, selectedMenuIndex, startFocus, tabIndex, tabs, toggleFavorite, topicIndex, topics.length],
  )

  if (course) {
    const tab = tabs[tabIndex]
    const isFavorite = favoriteTarget && favoriteKeys.has(favoriteKey(favoriteTarget))
    const viewId = tab?.id === "home" ? (homeView === "feed" ? "announcements" : homeView) : tab?.id

    let contentPanel: ReactNode = null
    let footerText = "↑/↓: navigera · →/Enter: öppna · ←/Esc: tillbaka · q: avsluta"
    if (focus === "modules") footerText = "↑/↓: navigera · Shift+↑/↓: föregående/nästa modul · →/Enter: öppna · ←/Esc: tillbaka · q: avsluta"
    if (content) {
      const fileIsPdf = content.kind === "file" && (content.file["content-type"] === "application/pdf" || content.file.filename.toLowerCase().endsWith(".pdf"))
      const readableContent = content.kind === "page" || content.kind === "discussion" || content.kind === "assignment"
      const contentLinks = readableContent ? content.links : []
      footerText = focus === "links" ? `↑/↓: välj länk (${linkIndex + 1}/${contentLinks.length}) · ${linkViewport} · →/Enter: öppna · l/←/Esc: lämna länkläge` : readableContent && contentLinks.length ? `↑/↓ eller mushjul: läs · l: länkläge (${contentLinks.length})${"url" in content && content.url ? " · o: öppna i Canvas" : ""} · ←/Esc: tillbaka` : "url" in content && content.url ? "↑/↓ eller mushjul: läs · o: öppna i Canvas · ←/Esc: tillbaka" : "↑/↓ eller mushjul: läs · ←/Esc: tillbaka · q: avsluta"
      const formatPart = (part: PageTextPart, text: string, selected = false): ReactNode => {
        let value: ReactNode = text
        if (part.bold) value = <b>{value}</b>
        if (part.italic) value = <i>{value}</i>
        if (part.underline) value = <u>{value}</u>
        if (part.code) value = <span fg={selected && part.link ? theme.selectedLinkText : theme.code}>{value}</span>
        if (part.heading) value = <span fg={selected && part.link ? theme.selectedLinkText : part.heading <= 2 ? theme.heading : theme.accent}>{value}</span>
        if (part.link) value = <a href={part.link.url} fg={selected ? theme.selectedLinkText : theme.accent} bg={selected ? theme.selectedLinkBackground : undefined}><u>{value}</u></a>
        return value
      }
      const inlineText = readableContent && focus !== "links" && content.parts.map((part, index) => <span key={index}>{formatPart(part, part.text)}</span>)
      let linkModeIndex = 0
      const linkModeText = []
      if (readableContent && focus === "links") for (let index = 0; index < content.parts.length; index++) {
        let part = content.parts[index]
        if (!part) continue
        let leading = ""
        let leadingPart = part
        if (!part.link && content.parts[index + 1]?.link) {
          const lineBreak = part.text.lastIndexOf("\n")
          if (lineBreak >= 0) {
            const prefix = part.text.slice(0, lineBreak)
            if (prefix) linkModeText.push(<text key={`${index}-prefix`} fg={theme.text} wrapMode="word" style={{ marginTop: linkModeText.length ? -1 : 0 }}>{formatPart(part, prefix)}</text>)
            leading = part.text.slice(lineBreak)
          } else {
            leading = part.text
          }
          part = content.parts[++index]
        }
        if (!part.link) {
          if (part.text) linkModeText.push(<text key={index} fg={theme.text} wrapMode="word" style={{ marginTop: linkModeText.length ? -1 : 0 }}>{formatPart(part, part.text)}</text>)
          continue
        }
        const currentIndex = linkModeIndex++
        const following = content.parts[index + 1]
        const trailing = following && !following.link ? following : undefined
        if (trailing) index++
        linkModeText.push(
          <text key={index} id={`canvas-link-${currentIndex}`} fg={theme.text} wrapMode="word" style={{ marginTop: linkModeText.length ? -1 : 0 }}>
            {leading ? formatPart(leadingPart, leading) : null}{formatPart(part, part.text, currentIndex === linkIndex)}{trailing ? formatPart(trailing, trailing.text) : null}
          </text>,
        )
      }
      const openLink = (url: string) => {
        try {
          openInBrowser(url)
        } catch (error) {
          setContent({ kind: "error", title: content.title, message: error instanceof Error ? error.message : "Kunde inte öppna länken." })
        }
      }
      const openPdf = async (file: CanvasFile) => {
        await cleanPdfCache()
        const path = cachedPdfPath(file)
        try {
          await access(path)
        } catch {
          setContent({ kind: "loading", title: content.title })
          await downloadFile(file, path)
          setContent({ kind: "file", title: content.title, file, url: "url" in content ? content.url : undefined })
        }
        await utimes(path, new Date(), new Date())
        openInOkular(path)
      }

      contentPanel = (
        <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
            {readableContent ? (
              <>
                {"status" in content && content.status ? <StatusLine text={content.status} /> : null}
                <scrollbox scrollbarOptions={scrollbarOptions} ref={contentScrollRef} focused style={{ flexGrow: 1, flexShrink: 1 }}>
                  {focus === "links" ? <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}>{linkModeText}</box> : <text ref={contentTextRef} fg={theme.text} wrapMode="word">{content.parts.length ? inlineText : content.text || "Sidan saknar textinnehåll."}</text>}
                </scrollbox>
              </>
            ) : content.kind === "loading" ? (
              <text fg={theme.muted}>Laddar innehåll…</text>
            ) : content.kind === "file" ? (
              fileIsPdf ? (
                <select focused options={[{ name: "Öppna i Okular", description: "Hämtas en gång och sparas lokalt" }]} onSelect={() => void openPdf(content.file).catch((error) => setContent({ kind: "error", title: content.title, message: error instanceof Error ? error.message : "Kunde inte öppna PDF:en." }))} keyBindings={selectKeyBindings} {...selectTheme(theme, true)} style={{ flexGrow: 1 }} />
              ) : <text fg={theme.muted} wrapMode="word">{`Fil: ${content.file.display_name} (${content.file["content-type"] ?? content.file.mime_class ?? "okänd typ"}).${content.url ? " Öppna filen i Canvas med o." : " Ingen webblänk är tillgänglig."}`}</text>
            ) : content.kind === "external" ? (
              content.url ? (
                <box style={{ flexDirection: "column", width: "100%", flexGrow: 1, flexShrink: 1 }}>
                  <text fg={theme.muted} wrapMode="word" style={{ flexShrink: 0, marginBottom: 1 }}>{content.message ?? "Innehållet finns på en extern webbsida."}</text>
                  <select focused options={[{ name: "Öppna i standardwebbläsaren", description: "→ / Enter" }]} onSelect={() => openLink(content.url!)} keyBindings={selectKeyBindings} {...selectTheme(theme, true)} style={{ flexGrow: 1 }} />
                </box>
              ) : <text fg={theme.muted}>Extern länk saknar URL.</text>
            ) : (
              <text fg={theme.error} wrapMode="word">{`${content.message}\n\nTryck r för att försöka igen.${content.url ? " Öppna i Canvas med o." : ""}`}</text>
            )}
        </box>
      )
    }

    return (
      <box title="Canvas CLI" titleColor={theme.accent} style={{ border: true, borderColor: theme.border, borderStyle: "rounded", flexDirection: "column", height: "70%", padding: 1 }}>
        <box style={{ width: "100%", height: 1, flexShrink: 0, justifyContent: "center", alignItems: "center", overflow: "hidden", marginTop: 1 }}>
          <text fg={theme.heading}><b>{course.name}</b></text>
        </box>
        <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden", gap: 1, marginTop: 1 }}>
          <box title="Kursmeny" titleColor={focus === "menu" ? theme.accent : theme.muted} style={{ border: true, borderColor: focus === "menu" ? theme.accent : theme.border, width: 28, flexShrink: 0 }}>
            <scrollbox scrollbarOptions={scrollbarOptions}
              key={`${course.id}-${tabs.length}-${courseFavorites.length}`}
              ref={menuScrollRef}
              style={{ height: "100%" }}
            >
              {menuEntries.map((entry, index) => (
                <CompactOptionRow
                  key={entry.key}
                  id={`menu-row-${index}`}
                  name={sidebarOptionName(entry.name, index === selectedMenuIndex)}
                  selected={index === selectedMenuIndex}
                  active={focus === "menu"}
                  separator={entry.kind === "heading" || entry.kind === "separator"}
                />
              ))}
            </scrollbox>
          </box>
          <box title={content?.title ?? tab?.label ?? "Kursmeny"} titleColor={theme.accent} style={{ border: true, borderColor: theme.border, flexDirection: "column", flexGrow: 1, flexShrink: 1, overflow: "hidden", padding: 1 }}>
            {content ? contentPanel : viewId === "modules" ? (
              <>
                <StatusLine text={modulesStatus} />
                <scrollbox id="module-list" scrollbarOptions={scrollbarOptions} ref={moduleScrollRef} style={{ flexGrow: 1, flexShrink: 1 }}>
                  {moduleEntries.map((entry, index) => (
                    <CompactOptionRow
                      key={entry.key}
                      id={`module-row-${entry.key}`}
                      name={entry.name + (entry.item?.type === "Page" && entry.item.page_url && favoriteKeys.has(favoriteKey({ baseUrl: canvasBaseUrl(), courseId: String(course.id), pageUrl: entry.item.page_url })) ? " ★" : "")}
                      selected={focus === "modules" && index === moduleIndex}
                      active={focus === "modules"}
                      separator={entry.separator}
                    />
                  ))}
                </scrollbox>
              </>
            ) : viewId === "announcements" || viewId === "discussions" ? (
              <>
                <StatusLine text={topicsStatus} />
                <scrollbox scrollbarOptions={scrollbarOptions} ref={topicScrollRef} style={{ flexGrow: 1, flexShrink: 1, paddingX: 1 }}>
                  {topics.map((topic, index) => (
                    <ThickOptionCard
                      key={topic.id}
                      id={`topic-card-${index}`}
                      title={topic.title}
                      description={topicDescription(topic)}
                      selected={focus === "topics" && index === topicIndex}
                      active={focus === "topics"}
                    />
                  ))}
                </scrollbox>
              </>
            ) : viewId === "assignments" ? (
              <>
                <StatusLine text={assignmentsStatus} />
                <scrollbox scrollbarOptions={scrollbarOptions} ref={assignmentScrollRef} style={{ flexGrow: 1, flexShrink: 1, paddingX: 1 }}>
                  {assignments.map((assignment, index) => (
                    <ThickOptionCard
                      key={assignment.id}
                      id={`assignment-card-${index}`}
                      title={assignment.name}
                      description={assignmentDescription(assignment)}
                      selected={focus === "assignments" && index === assignmentIndex}
                      active={focus === "assignments"}
                    />
                  ))}
                </scrollbox>
              </>
            ) : (
              <StatusLine text={tabStatus} />
            )}
          </box>
        </box>
        <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
          <text fg={theme.muted} wrapMode="word" style={{ flexShrink: 0 }}>{footerText}</text>
          <text fg={favoriteStatus ? theme.error : theme.muted} wrapMode="word" style={{ flexShrink: 0 }}>
            {favoriteStatus || (favoriteTarget && favoritesLoaded
              ? `f: ${isFavorite ? "ta bort favorit" : "favoritmarkera sidan"}`
              : "Favoriter: välj en kurssida i Moduler och tryck f.")}
          </text>
        </box>
      </box>
    )
  }

  return (
    <box title="Canvas CLI" titleColor={theme.accent} style={{ border: true, borderColor: theme.border, borderStyle: "rounded", flexDirection: "column", height: "80%", padding: 1 }}>
      <StatusLine text={status} />
      <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden", gap: 1, marginTop: 1 }}>
        <box title="Favoritkurser" titleColor={startFocus === "courses" ? theme.accent : theme.muted} style={{ border: true, borderColor: startFocus === "courses" ? theme.accent : theme.border, width: "55%", flexShrink: 0, overflow: "hidden" }}>
          <scrollbox scrollbarOptions={scrollbarOptions} ref={courseScrollRef} style={{ height: "100%", paddingX: 1 }}>
            {courses.map((listedCourse, index) => {
              const selected = index === courseIndex
              return (
                <ThickOptionCard
                  key={listedCourse.id}
                  id={`course-card-${index}`}
                  title={listedCourse.name}
                  description={listedCourse.course_code}
                  selected={startFocus === "courses" && selected}
                  active={startFocus === "courses"}
                />
              )
            })}
          </scrollbox>
        </box>
        <box title="Recent announcements" titleColor={startFocus === "announcements" ? theme.accent : theme.muted} style={{ border: true, borderColor: startFocus === "announcements" ? theme.accent : theme.border, flexDirection: "column", flexGrow: 1, flexShrink: 1, overflow: "hidden", paddingX: 1 }}>
          {recentAnnouncements.length ? (
            <scrollbox scrollbarOptions={scrollbarOptions} ref={announcementScrollRef} style={{ flexGrow: 1, flexShrink: 1 }}>
              {recentAnnouncements.map((announcement, index) => (
                <ThickOptionCard
                  key={`${announcement.context_code}-${announcement.id}`}
                  id={`recent-announcement-card-${index}`}
                  title={`${announcement.read_state === "unread" || (announcement.unread_count ?? 0) > 0 ? "●" : "○"} ${announcement.title}`}
                  description={announcementDescription(announcement, courses)}
                  selected={startFocus === "announcements" && index === announcementIndex}
                  active={startFocus === "announcements"}
                />
              ))}
            </scrollbox>
          ) : <text fg={theme.muted} wrapMode="word">{announcementStatus}</text>}
          <text fg={theme.muted} style={{ height: 1, flexShrink: 0 }}>● oläst · ○ läst</text>
        </box>
      </box>
      <text fg={theme.muted} style={{ flexShrink: 0, marginTop: 1 }}>Tab: byt sektion · ↑/↓: navigera · →/Enter: öppna · r: ladda om · q: avsluta</text>
    </box>
  )
}
