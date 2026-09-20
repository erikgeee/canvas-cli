import { parseFragment, type DefaultTreeAdapterTypes } from "parse5"

export type PageLink = {
  label: string
  url: string
}

export type PageTextPart = {
  text: string
  link?: PageLink
  bold?: boolean
  italic?: boolean
  underline?: boolean
  heading?: number
  code?: boolean
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>\s*<(?:td|th)\b[^>]*>/gi, " | ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot);/gi, (entity) => decodeEntities(entity))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function pageBodyToText(html: string) {
  return htmlToText(html.replace(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, "$3 ($2)"))
}

export function pageBodyParts(html: string, baseUrl: string): PageTextPart[] {
  const parts: PageTextPart[] = []
  type Style = Omit<PageTextPart, "text" | "link">
  const lists: { ordered: boolean; next: number }[] = []
  const lastText = () => parts.at(-1)?.text ?? ""
  const write = (raw: string, style: Style = {}, link?: PageLink) => {
    let value = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ")
    if (!parts.length || lastText().endsWith("\n")) value = value.trimStart()
    if (!value) return
    const previous = parts.at(-1)
    if (previous && previous.bold === style.bold && previous.italic === style.italic && previous.underline === style.underline && previous.heading === style.heading && previous.code === style.code && previous.link?.url === link?.url) previous.text += value
    else parts.push({ text: value, ...style, ...(link ? { link } : {}) })
  }
  const lineBreak = (count: number) => {
    while (parts.length && /^[ \t]*$/.test(lastText())) parts.pop()
    if (!parts.length) return
    parts[parts.length - 1]!.text = lastText().replace(/[ \t]+$/, "")
    const trailing = lastText().match(/\n*$/)?.[0].length ?? 0
    if (trailing < count) parts.push({ text: "\n".repeat(count - trailing) })
  }
  const attribute = (node: DefaultTreeAdapterTypes.Element, name: string) => node.attrs.find((attr) => attr.name === name)?.value
  const plainText = (node: DefaultTreeAdapterTypes.ChildNode): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(plainText).join("") : ""
  const visit = (node: DefaultTreeAdapterTypes.ChildNode, style: Style = {}) => {
    if ("value" in node) return write(node.value, style)
    if (!("tagName" in node)) return
    const tag = node.tagName
    if (["script", "style", "template", "noscript"].includes(tag)) return
    if (tag === "br") return lineBreak(1)
    if (tag === "img") return write(attribute(node, "alt") ? `[Bild: ${attribute(node, "alt")}]` : "[Bild — öppna sidan i Canvas med o.]", style)
    if (["iframe", "video", "audio", "object"].includes(tag)) return write("[Inbäddat media — öppna sidan i Canvas med o.]", style)
    if (tag === "a") {
      const label = plainText(node).replace(/\s+/g, " ").trim()
      const href = attribute(node, "href")
      if (href) {
        try {
          const url = new URL(href, baseUrl)
          if (url.protocol === "http:" || url.protocol === "https:") {
            const link = { label, url: url.href }
            write(label || url.href, style, link)
            return
          }
        } catch {}
      }
      return write(label, style)
    }

    const heading = /^h([1-6])$/.exec(tag)?.[1]
    const inlineStyle = attribute(node, "style") ?? ""
    const nextStyle: Style = {
      ...style,
      ...(heading ? { heading: Number(heading), bold: true } : {}),
      ...(["strong", "b"].includes(tag) || /(?:^|;)\s*font-weight\s*:\s*(?:bold|[6-9]00)/i.test(inlineStyle) ? { bold: true } : {}),
      ...(["em", "i"].includes(tag) || /(?:^|;)\s*font-style\s*:\s*italic/i.test(inlineStyle) ? { italic: true } : {}),
      ...(tag === "u" || /(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*underline/i.test(inlineStyle) ? { underline: true } : {}),
      ...(["code", "pre"].includes(tag) ? { code: true } : {}),
    }
    const paragraph = tag === "p" || tag === "blockquote" || Boolean(heading) || tag === "pre"
    if (paragraph) lineBreak(2)
    else if (["div", "ul", "ol", "table", "tr", "li"].includes(tag)) lineBreak(1)
    if (tag === "ul" || tag === "ol") lists.push({ ordered: tag === "ol", next: Number(attribute(node, "start")) || 1 })
    if (tag === "li") {
      const list = lists.at(-1)
      write(`${"  ".repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${list.next++}.` : "•"} `)
    }
    let cell = 0
    for (const child of node.childNodes) {
      if (tag === "tr" && "tagName" in child && (child.tagName === "td" || child.tagName === "th")) {
        if (cell++) write(" | ")
      }
      visit(child, nextStyle)
    }
    if (tag === "ul" || tag === "ol") lists.pop()
    if (paragraph) lineBreak(2)
    else if (["div", "ul", "ol", "table", "tr", "li"].includes(tag)) lineBreak(1)
  }
  for (const child of parseFragment(html).childNodes) visit(child)
  while (parts.length && !parts.at(-1)?.text.trim()) parts.pop()
  if (parts.length) parts[parts.length - 1]!.text = parts[parts.length - 1]!.text.trimEnd()
  return parts
}

export function pageLinks(html: string, baseUrl: string) {
  return pageBodyParts(html, baseUrl).flatMap((part) => part.link ?? [])
}

export function discussionEntriesToParts(entries: CanvasDiscussionEntry[], participants: CanvasDiscussionView["participants"], baseUrl: string, level = 0): PageTextPart[] {
  const names = new Map(participants.map((participant) => [String(participant.id), participant.display_name]))
  return entries.flatMap((entry, index) => {
    const prefix = "  ".repeat(level)
    const author = entry.user_id === undefined ? "Okänd avsändare" : names.get(String(entry.user_id)) ?? "Okänd avsändare"
    const body = pageBodyParts(entry.message ?? "", baseUrl)
    const indentedBody = (body.length ? body : [{ text: "Meddelandet saknar text." }]).map((part, partIndex) => ({ ...part, text: `${partIndex ? "" : prefix}${part.text.replace(/\n/g, `\n${prefix}`)}` }))
    const replies = entry.replies?.length ? discussionEntriesToParts(entry.replies, participants, baseUrl, level + 1) : []
    return [
      ...(index ? [{ text: "\n\n" }] : []),
      { text: `${prefix}${author}:\n`, bold: true },
      ...indentedBody,
      ...(replies.length ? [{ text: "\n\n" }, ...replies] : []),
    ]
  })
}

export function discussionEntriesToText(entries: CanvasDiscussionEntry[], participants: CanvasDiscussionView["participants"], level = 0): string {
  const names = new Map(participants.map((participant) => [String(participant.id), participant.display_name]))
  const format = (entry: CanvasDiscussionEntry, depth: number): string => {
    const prefix = "  ".repeat(depth)
    const author = entry.user_id === undefined ? "Okänd avsändare" : names.get(String(entry.user_id)) ?? "Okänd avsändare"
    const message = pageBodyToText(entry.message ?? "") || "Meddelandet saknar text."
    const replies = entry.replies?.map((reply) => format(reply, depth + 1)).join("\n\n")
    return `${prefix}${author}:\n${prefix}${message.replace(/\n/g, `\n${prefix}`)}${replies ? `\n\n${replies}` : ""}`
  }

  return entries.map((entry) => format(entry, level)).join("\n\n")
}
import type { CanvasDiscussionEntry, CanvasDiscussionView } from "./canvas.js"
