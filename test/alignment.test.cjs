const { test, before, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
let Editor, editor
before(async () => {
  const dom = new JSDOM('', { url: 'https://editor.example.test', pretendToBeVisual: true })
  global.window = dom.window; global.document = dom.window.document
  ;({ RichTextEditor: Editor } = await import('../src/index.mjs'))
})
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function createEditor(html) {
  document.body.innerHTML = '<form><textarea name="body"></textarea></form>'
  const field = document.querySelector('textarea'); field.value = html
  editor = new Editor(field, { storage: { getItem: () => null, setItem() {}, removeItem() {} } })
  return editor
}
function selectText(from, to = from) {
  editor.engine.select(from, to)
  document.dispatchEvent(new window.Event('selectionchange'))
}
function chooseAlignment(value) {
  const select = editor.toolbar.querySelector('[aria-label="align"]')
  assert.notEqual(select.value, value, 'a native select needs a different value to fire change')
  select.value = value; select.dispatchEvent(new window.Event('change'))
}

test('alignment menu reflects existing center and one left choice changes it, including undo/redo', () => {
  const e = createEditor('<div style="text-align:center">中央の本文</div><p>次の段落</p>')
  selectText(1)
  const select = e.toolbar.querySelector('[aria-label="align"]')
  assert.equal(select.value, 'center')
  chooseAlignment('left')
  assert.equal(e.body.querySelector('div').style.textAlign, 'left')
  assert.equal(e.body.querySelector('p').getAttribute('style'), null)
  assert.equal(select.value, 'left')
  e.run('undo'); assert.equal(select.value, 'center')
  e.run('redo'); assert.equal(select.value, 'left')
})

test('alignment follows caret, inherited center, and mixed selection without changing sibling paragraphs', () => {
  const e = createEditor('<div style="text-align:center"><p>一段目</p><p style="text-align:right">二段目</p></div><p>三段目</p>')
  const select = e.toolbar.querySelector('[aria-label="align"]')
  selectText(1); assert.equal(select.value, 'center')
  chooseAlignment('left')
  assert.equal(e.body.querySelectorAll('p')[0].style.textAlign, 'left')
  assert.equal(e.body.querySelectorAll('p')[1].style.textAlign, 'right')
  selectText(5); assert.equal(select.value, 'right')
  selectText(0, 7); assert.equal(select.value, '')
  chooseAlignment('center')
  assert.equal(e.body.querySelectorAll('p')[0].style.textAlign, 'center')
  assert.equal(e.body.querySelectorAll('p')[1].style.textAlign, 'center')
  selectText(10); assert.equal(select.value, 'left')
})

test('alignment reflects stylesheet defaults for captions and table headings', () => {
  const style = document.createElement('style'); style.textContent = '.df-editor-body figcaption, .df-editor-body th { text-align: center }'; document.head.append(style)
  try {
    const e = createEditor('<figure class="image"><figcaption>説明</figcaption></figure><table><tbody><tr><th>表題</th></tr></tbody></table>')
    selectText(1); chooseAlignment('left')
    assert.equal(e.body.querySelector('figcaption').style.textAlign, 'left')
    selectText(5)
    assert.equal(e.toolbar.querySelector('[aria-label="align"]').value, 'center')
    chooseAlignment('left')
    assert.equal(e.body.querySelector('th').style.textAlign, 'left')
  } finally { style.remove() }
})

for (const [name, html, tag] of [
  ['list item', '<ul><li style="text-align:right">項目</li><li>次</li></ul>', 'li'],
  ['table cell', '<table><tbody><tr><td style="text-align:center">セル</td><td>次</td></tr></tbody></table>', 'td'],
  ['image caption', '<figure class="image"><figcaption style="text-align:right">説明</figcaption></figure>', 'figcaption'],
]) test(`alignment works on existing ${name} with direct inline text and survives reopening`, () => {
  const e = createEditor(html)
  selectText(1); chooseAlignment('left')
  assert.equal(e.body.querySelector(tag).style.textAlign, 'left')
  assert.equal(e.body.querySelectorAll(tag)[1]?.getAttribute('style') ?? null, null)
  const saved = e.getHTML(); e.destroy()
  assert.equal(createEditor(saved).body.querySelector(tag).style.textAlign, 'left')
})
