// Кадр (цвет на пиксель) → строки отрезков для терминала. Клетка — два пикселя по вертикали:
// верхний рисуется цветом символа `▀`, нижний — цветом фона. Соседние клетки с одинаковой парой
// цветов сливаются в один отрезок.
//
// Бюджет жёсткий. Движок выгружает игру целиком, если дерево кадра сериализуется длиннее 100 000
// символов (docs/probes.md): двухцветный отрезок стоит ~100 символов, одноцветный ~64. Поэтому
// клетка с одинаковыми половинами рисуется одноцветным `█`, а кадр, не влезающий в бюджет,
// огрубляется: сначала цвета (соседи начинают совпадать), в крайнем случае — склейкой отрезков.

export type Run = { text: string; fg: string; bg?: string }
export type Packed = { rows: Run[][]; cost: number; level: number }

// замеры: 1020 двухцветных отрезков проходят, 1105 нет; 1530 одноцветных проходят, 1870 нет
const COST_DOUBLE = 100
const COST_SINGLE = 64
const COST_ROW = 40
// остаток до 100 000 — хотбар, строка статуса и запас на неточность оценки
export const BUDGET = 78_000

const hexCache = new Map<number, string>()
const hex = (c: number): string => {
  let s = hexCache.get(c)
  if (s === undefined) {
    s = '#' + c.toString(16).padStart(6, '0')
    if (hexCache.size < 4096) hexCache.set(c, s)
  }
  return s
}

// округление каждого канала до шага 2^(8−bits)
function quantize(c: number, bits: number): number {
  if (bits >= 8) return c
  const step = 1 << (8 - bits)
  const q = (v: number) => Math.min(255, Math.round(v / step) * step)
  return (q((c >> 16) & 255) << 16) | (q((c >> 8) & 255) << 8) | q(c & 255)
}

type Cell = { top: number; bottom: number; len: number }

function pack(buf: Uint32Array, w: number, rows: number, bits: number): { lines: Cell[][]; cost: number } {
  const lines: Cell[][] = []
  let cost = 0
  for (let y = 0; y < rows; y++) {
    const line: Cell[] = []
    let last: Cell | undefined
    for (let x = 0; x < w; x++) {
      const top = quantize(buf[y * 2 * w + x], bits)
      const bottom = quantize(buf[(y * 2 + 1) * w + x], bits)
      if (last && last.top === top && last.bottom === bottom) last.len++
      else {
        last = { top, bottom, len: 1 }
        line.push(last)
        cost += top === bottom ? COST_SINGLE : COST_DOUBLE
      }
    }
    cost += COST_ROW + w
    lines.push(line)
  }
  return { lines, cost }
}

const costOf = (lines: Cell[][], w: number) =>
  lines.reduce((sum, line) => sum + COST_ROW + w + line.reduce((n, c) => n + (c.top === c.bottom ? COST_SINGLE : COST_DOUBLE), 0), 0)

// buf — w × (rows·2) пикселей
export function toRows(buf: Uint32Array, w: number, rows: number, budget = BUDGET): Packed {
  let level = 0
  let { lines, cost } = pack(buf, w, rows, 8)
  for (const bits of [5, 4, 3]) {
    if (cost <= budget) break
    level++
    ;({ lines, cost } = pack(buf, w, rows, bits))
  }
  // крайняя мера: склеиваем отрезки попарно (цвета левого), начиная с самых дробных строк
  while (cost > budget) {
    level++
    let widest = 0
    for (let i = 1; i < lines.length; i++) if (lines[i].length > lines[widest].length) widest = i
    const line = lines[widest]
    if (line.length <= 1) break
    const folded: Cell[] = []
    for (let i = 0; i < line.length; i += 2) {
      const a = line[i]
      const b = line[i + 1]
      folded.push(b ? { top: a.top, bottom: a.bottom, len: a.len + b.len } : a)
    }
    lines[widest] = folded
    cost = costOf(lines, w)
  }
  return {
    rows: lines.map(line => line.map(c => (c.top === c.bottom ? { text: '█'.repeat(c.len), fg: hex(c.top) } : { text: '▀'.repeat(c.len), fg: hex(c.top), bg: hex(c.bottom) }))),
    cost,
    level,
  }
}
