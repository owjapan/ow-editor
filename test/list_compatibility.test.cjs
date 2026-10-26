const { test, before, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
let Engine, engine
before(async () => {
  const dom = new JSDOM('', { url: 'https://editor.example.test', pretendToBeVisual: true })
  global.window = dom.window; global.document = dom.window.document
  ;({ EditorEngine: Engine } = await import('../src/engine.mjs'))
})
afterEach(() => { engine?.destroy(); engine = null; document.body.innerHTML = '' })
function create(html) {
  const root = document.createElement('div'); document.body.append(root)
  engine = new Engine(root, { html }); return engine
}

for (const [command, tag] of [['bulletList', 'ul'], ['orderedList', 'ol']]) {
  test(`${command} applies to text remaining in an image figure and can be removed again`, () => {
    const original = '<figure class="image image_resized" style="width:30%;margin-left:auto"><strong>項目</strong></figure><figure class="image" style="width:50%"><img src="/images/sample.png"></figure><p>対象外</p>'
    const e = create(original)
    const imageBefore = e.root.querySelector('figure img').parentElement.outerHTML
    e.select(1)
    assert.equal(e.command(command), true)
    assert.equal(e.root.querySelectorAll(`${tag} > li`).length, 1)
    assert.equal(e.root.querySelector(`${tag} strong`).textContent, '項目')
    const block = e.root.querySelector(`${tag} > li > div`)
    assert(block)
    assert.equal(block.className, '')
    assert.equal(block.style.width, '')
    assert.equal(block.style.marginLeft, '')
    assert.equal(e.root.querySelector('figure').outerHTML, imageBefore)
    assert.equal(e.root.lastElementChild.textContent, '対象外')
    assert.equal(e.command(command), true)
    assert.equal(e.root.querySelector(tag), null)
    assert.equal(e.root.firstElementChild.tagName, 'DIV')
    e.undo(); assert.equal(e.root.querySelectorAll(`${tag} > li`).length, 1)
    e.undo(); assert.equal(e.getHTML(), original)
  })
}

test('list selection includes both normal paragraphs and image-less figure text without skipping selected text', () => {
  const e = create('<p>最初</p><figure class="image">次</figure><p>対象外</p>')
  e.select(0, 4)
  assert.equal(e.command('bulletList'), true)
  assert.deepEqual([...e.root.querySelectorAll('ul > li')].map(item => item.textContent), ['最初', '次'])
  assert.equal(e.root.lastElementChild.tagName, 'P')
  assert.equal(e.root.lastElementChild.textContent, '対象外')
})
