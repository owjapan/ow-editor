const { test, before, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
let RichTextEditor, instance
before(async () => {
  const dom = new JSDOM('', { url: 'https://stg.example.test/manage/topics/1/edit', pretendToBeVisual: true })
  global.window = dom.window; global.document = dom.window.document
  window.confirm = () => true
  ;({ RichTextEditor } = await import('../src/index.mjs'))
})
afterEach(() => { instance?.destroy(); instance = null; document.body.innerHTML = ''; window.sessionStorage.clear() })
function mount(options = {}) {
  document.body.innerHTML = '<form action="/manage/topics/1"><input type="submit" disabled><textarea id="topic_body" readonly></textarea><button type="submit" disabled>保存</button></form>'
  const field = document.querySelector('textarea'); field.value = '<p>元の本文</p>'
  instance = new RichTextEditor(field, { enableInitiallyDisabledSubmit: true, ...options })
  return { field, form: field.form, editor: instance }
}
test('standalone library mounts without license, preserves untouched HTML and restores textarea on destroy', () => {
  const { field, form, editor } = mount()
  assert.equal(field.hidden, true); assert.equal(editor.canSave, true)
  assert.ok([...form.querySelectorAll('[type=submit]')].every(button => !button.disabled))
  assert.equal(field.value, '<p>元の本文</p>')
  editor.engine.select(0, 2); editor.engine.command('bold')
  assert.match(field.value, /<strong>元の<\/strong>/)
  editor.destroy()
  assert.equal(field.hidden, false); assert.equal(field.readOnly, true)
  assert.equal(document.querySelector('.df-editor'), null)
})
test('HTML source editing blocks saving, cancellation retains body and applying sanitizes content', () => {
  const { editor, field, form } = mount()
  editor.openSource()
  assert.equal(editor.canSave, false)
  assert.equal(form.dispatchEvent(new window.Event('submit', { cancelable: true })), false)
  document.querySelector('[data-rte-source]').value = '<p>変更</p>'
  editor.closePanel(); assert.equal(field.value, '<p>元の本文</p>')
  editor.openSource()
  document.querySelector('[data-rte-source]').value = '<p>変更<script>alert(1)</script></p>'
  document.querySelector('[data-rte-apply]').click()
  assert.equal(editor.canSave, true); assert.match(field.value, /変更/); assert.doesNotMatch(field.value, /script/)
})
test('pending uploads block save, failures preserve text, and destruction cancels a late upload', async () => {
  let resolve, signal
  const { editor, field, form } = mount({ upload: (_file, options) => { signal = options.signal; return new Promise(r => { resolve = r }) } })
  const file = new window.File(['png'], 'a.png', { type: 'image/png' })
  const pending = editor.uploadImages([file])
  assert.equal(editor.canSave, false)
  assert.equal(form.dispatchEvent(new window.Event('submit', { cancelable: true })), false)
  editor.destroy(); assert.equal(signal.aborted, true)
  resolve('/uploads/ckeditor/attachments/1/a.png'); await pending
  assert.equal(field.value, '<p>元の本文</p>'); assert.equal(document.querySelector('img'), null)
})
test('composition blocks submit and a local draft is offered without applying itself', () => {
  const { editor, form } = mount()
  editor.engine.root.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }))
  assert.equal(editor.canSave, false)
  assert.equal(editor.engine.root.getAttribute('contenteditable'), 'true')
  assert.equal(form.dispatchEvent(new window.Event('submit', { cancelable: true })), false)
  editor.engine.root.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }))
  editor.engine.setHTML('<p>未保存</p>'); editor.destroy()
  const field = document.querySelector('textarea'); field.value = '<p>元の本文</p>'
  instance = new RichTextEditor(field)
  assert.equal(field.value, '<p>元の本文</p>')
  assert.equal(document.querySelector('[data-rte-draft]').hidden, false)
  document.querySelector('[data-rte-restore]').click()
  assert.match(field.value, /未保存/)
})
test('safe rendering output is available separately from byte-preserving storage output', () => {
  const { editor } = mount()
  editor.destroy()
  const field = document.querySelector('textarea'); field.value = '<p>既存本文<script>alert(1)</script></p>'
  instance = new RichTextEditor(field)
  assert.equal(instance.getHTML(), field.value)
  assert.doesNotMatch(instance.getSafeHTML(), /script/)
  assert.equal(instance.body.querySelector('script'), null)
})
test('an unconfigured upload has no default endpoint and cannot trigger a network request', async () => {
  const { editor, field } = mount()
  const button = editor.element.querySelector('[data-rte-action=image]')
  assert.equal(button.disabled, true)
  await editor.uploadImages([new window.File(['png'], 'a.png', { type: 'image/png' })])
  assert.equal(editor.pending, false)
  assert.equal(field.value, '<p>元の本文</p>')
})
test('host upload callbacks can return an image CDN URL while invalid file types are rejected before upload', async () => {
  let calls = 0
  const { editor, field } = mount({ upload: async () => { calls++; return 'https://images.example.test/articles/a.webp' } })
  await editor.uploadImages([new window.File(['html'], 'a.html', { type: 'text/html' })])
  assert.equal(calls, 0)
  await editor.uploadImages([new window.File(['webp'], 'a.webp', { type: 'image/webp' })])
  assert.equal(calls, 1)
  assert.match(field.value, /https:\/\/images\.example\.test\/articles\/a.webp/)
})
test('multiple fields on one form have independent drafts and collectively block unsafe submit', () => {
  document.body.innerHTML = '<form action="/articles/7"><textarea name="title_html"></textarea><textarea name="body_html"></textarea><button type="submit">保存</button></form>'
  const fields = [...document.querySelectorAll('textarea')], form = fields[0].form
  fields.forEach(field => { field.value = '<p>本文</p>' })
  instance = new RichTextEditor(fields[0])
  const other = new RichTextEditor(fields[1])
  try {
    assert.notEqual(instance.draft.key, other.draft.key)
    instance.engine.setHTML('<p>見出しの下書き</p>'); other.engine.setHTML('<p>本文の下書き</p>')
    assert.match(instance.draft.read(), /見出し/); assert.match(other.draft.read(), /本文/)
    instance.openSource(); other._refresh()
    assert.equal(form.querySelector('button[type=submit]').disabled, true)
    assert.equal(form.dispatchEvent(new window.Event('submit', { cancelable: true })), false)
    assert.equal(other.submitted, false)
    instance.closePanel()
    assert.equal(form.querySelector('button[type=submit]').disabled, false)
    other.destroy()
    assert.equal(form.querySelector('button[type=submit]').disabled, false)
    instance.destroy()
    assert.equal(fields[0].readOnly, false); assert.equal(fields[0].hidden, false)
    assert.equal(form.querySelector('button[type=submit]').disabled, false)
  } finally { other.destroy() }
})
test('host disabled submit controls are respected unless explicitly delegated to the editor', () => {
  const { editor, form } = mount({ enableInitiallyDisabledSubmit: false })
  assert.equal(form.querySelector('[type=submit]').disabled, true)
  editor.destroy()
  assert.equal(form.querySelector('[type=submit]').disabled, true)
})
test('callbacks expose changes and save availability without requiring a Rails form', () => {
  const changes = [], states = []
  const { editor } = mount({ onChange: editor => changes.push(editor.getHTML()), onStateChange: editor => states.push(editor.canSave) })
  editor.engine.setHTML('<p>別サービスの本文</p>')
  editor.openSource(); editor.closePanel()
  assert.match(changes.at(-1), /別サービス/)
  assert.deepEqual(states, [true, false, true])
  editor.destroy(); assert.equal(states.at(-1), false)
})
test('an image settings button remains connected during selection changes so pointer clicks can finish', () => {
  const { editor } = mount()
  editor.engine.insertImage({ src: 'https://images.example.test/a.png', alt: '写真' })
  const target = editor.context.querySelector('[data-rte-action=imageProperties]')
  assert.ok(target)
  document.dispatchEvent(new window.Event('selectionchange'))
  assert.equal(target.isConnected, true)
  target.click()
  assert.equal(editor.activePanel, 'imageProperties')
})
