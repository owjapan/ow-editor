import { element } from './document.mjs'

export const emptyCell = (header = false) => element(header ? 'th' : 'td', [element('p', [element('br')])], { style: 'border: 1px solid #a7b1bd; padding: 6px;' })
export function tableGrid(table) {
  const rows = []
  for (const group of table.children) {
    if (group.tag === 'tr') rows.push(group)
    else if (['thead', 'tbody', 'tfoot'].includes(group.tag)) rows.push(...group.children.filter(row => row.tag === 'tr'))
  }
  const grid = [], cells = []
  if (rows.length > 100) throw new Error('表は100行・100列以内にしてください。')
  rows.forEach((row, r) => {
    grid[r] ||= []; let c = 0
    for (const node of row.children.filter(cell => ['td', 'th'].includes(cell.tag))) {
      while (grid[r][c]) c++
      const cell = { node, r, c, h: Math.min(rows.length - r, Number(node.attrs.rowspan) || 1), w: Math.min(100, Number(node.attrs.colspan) || 1) }
      if (c + cell.w > 100) throw new Error('表は100行・100列以内にしてください。')
      cells.push(cell)
      for (let y = r; y < r + cell.h; y++) {
        grid[y] ||= []
        for (let x = c; x < c + cell.w; x++) grid[y][x] = cell
      }
      c += cell.w
    }
  })
  return { rows, cells, grid, height: rows.length, width: Math.max(1, ...grid.map(row => row.length)) }
}
function rebuild(table, cells, height, width) {
  const rows = Array.from({ length: height }, () => element('tr'))
  for (const cell of cells.sort((a, b) => a.r - b.r || a.c - b.c)) {
    if (cell.h < 1 || cell.w < 1 || cell.r >= height || cell.c >= width) continue
    cell.node.attrs.rowspan = cell.h > 1 ? String(cell.h) : undefined
    cell.node.attrs.colspan = cell.w > 1 ? String(cell.w) : undefined
    rows[cell.r].children.push(cell.node)
  }
  const header = []
  for (const row of rows) {
    if (!row.children.length || !row.children.every(cell => cell.tag === 'th')) break
    header.push(row)
  }
  const body = rows.slice(header.length)
  table.children = [...(header.length ? [element('thead', header)] : []), ...(body.length ? [element('tbody', body)] : [])]
}
function styleNode(node, properties) {
  const dom = document.createElement('td'); dom.setAttribute('style', node.attrs.style || '')
  for (const [key, value] of Object.entries(properties)) if (['backgroundColor', 'border', 'width', 'textAlign', 'verticalAlign', 'padding'].includes(key)) dom.style[key] = value
  node.attrs.style = dom.style.cssText
}
export function editTable(table, selectedIds, operation, value) {
  let { cells, grid, height, width } = tableGrid(table)
  const selected = cells.filter(cell => selectedIds.includes(cell.node.id))
  if (!selected.length) return false
  const first = selected[0]
  if (operation === 'style') { selected.forEach(cell => styleNode(cell.node, value)); return true }
  if (operation === 'header') { selected.forEach(cell => { cell.node.tag = cell.node.tag === 'th' ? 'td' : 'th' }) }
  else if (operation === 'merge') {
    const top = Math.min(...selected.map(cell => cell.r)), left = Math.min(...selected.map(cell => cell.c))
    const bottom = Math.max(...selected.map(cell => cell.r + cell.h)), right = Math.max(...selected.map(cell => cell.c + cell.w))
    const included = cells.filter(cell => cell.r < bottom && cell.r + cell.h > top && cell.c < right && cell.c + cell.w > left)
    if (included.length < 2 || included.some(cell => cell.r < top || cell.c < left || cell.r + cell.h > bottom || cell.c + cell.w > right)) return false
    const main = grid[top][left]
    main.node.children = included.flatMap(cell => cell.node.children)
    main.w = right - left; main.h = bottom - top
    cells = cells.filter(cell => !included.includes(cell) || cell === main)
  } else if (operation === 'split') {
    for (const cell of selected) {
      for (let r = cell.r; r < cell.r + cell.h; r++) for (let c = cell.c; c < cell.c + cell.w; c++) if (r !== cell.r || c !== cell.c) cells.push({ node: emptyCell(cell.node.tag === 'th'), r, c, h: 1, w: 1 })
      cell.w = 1; cell.h = 1
    }
  } else if (['addRowBefore', 'addRowAfter', 'addColumnBefore', 'addColumnAfter'].includes(operation)) {
    const row = operation.includes('Row'), before = operation.endsWith('Before')
    const start = row ? 'r' : 'c', span = row ? 'h' : 'w'
    const index = first[start] + (before ? 0 : first[span])
    if ((row ? height : width) >= 100) return false
    for (const cell of cells) {
      if (cell[start] >= index) cell[start]++
      else if (cell[start] + cell[span] > index) cell[span]++
    }
    for (let other = 0; other < (row ? width : height); other++) {
      const r = row ? index : other, c = row ? other : index
      if (!cells.some(cell => r >= cell.r && r < cell.r + cell.h && c >= cell.c && c < cell.c + cell.w)) cells.push({ node: emptyCell(!row && r === 0 && grid[0]?.every(cell => cell?.node.tag === 'th')), r, c, h: 1, w: 1 })
    }
    if (row) height++; else width++
  } else if (['deleteRow', 'deleteColumn'].includes(operation)) {
    const row = operation === 'deleteRow', start = row ? 'r' : 'c', span = row ? 'h' : 'w', index = first[start]
    if ((row ? height : width) <= 1) return false
    for (const cell of cells) {
      if (cell[start] > index) cell[start]--
      else if (cell[start] + cell[span] > index) cell[span]--
    }
    cells = cells.filter(cell => cell[span] > 0)
    if (row) height--; else width--
  } else return false
  rebuild(table, cells, height, width)
  return true
}
