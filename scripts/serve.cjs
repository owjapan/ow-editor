const { createServer } = require('node:http')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../docs')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }
function serve(req, res) {
  let file
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
    if (!file.startsWith(root + path.sep)) throw Error()
  } catch (_) { res.writeHead(400); res.end('Bad request'); return }
  readFile(file).then(bytes => {
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' }); res.end(bytes)
  }, () => { res.writeHead(404); res.end('Not found') })
}
module.exports = { createServer: (prefix = '') => createServer((req, res) => {
  if (prefix) {
    if (!req.url.startsWith(prefix + '/')) { res.writeHead(404); res.end('Not found'); return }
    req.url = req.url.slice(prefix.length)
  }
  serve(req, res)
}) }
if (require.main === module) module.exports.createServer().listen(4173, '127.0.0.1', () => console.log('OWEditor samples: http://127.0.0.1:4173/'))
