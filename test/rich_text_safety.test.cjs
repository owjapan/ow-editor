const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
let safety
before(async () => {
  const dom = new JSDOM('', { url: 'https://stg.example.test' })
  global.window = dom.window; global.document = dom.window.document
  safety = await import('../src/safety.mjs')
})
test('links support web, email and telephone and reject executable or disguised schemes', () => {
  for (const value of ['https://example.test/a', 'http://example.test/', 'mailto:office@example.test', 'tel:0312345678', '/topics/example', '#section']) {
    assert.equal(safety.safeLink(value), value)
  }
  assert.equal(safety.safeLink('www.example.test'), 'https://www.example.test')
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//other.test/x', 'https://name:password@example.test/', 'java\nscript:alert(1)']) assert.throws(() => safety.safeLink(value))
})
test('article sanitizer preserves captions, merged cells and safe visual formatting', () => {
  const result = safety.cleanHTML('<figure class="image image-style-align-right"><img src="/uploads/ckeditor/pictures/1/a.png" width="320" alt="弁当"><figcaption>説明</figcaption></figure><table style="width:100%;border:1px solid #999"><tbody><tr><td colspan="2" style="background-color:#fff59d;text-align:center"><p style="margin-left:40px"><span style="color:red;font-size:24px;font-family:serif">本文</span></p></td></tr></tbody></table>')
  const box = document.createElement('div'); box.innerHTML = result
  assert.equal(box.querySelector('img').getAttribute('width'), '320')
  assert.equal(box.querySelector('figcaption').textContent, '説明')
  assert.equal(box.querySelector('td').colSpan, 2)
  assert.equal(box.querySelector('td').style.textAlign, 'center')
  assert.equal(box.querySelector('p').style.marginLeft, '40px')
  assert.equal(box.querySelector('span').style.fontSize, '24px')
})
test('HTML source and pasted markup cannot introduce active content or external CSS', () => {
  const result = safety.cleanHTML('<base href="https://evil.test"><form action="https://evil.test"><input name="secret"></form><iframe src="https://evil.test"></iframe><svg onload="alert(1)"></svg><img src="data:image/svg+xml,x" onerror="alert(1)"><a href="javascript:alert(1)" target="_blank">x</a><p style="position:fixed;background-image:url(https://evil.test/x);color:red">本文</p><style>body{display:none}</style><script>alert(1)</script>')
  const box = document.createElement('div'); box.innerHTML = result
  assert.equal(box.querySelector('base,form,input,iframe,svg,style,script,[onerror]'), null)
  assert.equal(box.querySelector('img[src^="data:"]'), null)
  assert.equal(box.querySelector('a').hasAttribute('href'), false)
  assert.equal(box.querySelector('a').rel, 'noopener noreferrer')
  assert.equal(box.querySelector('p').style.position, '')
  assert.equal(box.querySelector('p').style.backgroundImage, '')
  assert.equal(box.querySelector('p').style.color, 'red')
})
test('generic image URLs accept each service storage and a separate image CDN without executable URLs', () => {
  for (const value of ['/media/photo.png', 'images/a.webp', 'https://images.example.test/store/a.png', 'http://localhost/photo.png']) assert.equal(safety.safeImageURL(value), value)
  for (const value of ['', '//evil.test/a.png', 'javascript:alert(1)', 'data:image/svg+xml,x', 'blob:https://example.test/a', 'https://user:password@example.test/a.png', '/images/a\\b', '/images/a\nb']) assert.throws(() => safety.safeImageURL(value))
  assert.match(safety.cleanHTML('<img src="https://images.example.test/a.webp" alt="写真">'), /images\.example\.test/)
})
test('draft recovery is scoped to the current original and fails safely when storage is unavailable', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const draft = safety.createDraftStore(storage, '/manage/topics/1', '<p>original</p>')
  assert.equal(draft.read(), null)
  draft.write('<p>unsaved</p>'); assert.equal(draft.read(), '<p>unsaved</p>')
  assert.equal(safety.createDraftStore(storage, '/manage/topics/1', '<p>new server version</p>').read(), null)
  assert.equal(safety.createDraftStore(storage, '/manage/topics/2', '<p>original</p>').read(), null)
  draft.clear(); assert.equal(draft.read(), null)
  const blocked = safety.createDraftStore({ getItem() { throw Error() }, setItem() { throw Error() }, removeItem() { throw Error() } }, 'x', '')
  assert.equal(blocked.read(), null); assert.equal(blocked.write('x'), false); blocked.clear()
})
test('a validation response can keep the submitted draft associated with its original saved body', () => {
  const values = new Map(), storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
  safety.createDraftStore(storage, '/manage/topics/1', '<p>saved</p>').write('<p>submitted</p>')
  safety.createDraftStore(storage, '/manage/topics/1', '<p>submitted</p>', { recoverPosted: true }).write('<p>corrected</p>')
  assert.equal(safety.createDraftStore(storage, '/manage/topics/1', '<p>saved</p>').read(), '<p>corrected</p>')
})
test('reserved UI classes are not accepted as article formatting and size limits count UTF-8 bytes', () => {
  const value = safety.cleanHTML('<figure class="image image-style-align-right df-editor-fullscreen rte-cell-selected"><img src="/uploads/ckeditor/a.png"></figure>')
  assert.match(value, /image image-style-align-right/)
  assert.doesNotMatch(value, /df-editor|rte-/)
  assert.throws(() => safety.ensureHTMLSize('弁'.repeat(800000)), /2 MB/)
  assert.doesNotThrow(() => safety.ensureHTMLSize('弁'.repeat(1000)))
})
