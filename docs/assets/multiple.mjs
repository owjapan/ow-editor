import { RichTextEditor, messages } from '../releases/0.1.1/ow-editor.mjs'
const form = document.getElementById('article-form'), editors = []
try {
  for (const field of form.querySelectorAll('textarea')) editors.push(new RichTextEditor(field, {
    messages, label: field.name === 'summary' ? '概要の編集' : '詳細の編集',
    draftKey: `public-demo:multiple:${field.name}`, enableInitiallyDisabledSubmit: true
  }))
  document.getElementById('init-error').hidden = true
} catch (_) {
  editors.forEach(editor => editor.destroy())
}
form.addEventListener('submit', event => {
  event.preventDefault()
  if (editors.length !== 2 || !editors.every(editor => editor.canSave)) return
  document.getElementById('result').textContent = JSON.stringify(Object.fromEntries(new FormData(form)), null, 2)
  document.getElementById('html-result').open = true
  editors.forEach(editor => editor.markSaved())
  document.getElementById('save-result').textContent = 'ふたつの本文を画面内に保存しました。'
})
