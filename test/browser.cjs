const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const puppeteer = require('puppeteer-core')
const { createServer } = require('../scripts/serve.cjs')
const results = path.resolve(__dirname, '../test-results')
let browser, server, origin
before(async () => {
  await fs.mkdir(path.join(results, 'downloads'), { recursive: true })
  server = createServer('/ow-editor')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}/ow-editor/`
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(results, 'chrome-config'), XDG_CACHE_HOME: path.join(results, 'chrome-cache') },
    args: ['--no-sandbox', '--disable-dev-shm-usage'] })
})
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)) })
async function pageAt(file, use) {
  const page = await browser.newPage(), errors = [], failures = [], posts = []
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) failures.push(response.url()) })
  page.on('request', request => { if (request.method() !== 'GET') posts.push(request.url()) })
  page.on('dialog', dialog => dialog.accept())
  try {
    await page.goto(origin + file, { waitUntil: 'networkidle0' })
    await use(page)
    assert.deepEqual(errors, [], 'No browser script error')
    assert.deepEqual(failures, [], 'No missing page resources')
    assert.deepEqual(posts, [], 'Samples never upload content')
  } finally { await page.close() }
}
test('feature page and links work under the GitHub Pages project path on desktop and mobile', async () => {
  await pageAt('', async page => {
    assert.match(await page.title(), /機能紹介/)
    assert.equal(await page.$$eval('.feature', items => items.length), 6)
    await page.screenshot({ path: path.join(results, 'features-desktop.png'), fullPage: true })
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: path.join(results, 'features-mobile.png'), fullPage: true })
    await page.click('a.primary[href="demo.html"]')
    await page.waitForSelector('.df-editor-body[contenteditable=true]')
    assert.equal(new URL(page.url()).pathname, '/ow-editor/demo.html')
  })
})
test('article demo edits, adds a sample image and downloads sanitized HTML without an upload API', async () => {
  await pageAt('demo.html', async page => {
    await page.waitForSelector('.df-editor-body[contenteditable=true]')
    assert.equal(await page.$eval('[data-rte-action=image]', e => e.disabled), true)
    await page.click('.df-editor-body'); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control'); await page.keyboard.type('追加した本文')
    await page.click('#sample-image')
    await page.waitForSelector('.df-editor-body img')
    assert.match(await page.$eval('.df-editor-body img', e => e.src), /sample-landscape\.svg$/)
    await page.click('[data-rte-action=imageProperties]')
    await page.$eval('.df-editor-panel input[type=number]', input => { input.value = '320'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    await page.click('[data-rte-apply]')
    const client = await page.createCDPSession()
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(results, 'downloads') })
    await page.click('button[type=submit]')
    await page.waitForFunction(() => document.getElementById('save-result').textContent.includes('ダウンロードを開始'))
    const html = await page.$eval('#result', e => e.textContent)
    assert.match(html, /追加した本文/); assert.match(html, /width="320"/)
    assert.equal(await page.$eval('#html-result', e => e.open), true)
    await page.screenshot({ path: path.join(results, 'demo-desktop.png'), fullPage: true })
  })
})
test('source editing blocks export, cancel retains text and apply removes executable HTML', async () => {
  await pageAt('demo.html', async page => {
    await page.waitForSelector('.df-editor-body[contenteditable=true]')
    const before = await page.$eval('#demo-body', e => e.value)
    await page.click('[data-rte-action=source]')
    assert.equal(await page.$eval('button[type=submit]', e => e.disabled), true)
    await page.$eval('[data-rte-source]', e => { e.value = '<p>取消する内容</p>' })
    await page.click('[data-rte-action=cancel]')
    assert.equal(await page.$eval('#demo-body', e => e.value), before)
    await page.click('[data-rte-action=source]')
    await page.$eval('[data-rte-source]', e => { e.value = '<p>適用した本文<script>window.__unsafe=1</script></p>' })
    await page.click('[data-rte-apply]')
    assert.equal(await page.$eval('.df-editor-body', e => e.textContent), '適用した本文')
    assert.equal(await page.evaluate(() => window.__unsafe), undefined)
  })
})
test('ES module demo keeps two drafts distinct and blocks the whole form during one source edit', async () => {
  await pageAt('multiple.html', async page => {
    await page.waitForFunction(() => document.querySelectorAll('.df-editor-body[contenteditable=true]').length === 2)
    for (const [label, text] of [['概要の編集', '概要の追記'], ['詳細の編集', '詳細の追記']]) {
      await page.click(`section[aria-label="${label}"] .df-editor-body`); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control'); await page.keyboard.type(text)
    }
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('ow-editor:draft:public-demo:multiple:')).length), 2)
    await page.click('section[aria-label="概要の編集"] [data-rte-action=source]')
    assert.equal(await page.$eval('button[type=submit]', e => e.disabled), true)
    await page.click('section[aria-label="詳細の編集"] .df-editor-body')
    assert.equal(await page.$eval('button[type=submit]', e => e.disabled), true)
    await page.click('section[aria-label="概要の編集"] [data-rte-action=cancel]')
    await page.click('button[type=submit]')
    await page.waitForFunction(() => document.getElementById('save-result').textContent.includes('保存しました'))
    const result = await page.$eval('#result', e => e.textContent)
    assert.match(result, /概要の追記/); assert.match(result, /詳細の追記/)
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('ow-editor:draft:public-demo:multiple:')).length), 0)
  })
})
test('both editor samples remain usable without horizontal overflow on a narrow viewport', async () => {
  for (const file of ['demo.html', 'multiple.html']) await pageAt(file, async page => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
    await page.waitForSelector('.df-editor-body[contenteditable=true]')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: path.join(results, file.replace('.html', '-mobile.png')), fullPage: true })
  })
})
