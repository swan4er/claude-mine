// Снимок терминала (tmux capture-pane -e -p) → PNG: проверяет весь путь «рендер → отрезки → терминал».
// Понимает только то, что рисует игра: цвета текста и фона (24-битные и палитру на 256), символы ▀ и █.
// node tools/ansi2png.ts <вход.ansi> <выход.png> [масштаб]
import { readFileSync, writeFileSync } from 'node:fs'
import { encodePng } from './png.ts'

// палитра xterm на 256 цветов: 16 системных, куб 6×6×6, 24 серых
const BASE16 = [0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff]
function xterm(n: number): number {
  if (n < 16) return BASE16[n]
  if (n >= 232) { const v = 8 + (n - 232) * 10; return (v << 16) | (v << 8) | v }
  const c = n - 16
  const level = (i: number) => (i === 0 ? 0 : 55 + i * 40)
  return (level(Math.floor(c / 36)) << 16) | (level(Math.floor(c / 6) % 6) << 8) | level(c % 6)
}

const [input, output, scaleArg] = process.argv.slice(2)
const scale = Number(scaleArg) || 8
const lines = readFileSync(input, 'utf8').split('\n')
const rows: { top: number; bottom: number }[][] = []
for (const line of lines) {
  if (!line.includes('▀') && !line.includes('█')) continue
  const cells: { top: number; bottom: number }[] = []
  let fg = 0xcccccc
  let bg = 0x000000
  const re = /\x1b\[([0-9;]*)m|([^\x1b])/gu
  for (const m of line.matchAll(re)) {
    if (m[1] !== undefined) {
      const p = m[1].split(';').map(Number)
      for (let i = 0; i < p.length; i++) {
        if (p[i] === 38 && p[i + 1] === 2) { fg = (p[i + 2] << 16) | (p[i + 3] << 8) | p[i + 4]; i += 4 }
        else if (p[i] === 48 && p[i + 1] === 2) { bg = (p[i + 2] << 16) | (p[i + 3] << 8) | p[i + 4]; i += 4 }
        else if (p[i] === 38 && p[i + 1] === 5) { fg = xterm(p[i + 2]); i += 2 }
        else if (p[i] === 48 && p[i + 1] === 5) { bg = xterm(p[i + 2]); i += 2 }
        else if (p[i] === 0 || Number.isNaN(p[i])) { fg = 0xcccccc; bg = 0 }
        else if (p[i] === 39) fg = 0xcccccc
        else if (p[i] === 49) bg = 0
      }
    } else if (m[2] === '▀') cells.push({ top: fg, bottom: bg })
    else if (m[2] === '█') cells.push({ top: fg, bottom: fg })
    else cells.push({ top: bg, bottom: bg })
  }
  if (cells.filter(c => c.top !== 0 || c.bottom !== 0).length > 20) rows.push(cells)
}
const w = Math.max(...rows.map(r => r.length))
const buf = new Uint32Array(w * rows.length * 2)
rows.forEach((cells, y) => cells.forEach((c, x) => { buf[y * 2 * w + x] = c.top; buf[(y * 2 + 1) * w + x] = c.bottom }))
writeFileSync(output, encodePng(buf, w, rows.length * 2, scale))
console.log(`${rows.length} строк × ${w} колонок → ${output}`)
