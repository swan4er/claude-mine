import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { newGame, tick, eyeOf } from '../hooks/game/game.ts'
import { renderFrame } from '../hooks/game/render.ts'
import { BUDGET, toRows } from '../hooks/game/runs.ts'

function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const width = (row: { text: string }[]) => row.reduce((n, r) => n + [...r.text].length, 0)

describe('отрезки', () => {
  test('одинаковые половины — одноцветный █, разные — ▀ с фоном; соседи сливаются', () => {
    // 4 клетки × 1 строка: две одинаковые красные, затем красный над синим, затем синий
    const R = 0xff0000, B = 0x0000ff
    const buf = Uint32Array.of(R, R, R, B, /* нижние: */ R, R, B, B)
    const { rows, level } = toRows(buf, 4, 1)
    assert.equal(level, 0)
    assert.deepEqual(rows[0], [
      { text: '██', fg: '#ff0000' },
      { text: '▀', fg: '#ff0000', bg: '#0000ff' },
      { text: '█', fg: '#0000ff' },
    ])
  })

  test('каждая строка ровно w клеток, строк ровно rows', () => {
    const rand = seeded(1)
    for (const [w, rows] of [[140, 17], [80, 6], [1, 1], [33, 9]]) {
      const buf = Uint32Array.from({ length: w * rows * 2 }, () => Math.floor(rand() * 0xffffff))
      const packed = toRows(buf, w, rows)
      assert.equal(packed.rows.length, rows)
      for (const row of packed.rows) assert.equal(width(row), w)
    }
  })

  test('худший случай — цветной шум — всё равно влезает в бюджет', () => {
    const rand = seeded(2)
    for (const [w, rows] of [[140, 17], [200, 28], [300, 38]]) {
      const buf = Uint32Array.from({ length: w * rows * 2 }, () => Math.floor(rand() * 0xffffff))
      const packed = toRows(buf, w, rows)
      assert.ok(packed.cost <= BUDGET, `${w}×${rows}: стоимость ${packed.cost}`)
      assert.ok(packed.level > 0)
      for (const row of packed.rows) assert.equal(width(row), w)
    }
  })

  test('настоящие кадры мира: в бюджете, и обычно без огрубления', () => {
    const rand = seeded(3)
    let exact = 0
    let worst = 0
    const total = 60
    for (let i = 0; i < total; i++) {
      const g = newGame(1 + (i % 6))
      for (let k = 0; k < 20; k++) tick(g)
      g.player.x += (rand() - 0.5) * 30
      g.player.z += (rand() - 0.5) * 30
      g.player.y += 6 + rand() * 6
      const cam = { ...eyeOf(g.player), yaw: rand() * 6.28, pitch: (rand() - 0.55) * 1.4 }
      const frame = renderFrame(g.world, cam, 140, 34, { crosshair: true, squash: 1.5 })
      const packed = toRows(frame, 140, 17)
      assert.ok(packed.cost <= BUDGET, `кадр ${i}: стоимость ${packed.cost}`)
      worst = Math.max(worst, packed.cost)
      if (packed.level === 0) exact++
    }
    assert.ok(exact >= total * 0.8, `без огрубления ${exact} из ${total}, худшая стоимость ${worst}`)
  })
})
