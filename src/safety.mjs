import DOMPurify from 'dompurify'

const TAGS = ['a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'del', 'div', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul']
const ATTRS = ['href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height', 'colspan', 'rowspan', 'span', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'target', 'rel', 'color', 'face', 'size', 'start', 'type']
const STYLES = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-decoration', 'text-decoration-line', 'vertical-align', 'line-height', 'margin-left', 'margin-right', 'width', 'height', 'max-width', 'border', 'border-width', 'border-color', 'border-style', 'border-collapse', 'padding', 'float', 'display'])

export function ensureHTMLSize(value) {
  if (new TextEncoder().encode(String(value)).byteLength > 2 * 1024 * 1024) throw new Error('本文は2 MB以下にしてください。')
}

export function safeLink(value) {
  let text = String(value).trim()
  if (!text || /[\x00-\x20\x7f\\]/.test(text) || text.startsWith('//')) throw new Error('リンク先を確認してください。')
  if (/^www\./i.test(text)) text = `https://${text}`
  const url = new URL(text, window.location.href)
  if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) throw new Error('リンク先を確認してください。')
  return text
}

export function safeImageURL(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//') || /[\s\\\x00-\x1f\x7f]/.test(value)) throw new Error('画像の保存先を確認できませんでした。')
  const url = new URL(value, window.location.href)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('画像の保存先を確認できませんでした。')
  return value
}

export function cleanHTML(value) {
  const clean = DOMPurify.sanitize(String(value), { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false })
  const template = document.createElement('template'); template.innerHTML = clean
  for (const element of template.content.querySelectorAll('*')) {
    for (const name of [...element.classList]) if (/^(df-editor(?:-|$)|rte-)/.test(name)) element.classList.remove(name)
    if (!element.className) element.removeAttribute('class')
    if (element.hasAttribute('href')) {
      try { element.setAttribute('href', safeLink(element.getAttribute('href'))) } catch (_) { element.removeAttribute('href') }
    }
    if (element.tagName === 'A') {
      if (element.target === '_blank') element.rel = 'noopener noreferrer'
      else { element.removeAttribute('target'); element.removeAttribute('rel') }
    }
    if (element.tagName === 'IMG') {
      try { safeImageURL(element.getAttribute('src')) } catch (_) { element.remove(); continue }
    }
    if (element.hasAttribute('style')) {
      for (const property of Array.from({ length: element.style.length }, (_, index) => element.style.item(index))) {
        const value = element.style.getPropertyValue(property)
        if (!STYLES.has(property) || /url\s*\(|expression|javascript|data:|@|\\|var\s*\(|image-set/i.test(value)) element.style.removeProperty(property)
      }
      if (!element.style.cssText) element.removeAttribute('style')
    }
    for (const name of ['colspan', 'rowspan']) {
      if (element.hasAttribute(name)) element.setAttribute(name, String(Math.max(1, Math.min(100, parseInt(element.getAttribute(name), 10) || 1))))
    }
  }
  return template.innerHTML
}

export function createDraftStore(storage, key, original, { recoverPosted = false } = {}) {
  const name = `ow-editor:draft:${key}`
  if (recoverPosted) {
    try { const previous = JSON.parse(storage.getItem(name)); if (previous?.html === original && typeof previous.original === 'string') original = previous.original } catch (_) {}
  }
  return {
    key: name,
    read() {
      try { const value = JSON.parse(storage.getItem(name)); return value?.original === original && typeof value.html === 'string' && value.html !== original ? value.html : null } catch (_) { return null }
    },
    write(html) {
      try { if (html.length > 2 * 1024 * 1024) return false; storage.setItem(name, JSON.stringify({ original, html, savedAt: Date.now() })); return true } catch (_) { return false }
    },
    clear() { try { storage.removeItem(name) } catch (_) {} },
  }
}

export function escapeHTML(text) {
  const span = document.createElement('span'); span.textContent = String(text); return span.innerHTML
}
