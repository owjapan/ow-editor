(() => {
  const form = document.getElementById('demo-form'), field = document.getElementById('demo-body')
  const imageButton = document.getElementById('sample-image'), htmlButton = document.getElementById('show-html')
  let editor
  try {
    editor = new OWEditor.RichTextEditor(field, {
      messages: OWEditor.messages, draftKey: 'public-demo:article:body', enableInitiallyDisabledSubmit: true,
      onStateChange: instance => { imageButton.disabled = !instance.canSave; htmlButton.disabled = !instance.canSave }
    })
    document.getElementById('init-error').hidden = true
  } catch (_) { return }
  function showHTML() {
    document.getElementById('result').textContent = editor.getSafeHTML()
    document.getElementById('html-result').open = true
  }
  htmlButton.addEventListener('click', showHTML)
  imageButton.addEventListener('click', () => {
    if (!editor.canSave) return
    editor.body.focus(); editor.engine.select(Number.MAX_SAFE_INTEGER)
    editor.engine.insertImage({ src: new URL('assets/sample-landscape.svg', window.location.href).href, alt: '山と湖のサンプルイラスト', width: 480 })
  })
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (!editor.canSave) return
    const html = editor.getSafeHTML()
    const content = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OWEditorで編集した記事</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.8 system-ui,sans-serif}img,table{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}figure{margin:20px 0}figcaption{color:#566;text-align:center}</style></head><body>' + html + '</body></html>'
    const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'ow-editor-article.html'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showHTML(); editor.markSaved()
    document.getElementById('save-result').textContent = 'HTMLのダウンロードを開始しました。'
  })
})()
