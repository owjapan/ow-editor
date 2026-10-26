import { EditorEngine } from './engine.mjs'
import { cleanHTML, createDraftStore, safeLink } from './safety.mjs'
import { findNode, walk } from './document.mjs'

// Original, small SVG paths. No CKEditor/Tiptap UI assets are used.
export const VERSION = '0.1.1'

const formStates = new WeakMap()
let anonymousDraft = 0
function refreshForm(state) {
  if (!state) return
  for (const button of [...state.form.elements].filter(element => element.matches('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]'))) {
    if (!state.buttons.has(button)) state.buttons.set(button, button.disabled)
  }
  const ready = [...state.editors].every(editor => editor.canSave)
  const delegated = [...state.editors].some(editor => editor.options.enableInitiallyDisabledSubmit === true)
  for (const [button, disabled] of state.buttons) button.disabled = !ready || (disabled && !delegated)
}

const paths = {
  undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12',
  link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
  image: 'M3 4h18v16H3zM3 17l5-5 4 4 4-6 5 7M8 8h.01', table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
  indent: 'M10 5h11M10 10h11M10 15h11M10 20h11M3 8l4 4-4 4', outdent: 'M10 5h11M10 10h11M10 15h11M10 20h11M7 8l-4 4 4 4',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6', fullscreen: 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',
}
const symbols = { bold: 'B', italic: 'I', underline: 'U', strike: 'S', bulletList: '• ≡', orderedList: '1 ≡', quote: '❝', horizontalRule: '―', clear: 'Tₓ', source: '〈/〉' }

export class RichTextEditor {
  constructor(field, options = {}) {
    this.field = field; this.options = options; this.messages = options.messages || {}; this.original = field.value
    this.originalField = { hidden: field.hidden, readOnly: field.readOnly }
    this.lastHTML = this.original
    this.allowedImageTypes = options.allowedImageTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    this.maxImageBytes = options.maxImageBytes ?? 10 * 1024 * 1024
    this.form = field.form; this.destroyed = false; this.pending = false; this.submitted = false; this.activePanel = null
    this.controls = []; this.cleanups = []
    this.element = document.createElement('section'); this.element.className = 'df-editor'; this.element.setAttribute('aria-label', options.label || this.label('editor'))
    const head = document.createElement('div'); head.className = 'df-editor-heading'
    const title = document.createElement('strong'); title.textContent = options.label || this.label('editor')
    this.counter = document.createElement('span'); head.append(title, this.counter)
    this.toolbar = document.createElement('div'); this.toolbar.className = 'df-editor-toolbar'; this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', this.label('formatting'))
    this.draftBar = document.createElement('div'); this.draftBar.className = 'df-editor-draft'; this.draftBar.dataset.rteDraft = ''; this.draftBar.hidden = true
    this.panelHost = document.createElement('div'); this.panelHost.className = 'df-editor-panel'; this.panelHost.hidden = true
    this.body = document.createElement('div'); this.body.className = 'df-editor-body'
    this.status = document.createElement('p'); this.status.className = 'df-editor-status'; this.status.setAttribute('role', 'status')
    this.context = document.createElement('div'); this.context.className = 'df-editor-context'
    this.element.append(head, this.toolbar, this.draftBar, this.panelHost, this.body, this.context, this.status); field.after(this.element)
    const storage = (() => { try { return options.storage || window.sessionStorage } catch (_) { return null } })()
    const identity = field.name || field.id || `anonymous-${++anonymousDraft}`
    const draftKey = options.draftKey ?? `${new URL(this.form?.action || window.location.href).pathname}:${identity}`
    this.draft = createDraftStore(storage, draftKey, this.original, { recoverPosted: !!options.initiallyUnsaved })
    this._buildToolbar()
    try { this.engine = new EditorEngine(this.body, {
      html: this.original, label: options.label || this.label('body'),
      initiallyUnsaved: options.initiallyUnsaved,
      onChange: () => this._changed(), onSelection: () => this._refresh(),
      onError: message => this.notice(message, true),
      onFiles: files => this.uploadImages(files), onLink: () => this.openLink(),
    }) } catch (error) { this.element.remove(); throw error }
    if (this.form) {
      this.formState = formStates.get(this.form)
      if (!this.formState) { this.formState = { form: this.form, editors: new Set(), buttons: new Map() }; formStates.set(this.form, this.formState) }
      this.formState.editors.add(this)
    }
    const cached = this.draft.read()
    if (cached !== null && cached !== this.original) {
      this.draftBar.hidden = false
      const text = document.createElement('span'); text.textContent = this.label('draftAvailable'); this.draftBar.append(text)
      const restore = this._button('restoreDraft', () => { this.engine.setHTML(cached); this.draftBar.hidden = true }, this.draftBar); restore.dataset.rteRestore = ''
      this._button('discardDraft', () => { this.draft.clear(); this.draftBar.hidden = true }, this.draftBar)
    }
    this._listen(this.form, 'submit', event => {
      if (!this.canSave || [...this.formState.editors].some(editor => !editor.canSave)) { event.preventDefault(); event.stopImmediatePropagation(); this.notice(this.label('finishFirst')); return }
      this.field.value = this.engine.getHTML(); this.submitted = true; this.options.onSubmit?.(this)
    }, true)
    this._listen(window, 'beforeunload', event => {
      if (this.engine.dirty && !this.submitted && !this.destroyed) { event.preventDefault(); event.returnValue = '' }
    })
    this._listen(document, 'turbolinks:before-visit', event => {
      if (this.engine.dirty && !this.submitted && !this.destroyed && !window.confirm(this.label('leaveConfirm'))) event.preventDefault()
    })
    this._listen(document, 'turbolinks:request-end', () => { this.submitted = false })
    this._listen(window, 'pageshow', event => { if (event.persisted) this.submitted = false })
    this._listen(this.element, 'keydown', event => { if (!event.isComposing && event.key === 'Escape' && this.activePanel) { event.preventDefault(); this.closePanel() } })
    field.hidden = true; field.readOnly = true
    this._refresh()
  }
  label(name) { return this.messages[name] || name }
  get dirty() { return this.engine.dirty }
  get canSave() { return !this.destroyed && !!this.engine && !this.pending && !this.activePanel && !this.engine.composing }
  getHTML() { return this.engine.getHTML() }
  getSafeHTML() { return cleanHTML(this.engine.getHTML()) }
  _listen(target, name, handler, capture = false) {
    target?.addEventListener(name, handler, capture)
    this.cleanups.push(() => target?.removeEventListener(name, handler, capture))
  }
  _button(name, action, parent = this.toolbar, { command, value, text = false } = {}) {
    const button = document.createElement('button'); button.type = 'button'; button.title = this.label(name); button.setAttribute('aria-label', this.label(name)); button.dataset.rteAction = name
    if (paths[name] && !text) button.innerHTML = `<svg viewBox="0 0 24 26" aria-hidden="true"><path d="${paths[name]}"/></svg>`
    else if (symbols[name] && !text) { const icon = document.createElement('span'); icon.className = `df-editor-icon icon-${name}`; icon.textContent = symbols[name]; icon.setAttribute('aria-hidden', 'true'); button.append(icon) }
    else button.textContent = this.label(name)
    button.addEventListener('mousedown', event => event.preventDefault())
    button.addEventListener('click', () => { try { action() } catch (error) { this.notice(error.message || this.label('operationFailed'), true) } })
    if (command) { button.dataset.rteCommand = command; button.dataset.rteValue = String(value ?? ''); this.controls.push(button) }
    parent.append(button); return button
  }
  _select(name, choices, action, parent = this.toolbar) {
    const select = document.createElement('select'); select.setAttribute('aria-label', this.label(name)); select.title = this.label(name)
    for (const [value, label] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option) }
    select.addEventListener('change', () => { try { action(select.value) } catch (error) { this.notice(error.message, true) } })
    parent.append(select); if (parent === this.toolbar) this.controls.push(select); return select
  }
  _group() { const group = document.createElement('span'); group.className = 'df-editor-group'; this.toolbar.append(group); return group }
  _buildToolbar() {
    const history = this._group()
    for (const name of ['undo', 'redo']) this._button(name, () => this.run(name), history, { command: name })
    const type = this._group()
    this.heading = this._select('heading', [['p', this.label('paragraph')], ['h2', this.label('heading2')], ['h3', this.label('heading3')], ['h4', this.label('heading4')], ['pre', this.label('preformatted')]], value => this.run('heading', value), type); this.controls.push(this.heading)
    const format = this._group()
    for (const name of ['bold', 'italic', 'underline', 'strike']) this._button(name, () => this.run(name), format, { command: name })
    const lists = this._group()
    for (const name of ['bulletList', 'orderedList']) this._button(name, () => this.run(name), lists, { command: name })
    this._button('outdent', () => this.run('indent', -1), lists, { command: 'indent', value: -1 })
    this._button('indent', () => this.run('indent', 1), lists, { command: 'indent', value: 1 })
    const alignment = this._group()
    this.alignment = this._select('align', [['', this.label('mixedAlignment')], ...['left', 'center', 'right', 'justify'].map(value => [value, this.label(value)])], value => this.run('align', value), alignment)
    this.alignment.options[0].disabled = true
    const insert = this._group()
    this._button('link', () => this.openLink(), insert)
    this.imageButton = this._button('image', () => this.pickImage(), insert)
    if (typeof this.options.upload !== 'function') this.imageButton.title = this.label('uploadNotConfigured')
    this._button('table', () => this.openTable(), insert)
    this._button('quote', () => this.run('quote'), insert, { command: 'quote' })
    this._button('horizontalRule', () => this.run('horizontalRule'), insert)
    const font = this._group()
    this._select('fontFamily', [['', this.label('defaultFont')], ['sans-serif', this.label('sansSerif')], ['serif', this.label('serif')], ['monospace', this.label('monospace')]], value => this.run('fontFamily', value), font)
    this._select('fontSize', [['', this.label('defaultSize')], ...[12, 14, 16, 18, 24, 32, 48, 64].map(size => [`${size}px`, `${size}px`])], value => this.run('fontSize', value), font)
    const colors = this._group()
    for (const [name, defaultValue] of [['color', '#222222'], ['backgroundColor', '#fff59d']]) {
      const label = document.createElement('label'); label.className = 'df-editor-color'; label.textContent = this.label(name)
      const input = document.createElement('input'); input.type = 'color'; input.value = defaultValue; input.setAttribute('aria-label', this.label(name)); input.addEventListener('change', () => this.run(name, input.value)); label.append(input); colors.append(label); this.controls.push(input)
    }
    this._button('clear', () => this.run('clear'), colors, { command: 'clear' })
    const tools = this._group()
    this._button('search', () => this.openSearch(), tools)
    this._button('source', () => this.openSource(), tools)
    this._button('fullscreen', () => { this.element.classList.toggle('df-editor-fullscreen'); this.body.focus() }, tools)
    this.fileInput = document.createElement('input'); this.fileInput.type = 'file'; this.fileInput.accept = this.allowedImageTypes.join(','); this.fileInput.hidden = true
    this.fileInput.addEventListener('change', () => { this.uploadImages([...this.fileInput.files]); this.fileInput.value = '' }); this.element.append(this.fileInput)
  }
  run(name, value) {
    if (!this.canSave) return false
    const range = { ...this.engine.selection }
    this.notice(''); this.body.focus(); this.engine.select(range.from, range.to); return this.engine.command(name, value)
  }
  _changed() {
    if (this.destroyed || !this.engine) return
    this.submitted = false
    this.field.value = this.engine.getHTML()
    if (this.engine.dirty) {
      this.saved = false
      if (!this.draft.write(this.field.value)) this.notice(this.label('draftUnavailable'), true)
    }
    else this.draft.clear()
    this._refresh()
    if (this.lastHTML !== this.field.value) { this.lastHTML = this.field.value; this.options.onChange?.(this) }
  }
  _refresh() {
    if (!this.engine || this.destroyed) return
    const enabled = this.canSave
    refreshForm(this.formState)
    // IME must retain its editable DOM until compositionend. Only saving and
    // toolbar commands are disabled while composition is in progress.
    this.body.setAttribute('contenteditable', String(!this.pending && !this.activePanel && !this.destroyed))
    for (const control of this.toolbar.querySelectorAll('button,select,input')) control.disabled = !enabled
    this.imageButton.disabled = !enabled || typeof this.options.upload !== 'function'
    const marks = this.engine.getMarks()
    this.alignment.value = this.engine.getAlignment()
    for (const control of this.controls) {
      const name = control.dataset.rteCommand
      if (['bold', 'italic', 'underline', 'strike'].includes(name)) control.setAttribute('aria-pressed', String(!!marks[name]))
      if (name === 'undo') control.disabled = !enabled || !this.engine.canUndo
      if (name === 'redo') control.disabled = !enabled || !this.engine.canRedo
    }
    this.counter.textContent = `${this.body.textContent.length.toLocaleString()} ${this.label('characters')}`
    if (!this.activePanel && !this.pending) this._context()
    else this.context.hidden = true
    for (const control of this.context.querySelectorAll('button,input,select')) control.disabled = !enabled
    if (!this.lastNotice) this.status.textContent = this.engine.composing ? this.label('composing') : this.pending ? this.label('uploading') : this.engine.dirty ? this.label('unsaved') : this.label('unchanged')
    if (this.previousCanSave !== enabled) { this.previousCanSave = enabled; this.options.onStateChange?.(this) }
  }
  notice(text, error = false) {
    this.lastNotice = text; this.status.textContent = text; this.status.classList.toggle('df-editor-error', error)
  }
  _panel(name) {
    if (this.pending || this.engine.composing) return null
    this.bookmark = { ...this.engine._remember() }; this.activePanel = name
    this.panelHost.replaceChildren(); this.panelHost.hidden = false
    const heading = document.createElement('h3'); heading.textContent = this.label(name); this.panelHost.append(heading)
    this._refresh(); return this.panelHost
  }
  _input(parent, name, value = '', type = 'text') {
    const label = document.createElement('label'); label.className = 'df-editor-field'; const text = document.createElement('span'); text.textContent = this.label(name)
    const input = document.createElement('input'); input.type = type; input.value = value; input.setAttribute('aria-label', this.label(name)); label.append(text, input); parent.append(label); return input
  }
  _panelActions(apply) {
    const actions = document.createElement('div'); actions.className = 'df-editor-actions'; this.panelHost.append(actions)
    const button = this._button('apply', () => { try { apply() } catch (error) { this.notice(error.message || this.label('operationFailed'), true) } }, actions); button.dataset.rteApply = ''; button.classList.add('df-editor-primary')
    this._button('cancel', () => this.closePanel(), actions)
  }
  closePanel() {
    const bookmark = this.bookmark
    this.activePanel = null; this.panelHost.hidden = true; this.panelHost.replaceChildren(); this.notice(''); this._refresh()
    if (bookmark) { this.body.focus(); this.engine.select(bookmark.from, bookmark.to) }
  }
  openSource() {
    const panel = this._panel('source'); if (!panel) return
    const source = document.createElement('textarea'); source.className = 'df-editor-source'; source.dataset.rteSource = ''; source.setAttribute('aria-label', this.label('source')); source.value = this.engine.getHTML(); panel.append(source)
    const preview = document.createElement('div'); preview.className = 'df-editor-preview'; preview.hidden = true
    this._button('preview', () => { preview.innerHTML = cleanHTML(source.value); preview.hidden = !preview.hidden }, panel)
    panel.append(preview)
    this._panelActions(() => { this.engine.setHTML(source.value); this.closePanel(); this.notice(this.label('sourceApplied')) })
    source.focus()
  }
  openLink() {
    this.engine._remember()
    if (this.engine.selection.from === this.engine.selection.to) {
      const range = this.engine.getLinkRange()
      if (range) this.engine.select(range.from, range.to)
    }
    const marks = this.engine.getMarks(), panel = this._panel('link'); if (!panel) return
    const href = this._input(panel, 'linkURL', marks.link?.href || '', 'text')
    const newTabLabel = document.createElement('label'), newTab = document.createElement('input'); newTab.type = 'checkbox'; newTab.checked = marks.link?.newTab !== false
    newTabLabel.append(newTab, document.createTextNode(this.label('newTab'))); panel.append(newTabLabel)
    this._button('unlink', () => { this.closePanel(); this.engine.command('link', null) }, panel)
    this._panelActions(() => {
      const value = { href: safeLink(href.value), newTab: newTab.checked }, range = this.bookmark
      this.closePanel(); this.engine.select(range.from, range.to)
      if (range.from === range.to) this.engine.insertText(value.href, { link: value })
      else this.engine.command('link', value)
    })
    href.focus()
  }
  openTable() {
    const panel = this._panel('insertTable'); if (!panel) return
    const rows = this._input(panel, 'rows', '3', 'number'), cols = this._input(panel, 'columns', '3', 'number')
    for (const input of [rows, cols]) { input.min = '1'; input.max = '20' }
    this._panelActions(() => { const values = [rows.value, cols.value]; this.closePanel(); this.engine.insertTable(...values) })
  }
  openSearch() {
    const panel = this._panel('search'); if (!panel) return
    const query = this._input(panel, 'searchText'), replacement = this._input(panel, 'replaceText')
    this._button('findNext', () => { if (!this.engine.find(query.value)) this.notice(this.label('notFound')) }, panel)
    this._button('replaceOne', () => { this.engine.insertText(replacement.value); this.engine.find(query.value) }, panel)
    this._button('replaceAll', () => { const count = this.engine.replaceAll(query.value, replacement.value); this.notice(`${count} ${this.label('replaced')}`) }, panel)
    this._button('close', () => this.closePanel(), panel); query.focus()
  }
  pickImage() { if (this.canSave && typeof this.options.upload === 'function') { this.engine._remember(); this.fileInput.click() } }
  async uploadImages(files) {
    if (!this.canSave || !files.length) return
    if (typeof this.options.upload !== 'function') { this.notice(this.label('uploadNotConfigured')); return }
    if (files.some(file => !this.allowedImageTypes.includes(file.type) || file.size > this.maxImageBytes)) { this.notice(this.label('invalidImage'), true); return }
    this.pending = true; this.notice(''); this.controller = new AbortController(); this._refresh()
    const cancel = this._button('cancelUpload', () => this.controller?.abort(), this.element)
    this.status.after(cancel)
    const timer = setTimeout(() => this.controller?.abort(), 30000)
    try {
      for (const file of files.slice(0, 10)) {
        const url = await this.options.upload(file, { signal: this.controller.signal })
        if (this.destroyed || this.controller.signal.aborted) return
        this.engine.insertImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') })
      }
      this.notice(this.label('uploaded'))
    } catch (error) {
      if (!this.destroyed) this.notice(this.controller?.signal.aborted ? this.label('uploadCancelled') : error.message || this.label('uploadFailed'), true)
    } finally {
      clearTimeout(timer); cancel.remove(); this.pending = false
      if (!this.destroyed) { this.controller = null; this._refresh() }
    }
  }
  _context() {
    const found = findNode(this.engine.doc, this.engine.nodeId)
    const signature = JSON.stringify([this.engine.nodeId, this.engine.cellIds, found?.node.attrs])
    // A browser selectionchange can arrive between pointer-down and click.
    // Preserve the target controls until the actual context or properties change.
    if (signature === this.contextSignature) { this.context.hidden = !this.context.childNodes.length; return }
    this.contextSignature = signature; this.context.replaceChildren()
    if (found?.node.tag === 'img') {
      this._button('imageProperties', () => this.openImage(), this.context)
      const label = document.createElement('label'); label.textContent = this.label('imageWidth')
      const width = document.createElement('input'); width.type = 'range'; width.min = '32'; width.max = '1200'; width.step = '8'; width.value = found.node.attrs.width || '320'; width.setAttribute('aria-label', this.label('imageWidth'))
      width.addEventListener('change', () => { if (this.canSave) this.engine.updateImage({ width: width.value }) }); label.append(width); this.context.append(label)
    } else if (this.engine.cellIds.length) {
      for (const name of ['addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn', 'merge', 'split', 'header']) this._button(name, () => { if (this.canSave && !this.engine.table(name)) this.notice(this.label('tableSelection')) }, this.context)
      this._button('cellProperties', () => this.openCell(), this.context)
      this._button('deleteTable', () => { if (this.canSave) this.engine.table('delete') }, this.context)
      const tip = document.createElement('small'); tip.textContent = this.label('selectCells'); this.context.append(tip)
    }
    this.context.hidden = !this.context.childNodes.length
  }
  openImage() {
    const found = findNode(this.engine.doc, this.engine.nodeId); if (!found || found.node.tag !== 'img') return
    const panel = this._panel('imageProperties'); if (!panel) return
    const width = this._input(panel, 'imageWidth', found.node.attrs.width || '', 'number'), height = this._input(panel, 'imageHeight', found.node.attrs.height || '', 'number')
    const alt = this._input(panel, 'imageAlt', found.node.attrs.alt || '')
    const caption = found.parent.tag === 'figure' ? found.parent.children.find(c => c.tag === 'figcaption') : null
    const captionText = caption ? (() => { let value = ''; walk(caption, node => { if (node.text !== undefined) value += node.text }); return value })() : ''
    const description = this._input(panel, 'imageCaption', captionText)
    const alignment = this._select('align', ['left', 'center', 'right'].map(a => [a, this.label(a)]), () => {}, panel)
    this._panelActions(() => { const values = { width: width.value, height: height.value, alt: alt.value, caption: description.value, align: alignment.value }; this.closePanel(); this.engine.updateImage(values) })
  }
  openCell() {
    const panel = this._panel('cellProperties'); if (!panel) return
    const color = this._input(panel, 'cellBackground', '#ffffff', 'color'), width = this._input(panel, 'columnWidth', '160', 'number'), border = this._input(panel, 'borderWidth', '1', 'number')
    const align = this._select('align', ['left', 'center', 'right'].map(a => [a, this.label(a)]), () => {}, panel)
    this._panelActions(() => {
      const values = { backgroundColor: color.value, width: `${Math.max(16, Math.min(2000, Number(width.value) || 160))}px`, border: `${Math.max(0, Math.min(10, Number(border.value) || 0))}px solid #999`, textAlign: align.value, padding: '6px' }
      this.closePanel(); this.engine.table('style', values)
    })
  }
  markSaved() { this.saved = true; this.draft.clear(); this.submitted = false; this.engine.markSaved(); this._refresh() }
  destroy() {
    if (this.destroyed) return
    if (this.engine.composing) { this.engine.composing = false; this.engine._readInput('composition') }
    this.field.value = this.engine.getHTML()
    if (this.engine.dirty && !this.saved) this.draft.write(this.field.value)
    this.destroyed = true; this.controller?.abort(); this.cleanups.forEach(cleanup => cleanup()); this.engine.destroy(); this.element.remove()
    Object.assign(this.field, this.originalField)
    if (this.formState) {
      this.formState.editors.delete(this)
      if (this.formState.editors.size) refreshForm(this.formState)
      else { for (const [button, disabled] of this.formState.buttons) button.disabled = disabled; formStates.delete(this.form) }
    }
    this.options.onStateChange?.(this)
  }
}
