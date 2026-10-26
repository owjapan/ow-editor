const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const webpack = require('webpack')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const messages = require('../src/locales/ja.json')
if (!fs.readFileSync(path.join(root, 'src/index.mjs'), 'utf8').includes(`VERSION = '${pkg.version}'`)) throw Error('Source/package version mismatch')
const output = { path: path.join(root, 'dist'), clean: false }
fs.rmSync(output.path, { recursive: true, force: true })
const common = { mode: 'production', target: ['web', 'es2022'], devtool: false, performance: { hints: false } }
const plugins = () => [new webpack.DefinePlugin({ __EDITOR_JA_MESSAGES__: JSON.stringify(messages) })]
const configs = [
  { ...common, name: 'browser', entry: path.join(root, 'src/browser.mjs'),
    output: { ...output, filename: 'ow-editor.js', library: { name: 'OWEditor', type: 'umd' }, globalObject: 'globalThis' },
    module: { rules: [{ test: /\.scss$/, use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'] }] },
    plugins: [...plugins(), new MiniCssExtractPlugin({ filename: 'ow-editor.css' })] },
  { ...common, name: 'module', entry: path.join(root, 'src/standalone.mjs'), experiments: { outputModule: true },
    output: { ...output, filename: 'ow-editor.mjs', library: { type: 'module' } }, plugins: plugins() },
]
webpack(configs, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ colors: false })); process.exitCode = 1; return }
  console.log(stats.toString({ colors: false, modules: false, chunks: false }))
  try {
    const files = {}
    for (const name of ['ow-editor.js', 'ow-editor.mjs', 'ow-editor.css']) {
      const bytes = fs.readFileSync(path.join(output.path, name))
      for (const value of ['/manage/upload_topics_img', '/uploads/ckeditor/', '.main-panel']) if (bytes.includes(value)) throw Error('Application adapter in distribution')
      files[name] = { bytes: bytes.length, integrity: `sha384-${crypto.createHash('sha384').update(bytes).digest('base64')}` }
    }
    fs.copyFileSync(path.join(root, 'node_modules/dompurify/LICENSE'), path.join(output.path, 'DOMPurify-LICENSE.txt'))
    fs.writeFileSync(path.join(output.path, 'release.json'), JSON.stringify({ name: 'OWEditor', version: pkg.version, status: 'preview', files }, null, 2) + '\n')
    const published = path.join(root, 'docs/releases', pkg.version)
    if (process.argv.includes('--check')) {
      for (const name of fs.readdirSync(output.path)) {
        if (!fs.existsSync(path.join(published, name)) || !fs.readFileSync(path.join(output.path, name)).equals(fs.readFileSync(path.join(published, name)))) throw Error(`Committed distribution differs: ${name}`)
      }
      console.log('Committed distribution matches source.')
    } else {
      fs.mkdirSync(published, { recursive: true })
      for (const name of fs.readdirSync(output.path)) fs.copyFileSync(path.join(output.path, name), path.join(published, name))
      console.log(`Prepared preview: docs/releases/${pkg.version}/`)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
})
