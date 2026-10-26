import { cleanHTML, safeLink, safeImageURL, escapeHTML, ensureHTMLSize } from './safety.mjs'
import { BLOCKS, element, parseDocument, serializeDocument, nodeLength, walk, findNode, transformText, pointPosition, positionPoint } from './document.mjs'
import { editTable, emptyCell, tableGrid } from './tables.mjs'

const copy = value => JSON.parse(JSON.stringify(value))
const PARAGRAPHS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'])
const ALIGNMENT_BLOCKS = new Set([...PARAGRAPHS, 'li', 'td', 'th', 'figcaption', 'blockquote'])
export class History {
  constructor(initial, { maxSteps = 100, maxBytes = 5 * 1024 * 1024 } = {}) {
    this.entries = [copy(initial)]; this.index = 0; this.maxSteps = maxSteps; this.maxBytes = maxBytes; this.kind = null; this.time = 0
  }
  get canUndo() { return this.index > 0 }
  get canRedo() { return this.index < this.entries.length - 1 }
  record(snapshot, kind = 'command', now = Date.now()) {
    if (this.entries[this.index].html === snapshot.html) return
    this.entries.splice(this.index + 1)
    if (kind === 'typing' && this.kind === kind && now - this.time < 1000 && this.index > 0) this.entries[this.index] = copy(snapshot)
    else { this.entries.push(copy(snapshot)); this.index++ }
    while (this.entries.length > 1 && (this.entries.length > this.maxSteps || this.entries.reduce((n, s) => n + s.html.length * 2, 0) > this.maxBytes)) { this.entries.shift(); this.index-- }
    this.kind = kind; this.time = now
  }
  undo() { this.kind = null; return this.canUndo ? copy(this.entries[--this.index]) : null }
  redo() { this.kind = null; return this.canRedo ? copy(this.entries[++this.index]) : null }
}

export class EditorEngine {
  constructor(root, options = {}) {
    this.root = root; this.options = options; this.original = options.html || ''; this.destroyed = false; this.composing = false
    this.doc = parseDocument(this.original); this.initial = serializeDocument(this.doc)
    ensureHTMLSize(this.initial)
    this.selection = { from: 0, to: 0 }; this.cellIds = []; this.nodeId = null; this.storedMarks = null
    this.history = new History({ html: this.initial, selection: this.selection })
    root.contentEditable = 'true'; root.setAttribute('contenteditable', 'true'); root.setAttribute('role', 'textbox'); root.setAttribute('aria-multiline', 'true'); root.setAttribute('aria-label', options.label || '記事本文'); root.spellcheck = true
    this.handlers = {
      beforeinput: event => this._beforeInput(event), input: event => { if (!this.composing && !event.isComposing) this._readInput(event.inputType === 'insertText' ? 'typing' : 'input') },
      mousedown: () => { this.history.kind = null },
      compositionstart: () => { this.composing = true; this.compositionFrom = this._remember().from; this.history.entries[this.history.index].selection = { ...this.selection }; this._notify() },
      compositionend: () => { this.composing = false; this._readInput('composition') },
      paste: event => this._paste(event), drop: event => this._drop(event), keydown: event => this._key(event),
      keyup: event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(event.key)) {
          const anchor = window.getSelection()?.anchorNode
          const cell = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.('td,th')
          if (cell && this.root.contains(cell)) { this.cellIds = [cell.dataset.rteNode]; this.nodeId = cell.dataset.rteNode }
          else { this.cellIds = []; this.nodeId = null }
          this._paintCells(); this.options.onSelection?.(this)
        }
      },
      click: event => {
        if (this.composing || !this.root.contains(event.target)) return
        const image = event.target.closest?.('img'); if (image) this.selectNode(image)
        const cell = event.target.closest?.('td,th')
        if (cell) {
          const table = cell.closest('table'), g = tableGrid(findNode(this.doc, table.dataset.rteNode).node)
          const found = g.cells.find(c => c.node.id === cell.dataset.rteNode)
          if (found) this.selectCell(found.r, found.c, event.shiftKey, table.dataset.rteNode)
        }
        if (!image && !cell) { this.nodeId = null; this.cellIds = []; this._paintCells() }
        this._remember(); this.options.onSelection?.(this)
      },
    }
    for (const [name, handler] of Object.entries(this.handlers)) root.addEventListener(name, handler)
    this.selectionHandler = () => {
      if (!this.composing && this.root.contains(window.getSelection()?.anchorNode)) {
        const previous = this.selection.from; this._remember()
        if (previous !== this.selection.from && this.selection.from !== this.marksPosition) this.storedMarks = null
        this.options.onSelection?.(this)
      }
    }
    document.addEventListener('selectionchange', this.selectionHandler)
    this._render(false)
  }
  get dirty() { return !!this.options.initiallyUnsaved || serializeDocument(this.doc) !== this.initial }
  get canUndo() { return this.history.canUndo }
  get canRedo() { return this.history.canRedo }
  getHTML() { return serializeDocument(this.doc) !== this.initial ? cleanHTML(serializeDocument(this.doc)) : this.original }
  markSaved() { this.original = this.getHTML(); this.initial = serializeDocument(this.doc); this.options.initiallyUnsaved = false }
  _remember() {
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0)
      const from = pointPosition(this.root, range.startContainer, range.startOffset), to = pointPosition(this.root, range.endContainer, range.endOffset)
      if (from !== null && to !== null) this.selection = { from, to }
    }
    return this.selection
  }
  select(from, to = from) {
    const size = nodeLength(this.doc)
    this.selection = { from: Math.max(0, Math.min(size, from)), to: Math.max(0, Math.min(size, to)) }
    const [start, a] = positionPoint(this.root, this.selection.from), [end, b] = positionPoint(this.root, this.selection.to)
    const range = document.createRange(); range.setStart(start, a); range.setEnd(end, b)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    return this
  }
  _render(restore = true) {
    this.root.innerHTML = serializeDocument(this.doc, true)
    if (restore) this.select(this.selection.from, this.selection.to)
    this._paintCells()
  }
  _notify() {
    try { this.options.onChange?.(this); this.options.onSelection?.(this) }
    catch (_) { this.options.onError?.('画面の更新に失敗しました。本文を確認してください。') }
  }
  _transaction(action) {
    if (this.transactionDepth) return action()
    const snapshot = { html: serializeDocument(this.doc), selection: { ...this.selection }, entries: [...this.history.entries], index: this.history.index, kind: this.history.kind, time: this.history.time }
    this.transactionDepth = 1
    try { return action() }
    catch (error) {
      this.doc = parseDocument(snapshot.html); this.selection = snapshot.selection; this.nodeId = null; this.cellIds = []
      Object.assign(this.history, { entries: snapshot.entries, index: snapshot.index, kind: snapshot.kind, time: snapshot.time })
      this._render(); this._notify(); throw error
    } finally { this.transactionDepth = 0 }
  }
  _commit(kind = 'command') {
    let count = 0
    const validate = (node, depth) => {
      if (++count > 20000 || depth > 100) throw new Error('本文の構造が複雑すぎます。')
      if (node.tag === 'table') tableGrid(node)
      for (const child of node.children || []) validate(child, depth + 1)
    }
    validate(this.doc, 0)
    ensureHTMLSize(serializeDocument(this.doc))
    this._render()
    if (!this.suspendedHistory) this.history.record({ html: serializeDocument(this.doc), selection: this.selection }, kind)
    this._notify(); return true
  }
  _beforeInput(event) {
    if (this.composing || event.isComposing) return
    this._remember(); this.history.entries[this.history.index].selection = copy(this.selection)
    if (['historyUndo', 'historyRedo'].includes(event.inputType)) { event.preventDefault(); this[event.inputType === 'historyUndo' ? 'undo' : 'redo']() }
    else if (['formatBold', 'formatItalic', 'formatUnderline'].includes(event.inputType)) { event.preventDefault(); this.command(event.inputType.slice(6).toLowerCase()) }
    else if (event.inputType === 'insertText' && event.data && this.storedMarks) { event.preventDefault(); this.insertText(event.data, this.storedMarks, 'typing') }
  }
  _readInput(kind) {
    const position = this._remember()
    const previous = this.doc
    try {
      this.doc = parseDocument(this.root.innerHTML); this.selection = position
      if (kind === 'composition' && this.storedMarks && this.compositionFrom < position.to) transformText(this.doc, this.compositionFrom, position.to, () => ({ ...this.storedMarks }))
      this._commit(kind)
    } catch (error) {
      this.doc = previous; this.selection = this.history.entries[this.history.index].selection || position
      this._render(); this.options.onError?.(error.message); this._notify()
    }
  }
  _paste(event) {
    event.preventDefault(); if (this.composing) return
    const files = [...(event.clipboardData?.files || [])]
    if (files.length) { this.options.onFiles?.(files); return }
    const html = event.clipboardData?.getData('text/html')
    try {
      if (html) this.insertHTML(html)
      else this.insertText(event.clipboardData?.getData('text/plain') || '')
    } catch (error) { this.options.onError?.(error.message) }
  }
  _drop(event) {
    event.preventDefault(); if (this.composing) return
    const files = [...(event.dataTransfer?.files || [])]
    try {
      if (files.length) this.options.onFiles?.(files)
      else if (event.dataTransfer?.getData('text/html')) this.insertHTML(event.dataTransfer.getData('text/html'))
      else this.insertText(event.dataTransfer?.getData('text/plain') || '')
    } catch (error) { this.options.onError?.(error.message) }
  }
  _key(event) {
    if (this.composing || event.isComposing || event.keyCode === 229) return
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) this.history.kind = null
    if (event.metaKey || event.ctrlKey) {
      const name = event.key.toLowerCase()
      if (name === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo() }
      else if (name === 'y') { event.preventDefault(); this.redo() }
      else if ({ b: 'bold', i: 'italic', u: 'underline' }[name]) { event.preventDefault(); this.command({ b: 'bold', i: 'italic', u: 'underline' }[name]) }
      else if (name === 'k') { event.preventDefault(); this.options.onLink?.() }
    }
  }
  _history(snapshot) {
    if (!snapshot || this.composing) return false
    this.doc = parseDocument(snapshot.html); this.selection = snapshot.selection || { from: 0, to: 0 }; this.storedMarks = null; this.cellIds = []; this.nodeId = null
    this._render(); this._notify(); return true
  }
  undo() { return this._history(this.composing ? null : this.history.undo()) }
  redo() { return this._history(this.composing ? null : this.history.redo()) }
  setHTML(html) {
    return this._transaction(() => this._setHTML(html))
  }
  _setHTML(html) {
    if (this.composing) return false
    ensureHTMLSize(html)
    this.doc = parseDocument(html); this.selection = { from: 0, to: 0 }; this.nodeId = null; this.cellIds = []
    return this._commit()
  }
  getMarks() {
    if (this.storedMarks && this.selection.from === this.selection.to) return { ...this.storedMarks }
    let result = {}
    walk(this.doc, (node, position) => { if (node.text !== undefined && position <= this.selection.from && position + node.text.length >= this.selection.from) result = { ...node.marks } })
    return result
  }
  getLinkRange() {
    const leaves = []
    walk(this.doc, (node, offset) => { if (node.text !== undefined) leaves.push({ node, offset, end: offset + node.text.length }) })
    let index = leaves.findIndex(leaf => leaf.offset <= this.selection.from && leaf.end > this.selection.from)
    if (index < 0) index = leaves.findIndex(leaf => leaf.end === this.selection.from)
    if (index < 0 || !leaves[index].node.marks.link) return null
    const link = leaves[index].node.marks.link
    const same = leaf => JSON.stringify(leaf.node.marks.link) === JSON.stringify(link)
    let first = index, last = index
    while (first > 0 && leaves[first - 1].end === leaves[first].offset && same(leaves[first - 1])) first--
    while (last + 1 < leaves.length && leaves[last].end === leaves[last + 1].offset && same(leaves[last + 1])) last++
    return { from: leaves[first].offset, to: leaves[last].end, link: { ...link } }
  }
  command(name, value) {
    return this._transaction(() => this._command(name, value))
  }
  _command(name, value) {
    if (this.composing || this.destroyed) return false
    this._remember()
    if (name === 'undo' || name === 'redo') return this[name]()
    if (['heading', 'align', 'indent', 'bulletList', 'orderedList', 'quote'].includes(name)) return this._blockCommand(name, value)
    if (name === 'horizontalRule') return this.insertHTML('<hr><p><br></p>')
    if (name === 'link' && value) value = { href: safeLink(value.href), newTab: !!value.newTab }
    if (name === 'fontSize' && value && !/^(?:[89]|[1-9]\d|1\d\d)px$/.test(value)) throw new Error('文字サイズを確認してください。')
    const toggles = ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'code']
    const allowed = [...toggles, 'fontSize', 'fontFamily', 'color', 'backgroundColor', 'link', 'clear']
    if (!allowed.includes(name)) return false
    let enabled = true
    walk(this.doc, (node, position) => { if (node.text !== undefined && position < this.selection.to && position + node.text.length > this.selection.from && !node.marks[name]) enabled = false })
    if (this.selection.from === this.selection.to) enabled = !!this.getMarks()[name]
    const apply = marks => {
      if (name === 'clear') return {}
      if (toggles.includes(name)) marks[name] = !enabled
      else if (value) marks[name] = value
      else delete marks[name]
      if (name === 'sub') delete marks.sup
      if (name === 'sup') delete marks.sub
      return marks
    }
    if (this.selection.from === this.selection.to) {
      this.history.kind = null; this.storedMarks = apply(this.getMarks()); this.marksPosition = this.selection.from; this.options.onSelection?.(this); return true
    }
    transformText(this.doc, this.selection.from, this.selection.to, apply)
    return this._commit()
  }
  _selectedBlocks(tags = PARAGRAPHS) {
    const blocks = []
    walk(this.doc, (node, offset, parent) => {
      if (!tags.has(node.tag)) return
      const end = offset + nodeLength(node) - 1
      if (this.selection.from === this.selection.to ? offset <= this.selection.from && end >= this.selection.from : offset < this.selection.to && end > this.selection.from) blocks.push({ node, parent, offset })
    })
    return blocks.filter(a => !blocks.some(b => b !== a && (() => { let contains = false; walk(a.node, n => { if (n === b.node) contains = true }); return contains })()))
  }
  getAlignment() {
    const selected = new Set(this._selectedBlocks(ALIGNMENT_BLOCKS).map(({ node }) => node))
    const values = new Set()
    const style = document.createElement('p')
    const visit = (node, inherited = 'left') => {
      let own = ''
      if (node.attrs?.style) { style.setAttribute('style', node.attrs.style); own = style.style.textAlign }
      const alignment = ['left', 'center', 'right', 'justify'].includes(own) ? own : inherited
      if (selected.has(node)) {
        // Captions, table headings and host CSS can supply a visible alignment.
        const rendered = this.root.querySelector(`[data-rte-node="${node.id}"]`)
        const computed = rendered ? window.getComputedStyle(rendered).textAlign : ''
        values.add(['left', 'center', 'right', 'justify'].includes(computed) ? computed : alignment)
      }
      for (const child of node.children || []) visit(child, alignment)
    }
    visit(this.doc)
    return values.size > 1 ? '' : [...values][0] || 'left'
  }
  _blockCommand(name, value) {
    // Lists, table cells and captions may contain text without a <p>.
    // Do not make those containers eligible for heading/list transformations.
    const blocks = this._selectedBlocks(name === 'align' ? ALIGNMENT_BLOCKS : PARAGRAPHS); if (!blocks.length) return false
    const bookmark = this._modelBookmark()
    if (name === 'indent') {
      const changed = this._indentList(value)
      if (changed !== null) { if (!changed) return false; this._restoreModelBookmark(bookmark); return this._commit() }
    }
    if (name === 'heading') {
      if (!['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'].includes(value)) return false
      blocks.forEach(({ node }) => { node.tag = value })
    } else if (name === 'align' || name === 'indent') {
      if (name === 'align' && !['left', 'center', 'right', 'justify'].includes(value)) return false
      blocks.forEach(({ node }) => {
        const style = document.createElement('p'); style.setAttribute('style', node.attrs.style || '')
        if (name === 'align') style.style.textAlign = value
        else style.style.marginLeft = `${Math.max(0, Math.min(400, (parseInt(style.style.marginLeft, 10) || 0) + (value < 0 ? -40 : 40)))}px`
        node.attrs.style = style.style.cssText
      })
    } else {
      const tag = name === 'quote' ? 'blockquote' : name === 'bulletList' ? 'ul' : 'ol'
      let existing
      walk(this.doc, (node, offset, parent) => {
        if ((tag === 'blockquote' ? node.tag === tag : ['ul', 'ol'].includes(node.tag)) && offset <= this.selection.from && offset + nodeLength(node) >= this.selection.to) existing = { node, parent, offset }
      })
      if (existing) {
        if (existing.node.tag !== tag) existing.node.tag = tag
        else if (tag === 'blockquote') existing.parent.children.splice(existing.parent.children.indexOf(existing.node), 1, ...existing.node.children)
        else {
          const output = []; let batch = [], offset = existing.offset
          const flush = () => { if (batch.length) output.push(element(tag, batch, { ...existing.node.attrs })); batch = [] }
          for (const item of existing.node.children) {
            const end = offset + nodeLength(item)
            const selected = this.selection.from === this.selection.to ? offset <= this.selection.from && end > this.selection.from : offset < this.selection.to && end > this.selection.from
            if (selected) { flush(); output.push(...item.children) } else batch.push(item)
            offset = end
          }
          flush(); existing.parent.children.splice(existing.parent.children.indexOf(existing.node), 1, ...output)
        }
      } else {
        const parent = blocks[0].parent
        if (!blocks.every(b => b.parent === parent)) return false
        const nodes = blocks.map(b => b.node), start = parent.children.indexOf(nodes[0])
        parent.children = parent.children.filter(child => !nodes.includes(child))
        parent.children.splice(start, 0, element(tag, tag === 'blockquote' ? nodes : nodes.map(node => element('li', [node]))))
      }
    }
    this._restoreModelBookmark(bookmark)
    return this._commit()
  }
  _modelBookmark() {
    const anchor = position => {
      let result
      walk(this.doc, (node, offset) => {
        if ((node.text !== undefined || ['img', 'br', 'hr'].includes(node.tag)) && offset <= position) result = { node, within: Math.min(nodeLength(node), position - offset) }
      })
      return result
    }
    return { from: anchor(this.selection.from), to: anchor(this.selection.to) }
  }
  _restoreModelBookmark(bookmark) {
    for (const key of ['from', 'to']) if (bookmark[key]) walk(this.doc, (node, offset) => { if (node === bookmark[key].node) this.selection[key] = offset + bookmark[key].within })
  }
  _indentList(direction) {
    let item
    walk(this.doc, (node, offset, parent) => {
      if (node.tag === 'li' && offset <= this.selection.from && offset + nodeLength(node) > this.selection.from) item = { node, parent }
    })
    if (!item || !['ul', 'ol'].includes(item.parent.tag)) return null
    const list = item.parent, index = list.children.indexOf(item.node)
    if (direction > 0) {
      const previous = list.children[index - 1]; if (!previous) return false
      let nested = previous.children.find(child => child.tag === list.tag)
      if (!nested) { nested = element(list.tag); previous.children.push(nested) }
      list.children.splice(index, 1); nested.children.push(item.node)
    } else {
      const listParent = findNode(this.doc, list.id).parent
      if (listParent.tag === 'li') {
        const outer = findNode(this.doc, listParent.id).parent
        list.children.splice(index, 1); outer.children.splice(outer.children.indexOf(listParent) + 1, 0, item.node)
        if (!list.children.length) listParent.children.splice(listParent.children.indexOf(list), 1)
      } else {
        const before = list.children.slice(0, index), after = list.children.slice(index + 1)
        listParent.children.splice(listParent.children.indexOf(list), 1,
          ...(before.length ? [element(list.tag, before, { ...list.attrs })] : []),
          ...item.node.children,
          ...(after.length ? [element(list.tag, after, { ...list.attrs })] : []))
      }
    }
    return true
  }
  insertText(value, marks = null, kind = 'command') {
    const text = escapeHTML(String(value)).replaceAll('\n', '<br>')
    return this.insertHTML(text, marks, kind)
  }
  insertHTML(value, marks = null, kind = 'command') {
    return this._transaction(() => this._insertHTML(value, marks, kind))
  }
  _insertHTML(value, marks = null, kind = 'command') {
    if (this.composing || this.destroyed) return false
    ensureHTMLSize(value)
    this._remember(); this.select(this.selection.from, this.selection.to)
    const range = window.getSelection().getRangeAt(0), template = document.createElement('template')
    template.innerHTML = cleanHTML(value)
    const plain = [...template.content.childNodes].every(n => n.nodeType === 3 || (n.nodeType === 1 && !BLOCKS.has(n.tagName.toLowerCase()) && !['img', 'hr'].includes(n.tagName.toLowerCase())))
    const start = this.selection.from
    range.deleteContents()
    const last = template.content.lastChild
    if (!last) { this.doc = parseDocument(this.root.innerHTML); this.selection = { from: start, to: start }; return this._commit(kind) }
    const block = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).closest('p,h1,h2,h3,h4,h5,h6,pre')
    if (!plain && block && this.root.contains(block)) {
      const tailRange = document.createRange(); tailRange.selectNodeContents(block); tailRange.setStart(range.startContainer, range.startOffset)
      const tail = block.cloneNode(false); tail.removeAttribute('data-rte-node'); tail.append(tailRange.extractContents())
      block.after(template.content)
      last.after(tail.childNodes.length ? tail : document.createElement('p'))
      const following = last.nextSibling
      if (!following.childNodes.length) following.append(document.createElement('br'))
      range.setStart(following, 0)
    } else { range.insertNode(template.content); range.setStartAfter(last) }
    range.collapse(true); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    this.selection = this._remember(); this.doc = parseDocument(this.root.innerHTML)
    if (marks) transformText(this.doc, start, this.selection.to, () => ({ ...marks }))
    this.marksPosition = this.selection.from
    return this._commit(kind)
  }
  selectNode(dom) {
    if (!dom || !this.root.contains(dom)) return false
    this.nodeId = dom.dataset.rteNode; this.cellIds = []
    const range = document.createRange(); range.selectNode(dom)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); this._remember(); this.options.onSelection?.(this); return true
  }
  insertImage(attrs) {
    const src = safeImageURL(attrs.src)
    const start = this._remember().from
    this.insertHTML(`<figure class="image"><img src="${escapeHTML(src).replaceAll('"', '&quot;')}" alt="${escapeHTML(attrs.alt || '').replaceAll('"', '&quot;')}"${attrs.width ? ` width="${Math.max(16, Math.min(4096, parseInt(attrs.width, 10) || 320))}"` : ''}></figure><p><br></p>`)
    let image
    walk(this.doc, (node, offset) => { if (!image && node.tag === 'img' && offset >= start) image = node })
    if (image) this.selectNode(this.root.querySelector(`[data-rte-node="${image.id}"]`))
    return true
  }
  updateImage(attrs) {
    return this._transaction(() => this._updateImage(attrs))
  }
  _updateImage(attrs) {
    const found = findNode(this.doc, this.nodeId)
    if (!found || found.node.tag !== 'img') return false
    const bookmark = this._modelBookmark()
    const { node } = found
    if (attrs.src) node.attrs.src = safeImageURL(attrs.src)
    for (const name of ['width', 'height']) if (name in attrs) node.attrs[name] = attrs[name] ? String(Math.max(16, Math.min(4096, parseInt(attrs[name], 10) || 16))) : undefined
    const imageStyle = document.createElement('img'); imageStyle.setAttribute('style', node.attrs.style || '')
    for (const name of ['width', 'height']) if (name in attrs) imageStyle.style[name] = node.attrs[name] ? `${node.attrs[name]}px` : name === 'height' ? 'auto' : ''
    node.attrs.style = imageStyle.style.cssText
    if ('alt' in attrs) node.attrs.alt = String(attrs.alt)
    let figure = found.parent.tag === 'figure' ? found.parent : null
    if (!figure && ('caption' in attrs || 'align' in attrs)) {
      figure = element('figure', [node], { class: 'image' })
      const index = found.parent.children.indexOf(node)
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'].includes(found.parent.tag)) {
        const parent = findNode(this.doc, found.parent.id).parent
        const before = found.parent.children.slice(0, index), after = found.parent.children.slice(index + 1)
        parent.children.splice(parent.children.indexOf(found.parent), 1,
          ...(before.length ? [element(found.parent.tag, before, { ...found.parent.attrs })] : []), figure,
          ...(after.length ? [element(found.parent.tag, after, { ...found.parent.attrs })] : []))
      } else found.parent.children.splice(index, 1, figure)
    }
    if (figure && 'align' in attrs) {
      const align = ['left', 'right', 'center'].includes(attrs.align) ? attrs.align : 'center'
      figure.attrs.class = `image image-style-align-${align}`
      figure.attrs.style = align === 'center' ? 'margin-left: auto; margin-right: auto;' : `float: ${align};`
    }
    if (figure && 'caption' in attrs) {
      figure.children = figure.children.filter(child => child.tag !== 'figcaption')
      if (attrs.caption) figure.children.push(element('figcaption', [{ text: String(attrs.caption), marks: {} }]))
    }
    this._restoreModelBookmark(bookmark)
    return this._commit()
  }
  insertTable(rows, cols) {
    rows = Math.max(1, Math.min(20, parseInt(rows, 10) || 3)); cols = Math.max(1, Math.min(20, parseInt(cols, 10) || 3))
    const table = element('table', [element('tbody', Array.from({ length: rows }, () => element('tr', Array.from({ length: cols }, () => emptyCell()))))], { style: 'width: 100%; border-collapse: collapse;' })
    this.insertHTML(serializeDocument(table)); return true
  }
  _tableContext() {
    let result
    walk(this.doc, node => { if (node.tag === 'table') { const grid = tableGrid(node); if (grid.cells.some(cell => this.cellIds.includes(cell.node.id))) result = { node, ...grid } } })
    return result
  }
  selectCell(row, col, extend = false, tableId = null) {
    let context = this._tableContext()
    if (tableId && context?.node.id !== tableId) {
      const target = findNode(this.doc, tableId)
      if (!target || target.node.tag !== 'table') return false
      context = { node: target.node, ...tableGrid(target.node) }; this.cellIds = []
    }
    if (!context) {
      let table
      walk(this.doc, node => { if (!table && node.tag === 'table') table = node })
      if (!table) return false
      context = { node: table, ...tableGrid(table) }
    }
    const cell = context.grid[row]?.[col]; if (!cell) return false
    if (extend && this.cellIds.length) {
      const first = context.cells.find(c => c.node.id === this.cellIds[0])
      if (first) this.cellIds = context.cells.filter(c => c.r >= Math.min(first.r, row) && c.r <= Math.max(first.r, row) && c.c >= Math.min(first.c, col) && c.c <= Math.max(first.c, col)).map(c => c.node.id)
    } else this.cellIds = [cell.node.id]
    this.nodeId = cell.node.id; this._paintCells(); this.options.onSelection?.(this); return true
  }
  _paintCells() {
    for (const cell of this.root.querySelectorAll('td,th')) cell.classList.toggle('rte-cell-selected', this.cellIds.includes(cell.dataset.rteNode))
  }
  table(operation, value) {
    return this._transaction(() => this._table(operation, value))
  }
  _table(operation, value) {
    const context = this._tableContext(); if (!context || this.composing) return false
    const bookmark = this._modelBookmark()
    if (operation === 'delete') {
      const { parent } = findNode(this.doc, context.node.id); parent.children.splice(parent.children.indexOf(context.node), 1)
      this.cellIds = []
    } else if (!editTable(context.node, this.cellIds, operation, value)) return false
    const ids = new Set(); walk(this.doc, node => { if (node.id) ids.add(node.id) })
    this.cellIds = this.cellIds.filter(id => ids.has(id))
    if (!ids.has(this.nodeId)) this.nodeId = this.cellIds[0] || null
    this._restoreModelBookmark(bookmark)
    return this._commit()
  }
  find(query, backwards = false) {
    if (!query) return false
    let text = ''
    const visit = node => {
      if (node.text !== undefined) text += node.text
      else if (['img', 'br', 'hr'].includes(node.tag)) text += '\n'
      else { node.children.forEach(visit); if (BLOCKS.has(node.tag)) text += '\n' }
    }
    visit(this.doc)
    const index = backwards ? text.lastIndexOf(query, Math.max(0, this.selection.from - 1)) : text.indexOf(query, this.selection.to)
    const found = index < 0 ? text.indexOf(query) : index
    if (found < 0) return false
    this.select(found, found + query.length); return true
  }
  replaceAll(query, replacement) {
    return this._transaction(() => this._replaceAll(query, String(replacement)))
  }
  _replaceAll(query, replacement) {
    if (!query || this.composing) return 0
    if (query.includes('\n')) throw new Error('検索する文字には改行を含めないでください。')
    // Replace in the model in one pass. Rebuilding the DOM once per match is
    // quadratic for long articles and would interrupt selection and history.
    const leaves = [], positions = []; let text = ''
    walk(this.doc, (node, offset, parent) => {
      if (node.text === undefined) return
      if (text.length < offset) text += '\n'.repeat(offset - text.length)
      text += node.text; leaves.push({ node, offset, parent })
    })
    for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) positions.push(at)
    if (!positions.length) return 0
    const encoder = new TextEncoder()
    if (encoder.encode(text).byteLength + positions.length * (encoder.encode(replacement).byteLength - encoder.encode(query).byteLength) > 2 * 1024 * 1024) throw new Error('置換後の本文が2 MBを超えます。')
    let match = 0
    for (const { node, offset, parent } of leaves) {
      const end = offset + node.text.length, parts = []; let cursor = 0
      const append = value => { if (!value) return; const previous = parts[parts.length - 1]; if (previous?.text !== undefined) previous.text += value; else parts.push({ text: value, marks: { ...node.marks } }) }
      while (match < positions.length && positions[match] + query.length <= offset) match++
      for (let index = match; index < positions.length && positions[index] < end; index++) {
        const start = positions[index], finish = start + query.length
        append(node.text.slice(cursor, Math.max(cursor, start - offset)))
        if (start >= offset) {
          replacement.split('\n').forEach((part, i) => { if (i) parts.push(element('br')); append(part) })
        }
        cursor = Math.max(cursor, Math.min(node.text.length, finish - offset))
      }
      append(node.text.slice(cursor))
      parent.children.splice(parent.children.indexOf(node), 1, ...parts)
    }
    this.selection = { from: 0, to: 0 }; this._commit(); return positions.length
  }
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const [name, handler] of Object.entries(this.handlers)) this.root.removeEventListener(name, handler)
    document.removeEventListener('selectionchange', this.selectionHandler)
    this.root.contentEditable = 'false'; this.root.setAttribute('contenteditable', 'false')
  }
}
