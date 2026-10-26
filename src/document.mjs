import { cleanHTML, safeLink, escapeHTML, ensureHTMLSize } from './safety.mjs'

export const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'li', 'ul', 'ol', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'])
const FORMATS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup', 'code', 'span', 'a', 'font', 'mark'])
const INLINE_STYLES = { color: 'color', backgroundColor: 'backgroundColor', fontSize: 'fontSize', fontFamily: 'fontFamily' }
let serial = 0
export const element = (tag, children = [], attrs = {}) => ({ id: `n${++serial}`, tag, attrs, children })
const text = (value, marks) => ({ text: value, marks: { ...marks } })

function inheritedMarks(dom, previous) {
  const marks = { ...previous }, tag = dom.tagName.toLowerCase()
  if (['strong', 'b'].includes(tag)) marks.bold = true
  if (['em', 'i'].includes(tag)) marks.italic = true
  if (tag === 'u') marks.underline = true
  if (['s', 'strike', 'del'].includes(tag)) marks.strike = true
  if (tag === 'code') marks.code = true
  if (tag === 'sub') { marks.sub = true; delete marks.sup }
  if (tag === 'sup') { marks.sup = true; delete marks.sub }
  if (tag === 'mark') marks.backgroundColor = dom.style.backgroundColor || '#fff59d'
  if (tag === 'font') {
    if (dom.getAttribute('color')) marks.color = dom.getAttribute('color')
    if (dom.getAttribute('face')) marks.fontFamily = dom.getAttribute('face')
  }
  const style = dom.style
  if (style.fontWeight) marks.bold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600
  if (style.fontStyle) marks.italic = style.fontStyle === 'italic'
  const decoration = style.textDecorationLine || style.textDecoration
  if (decoration) { marks.underline = decoration.includes('underline'); marks.strike = decoration.includes('line-through') }
  for (const [property, name] of Object.entries(INLINE_STYLES)) if (style[property]) marks[name] = style[property]
  if (tag === 'span' && dom.className) marks.className = dom.className
  if (tag === 'a' && dom.hasAttribute('href')) {
    try { marks.link = { href: safeLink(dom.getAttribute('href')), newTab: dom.target === '_blank' } } catch (_) {}
  }
  return marks
}

export function parseDocument(html) {
  ensureHTMLSize(html)
  const template = document.createElement('template'); template.innerHTML = cleanHTML(html)
  let count = 0
  function read(dom, inherited = {}, depth = 0) {
    if (++count > 20000 || depth > 100) throw new Error('本文の構造が複雑すぎるため、内容を分けて編集してください。')
    if (dom.nodeType === 3) return [text(dom.data, inherited)]
    if (dom.nodeType !== 1) return []
    const tag = dom.tagName.toLowerCase(), marks = inheritedMarks(dom, inherited)
    const children = [...dom.childNodes].flatMap(child => read(child, marks, depth + 1))
    if (FORMATS.has(tag)) return children
    const attrs = Object.fromEntries([...dom.attributes].map(a => [a.name, a.value]))
    if (dom.hasAttribute('style')) {
      const copy = dom.cloneNode(false)
      for (const p of ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'font-size', 'font-family']) copy.style.removeProperty(p)
      if (copy.style.cssText) attrs.style = copy.style.cssText
      else delete attrs.style
    }
    const node = element(tag, children, attrs)
    if (tag === 'img' && marks.link) node.link = marks.link
    return [node]
  }
  const root = element('root', [...template.content.childNodes].flatMap(child => read(child)))
  // Browser editing may produce loose text and <br> at the root.
  const groups = []; let inline = []
  const flush = () => { if (inline.length) { groups.push(element('p', inline)); inline = [] } }
  for (const child of root.children) {
    if (child.text !== undefined && !child.text.trim() && !inline.length) continue
    if (child.text !== undefined || ['br', 'img'].includes(child.tag)) inline.push(child)
    else { flush(); groups.push(child) }
  }
  flush(); root.children = groups.length ? groups : [element('p', [element('br')])]
  return root
}

function wrapText(node) {
  let html = escapeHTML(node.text), m = node.marks
  const span = document.createElement('span')
  for (const [property, name] of Object.entries(INLINE_STYLES)) if (m[name]) span.style[property] = m[name]
  if (m.className) span.className = m.className
  if (span.attributes.length) html = `<span${attributes(Object.fromEntries([...span.attributes].map(a => [a.name, a.value])))}>${html}</span>`
  for (const [name, tag] of [['code', 'code'], ['sub', 'sub'], ['sup', 'sup'], ['strike', 's'], ['underline', 'u'], ['italic', 'em'], ['bold', 'strong']]) if (m[name]) html = `<${tag}>${html}</${tag}>`
  if (m.link) html = `<a${attributes({ href: m.link.href, ...(m.link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}) })}>${html}</a>`
  return html
}
function attributes(attrs) {
  return Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${escapeHTML(v).replaceAll('"', '&quot;')}"`).join('')
}
export function serializeDocument(root, editing = false) {
  function write(node) {
    if (node.text !== undefined) return wrapText(node)
    if (node.tag === 'root') return node.children.map(write).join('')
    const attrs = { ...node.attrs, ...(editing ? { 'data-rte-node': node.id } : {}) }
    let html = `<${node.tag}${attributes(attrs)}>`
    if (!['img', 'br', 'hr', 'col'].includes(node.tag)) html += `${node.children.map(write).join('')}</${node.tag}>`
    if (node.link) html = `<a${attributes({ href: node.link.href, ...(node.link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}) })}>${html}</a>`
    return html
  }
  return write(root)
}
export function nodeLength(node) {
  if (node.text !== undefined) return node.text.length
  if (['img', 'br', 'hr'].includes(node.tag)) return 1
  return node.children.reduce((sum, child) => sum + nodeLength(child), 0) + (BLOCKS.has(node.tag) ? 1 : 0)
}
export function walk(root, callback, offset = 0, parent = null) {
  callback(root, offset, parent)
  let position = offset
  for (const child of root.children || []) { walk(child, callback, position, root); position += nodeLength(child) }
}
export function findNode(root, id) {
  let found
  walk(root, (node, offset, parent) => { if (node.id === id) found = { node, offset, parent } })
  return found
}
export function transformText(root, from, to, operation) {
  function visit(parent, offset) {
    let position = offset; const children = []
    for (const child of parent.children) {
      const length = nodeLength(child)
      if (child.text !== undefined && position < to && position + length > from) {
        const start = Math.max(0, from - position), end = Math.min(length, to - position)
        if (start) children.push(text(child.text.slice(0, start), child.marks))
        children.push(text(child.text.slice(start, end), operation({ ...child.marks })))
        if (end < length) children.push(text(child.text.slice(end), child.marks))
      } else {
        if (child.children) visit(child, position)
        children.push(child)
      }
      position += length
    }
    // Joining equivalent neighboring text runs keeps repeated formatting small.
    parent.children = children.reduce((all, child) => {
      const previous = all[all.length - 1]
      if (child.text !== undefined && previous?.text !== undefined && JSON.stringify(child.marks) === JSON.stringify(previous.marks)) previous.text += child.text
      else all.push(child)
      return all
    }, [])
  }
  visit(root, 0)
}

export function domLength(node) {
  if (node.nodeType === 3) return node.data.length
  if (node.nodeType !== 1) return 0
  const tag = node.tagName.toLowerCase()
  if (['img', 'br', 'hr'].includes(tag)) return 1
  return [...node.childNodes].reduce((n, child) => n + domLength(child), 0) + (BLOCKS.has(tag) ? 1 : 0)
}
export function pointPosition(root, container, offset) {
  if (!root.contains(container) && container !== root) return null
  let position = container.nodeType === 3 ? offset : [...container.childNodes].slice(0, offset).reduce((n, child) => n + domLength(child), 0)
  let node = container
  while (node !== root) {
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) position += domLength(sibling)
    node = node.parentNode
  }
  return position
}
export function positionPoint(root, desired) {
  let cursor = 0, result
  function visit(node) {
    if (result) return
    if (node.nodeType === 3) {
      if (desired <= cursor + node.data.length) result = [node, Math.max(0, desired - cursor)]
      cursor += node.data.length; return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName.toLowerCase()
    if (['img', 'br', 'hr'].includes(tag)) {
      if (desired <= cursor + 1) result = [node.parentNode, [...node.parentNode.childNodes].indexOf(node) + (desired > cursor ? 1 : 0)]
      cursor++; return
    }
    for (const child of node.childNodes) visit(child)
    if (node !== root && BLOCKS.has(tag)) {
      if (!result && desired <= cursor) result = [node, node.childNodes.length]
      cursor++
    }
  }
  visit(root)
  return result || [root, root.childNodes.length]
}
