import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AIR, STONE } from '../hooks/game/blocks.ts'
import { cast, lookDir, pick } from '../hooks/game/raycast.ts'
import { renderFrame, type Camera } from '../hooks/game/render.ts'
import { findSpawn, getBlock, newWorld, setBlock, surfaceHeight } from '../hooks/game/world.ts'

const deg = (d: number) => (d * Math.PI) / 180
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('луч', () => {
  test('вниз попадает в верхнюю грань поверхности, вверх — в небо', () => {
    const world = newWorld(1)
    const s = findSpawn(world)
    const down = cast(world, s.x, s.y + 1.6, s.z, 0, -1, 0, 20)
    assert.ok(down)
    assert.equal(down.y, s.y - 1)
    assert.deepEqual([down.nx, down.ny, down.nz], [0, 1, 0])
    assert.ok(Math.abs(down.dist - 1.6) < 1e-9)
    assert.equal(cast(world, s.x, s.y + 1.6, s.z, 0, 1, 0, 100), undefined)
  })

  test('совпадает с перебором мелким шагом на случайных лучах', () => {
    const world = newWorld(5)
    const rand = seeded(11)
    const s = findSpawn(world)
    let hits = 0
    for (let i = 0; i < 400; i++) {
      const [dx, dy, dz] = lookDir(rand() * Math.PI * 2, (rand() - 0.6) * 1.4)
      const ox = s.x + (rand() - 0.5) * 6
      const oz = s.z + (rand() - 0.5) * 6
      const oy = surfaceHeight(5, Math.floor(ox), Math.floor(oz)) + 1.62 + rand() * 3
      if (getBlock(world, Math.floor(ox), Math.floor(oy), Math.floor(oz)) !== AIR) continue
      const hit = cast(world, ox, oy, oz, dx, dy, dz, 30)
      // эталон: идём шагом в тысячную блока
      let expected: number | undefined
      for (let t = 0; t <= 30; t += 0.001) {
        const id = getBlock(world, Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t))
        if (id !== AIR) { expected = t; break }
      }
      if (expected === undefined) {
        assert.equal(hit, undefined)
        continue
      }
      assert.ok(hit, `луч ${i} должен попасть на ${expected}`)
      assert.ok(Math.abs(hit.dist - expected) < 0.01, `луч ${i}: ${hit.dist} против ${expected}`)
      // нормаль указывает на соседний пустой блок со стороны игрока
      assert.equal(Math.abs(hit.nx) + Math.abs(hit.ny) + Math.abs(hit.nz), 1)
      hits++
    }
    assert.ok(hits > 150, `попаданий ${hits}`)
  })

  test('pick возвращает копию: следующий луч её не портит', () => {
    const world = newWorld(1)
    const s = findSpawn(world)
    const first = pick(world, s.x, s.y + 1.62, s.z, 0, deg(-80), 8)
    assert.ok(first)
    const saved = { ...first }
    pick(world, s.x, s.y + 1.62, s.z, 2, deg(-20), 30)
    renderFrame(world, { x: s.x, y: s.y + 1.62, z: s.z, yaw: 1, pitch: 0 }, 20, 8)
    assert.deepEqual(first, saved)
  })

  test('дальше maxDist не видит', () => {
    const world = newWorld(1)
    const s = findSpawn(world)
    assert.equal(cast(world, s.x, s.y + 20, s.z, 0, -1, 0, 5), undefined)
  })
})

describe('кадр', () => {
  const world = newWorld(1)
  const s = findSpawn(world)
  const eye = { x: s.x, y: s.y + 1.62, z: s.z }
  const isSky = (p: number) => (p & 255) > ((p >> 16) & 255) && (p & 255) >= ((p >> 8) & 255)

  test('размер буфера и диапазон цветов', () => {
    for (const [w, h] of [[140, 34], [80, 12], [1, 1], [7, 3]]) {
      const frame = renderFrame(world, { ...eye, yaw: 1, pitch: -0.2 }, w, h)
      assert.equal(frame.length, w * h)
      for (const p of frame) assert.ok(p >= 0 && p <= 0xffffff)
    }
  })

  test('взгляд в зенит — небо, взгляд под ноги — земля', () => {
    const up = renderFrame(world, { ...eye, y: eye.y + 30, yaw: 0, pitch: deg(89) }, 40, 10)
    assert.ok(up.every(isSky))
    const down = renderFrame(world, { ...eye, yaw: 0, pitch: deg(-89) }, 40, 10)
    assert.ok(!down.some(isSky))
  })

  test('детерминирован', () => {
    const cam: Camera = { ...eye, yaw: 2.2, pitch: -0.3 }
    assert.deepEqual(renderFrame(world, cam, 60, 20), renderFrame(newWorld(1), cam, 60, 20))
  })

  test('цветов мало: кадр полосы укладывается в ступенчатую палитру', () => {
    const rand = seeded(3)
    for (let i = 0; i < 12; i++) {
      const frame = renderFrame(world, { ...eye, yaw: rand() * 6.28, pitch: (rand() - 0.6) * 1.2 }, 140, 34)
      assert.ok(new Set(frame).size <= 90, `цветов ${new Set(frame).size}`)
    }
  })

  test('блок под прицелом светлее, по мере добычи темнеет; поставленный блок виден', () => {
    const w = newWorld(1)
    const hit = pick(w, eye.x, eye.y, eye.z, 0.4, deg(-35), 8)
    assert.ok(hit)
    const target = { x: hit.x, y: hit.y, z: hit.z }
    const cam = { ...eye, yaw: 0.4, pitch: deg(-35) }
    const centre = (frame: Uint32Array) => frame[5 * 21 + 10]
    const plain = centre(renderFrame(w, cam, 21, 11))
    const lit = centre(renderFrame(w, cam, 21, 11, { target }))
    const worn = centre(renderFrame(w, cam, 21, 11, { target, progress: 0.9 }))
    const green = (p: number) => (p >> 8) & 255
    assert.ok(green(lit) > green(plain))
    assert.ok(green(worn) < green(lit))

    setBlock(w, hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz, STONE)
    const placed = centre(renderFrame(w, cam, 21, 11))
    assert.notEqual(placed, plain)
  })

  test('сжатие по вертикали расширяет обзор: неба и земли в кадре больше', () => {
    const cam = { ...eye, y: eye.y + 6, yaw: 0.8, pitch: deg(-5) }
    const count = (squash: number) => renderFrame(world, cam, 100, 24, { squash }).filter(isSky).length
    assert.ok(count(2) > count(1))
  })
})
