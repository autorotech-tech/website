export function textToMarkdown(raw, title = "Document") {
  const heading = String(title || "Document").replace(/\s+/g, " ").trim() || "Document"
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n")
  const out = [`# ${heading}`, ""]
  let para = []

  const flushPara = () => {
    if (!para.length) return
    out.push(para.join(" "))
    out.push("")
    para = []
  }

  for (const line of lines) {
    const t = line.replace(/\s+/g, " ").trim()
    if (!t) {
      flushPara()
      continue
    }
    const letters = t.replace(/[^A-Za-zА-Яа-яЁё]/g, "")
    const isHeading =
      t.length <= 90 &&
      !/[.!?]$/.test(t) &&
      letters.length >= 3 &&
      letters === letters.toUpperCase()
    if (isHeading) {
      flushPara()
      out.push(`## ${t}`)
      out.push("")
      continue
    }
    para.push(t)
  }
  flushPara()
  return `${out.join("\n").trim()}\n`
}
