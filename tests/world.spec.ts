// Тесты ядра мира. Запуск: node --test "tests/**/*.spec.ts" (node 24 исполняет .ts сам).
// Расширение .spec.ts, а не .test.ts: *.test.ts подбирает `claude plugin test`.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AIR, DIRT, GRASS, LEAVES, LOG, PLANKS, SAND, STONE } from '../hooks/game/blocks.ts'
import { fbm, hash2, valueNoise } from '../hooks/game/noise.ts'
import {
  CHUNK, CROWN_RADIUS, HEIGHT, editCount, findSpawn, getBlock, getChunk, loadEdits, newWorld, serializeEdits, setBlock, surfaceHeight, treeAt,
} from '../hooks/game/world.ts'

describe('шум', () => {
  test('детерминирован и лежит в [0, 1)', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i * 37) % 211 - 100
      const z = (i * 91) % 173 - 80
      const h = hash2(x, z, 5)
      assert.equal(h, hash2(x, z, 5))
      assert.ok(h >= 0 && h < 1)
      const f = fbm(x / 7.3, z / 5.1, 5)
      assert.ok(f >= 0 && f < 1, `fbm ${f}`)
    }
  })

  test('разные зёрна дают разный шум', () => {
    let same = 0
    for (let i = 0; i < 200; i++) if (hash2(i, -i, 1) === hash2(i, -i, 2)) same++
    assert.ok(same < 3)
  })

  test('гладкий: соседние точки близки, в узлах решётки совпадает с хешем', () => {
    assert.equal(valueNoise(4, -7, 9), hash2(4, -7, 9))
    for (let i = 0; i < 300; i++) {
      const x = i * 0.37
      assert.ok(Math.abs(valueNoise(x, 1.5, 3) - valueNoise(x + 0.01, 1.5, 3)) < 0.03)
    }
  })
})

describe('рельеф', () => {
  test('высоты в пределах мира, перепад между соседями не больше блока', () => {
    for (const seed of [1, 2, 3, 99]) {
      for (let z = -80; z < 80; z++) for (let x = -80; x < 80; x++) {
        const h = surfaceHeight(seed, x, z)
        assert.ok(h >= 8 && h <= HEIGHT - 12, `высота ${h}`)
        assert.ok(Math.abs(h - surfaceHeight(seed, x + 1, z)) <= 1)
        assert.ok(Math.abs(h - surfaceHeight(seed, x, z + 1)) <= 1)
      }
    }
  })

  test('есть и низины, и холмы', () => {
    let min = 99
    let max = 0
    for (let z = -150; z < 150; z += 3) for (let x = -150; x < 150; x += 3) {
      const h = surfaceHeight(1, x, z)
      min = Math.min(min, h)
      max = Math.max(max, h)
    }
    assert.ok(max - min >= 14, `размах ${max - min}`)
  })
})

describe('чанк', () => {
  test('слои: трава сверху, под ней земля, ниже камень; над поверхностью воздух или дерево', () => {
    const world = newWorld(1)
    let checked = 0
    for (let z = -20; z < 20; z++) for (let x = -20; x < 20; x++) {
      const h = surfaceHeight(1, x, z)
      const top = getBlock(world, x, h - 1, z)
      if (top === SAND) continue
      assert.equal(top, GRASS)
      assert.equal(getBlock(world, x, h - 2, z), DIRT)
      assert.equal(getBlock(world, x, h - 6, z), STONE)
      assert.ok([AIR, LOG, LEAVES].includes(getBlock(world, x, h, z)))
      checked++
    }
    assert.ok(checked > 1000)
    assert.equal(getBlock(world, 0, -1, 0), STONE)
    assert.equal(getBlock(world, 0, HEIGHT, 0), AIR)
  })

  test('отрицательные координаты адресуются без швов', () => {
    const world = newWorld(4)
    for (const [x, z] of [[-1, -1], [-16, -17], [-33, 5], [15, -16]] as const) {
      const h = surfaceHeight(4, x, z)
      assert.notEqual(getBlock(world, x, h - 1, z), AIR)
    }
  })

  test('дерево: ствол нужной высоты, крона вокруг верхушки, соседние стволы не вплотную', () => {
    const world = newWorld(1)
    let found = 0
    for (let z = -40; z < 40; z++) for (let x = -40; x < 40; x++) {
      const trunk = treeAt(1, x, z)
      if (!trunk) continue
      found++
      const base = surfaceHeight(1, x, z)
      for (let i = 0; i < trunk; i++) assert.equal(getBlock(world, x, base + i, z), LOG)
      assert.equal(getBlock(world, x, base + trunk, z), LEAVES)
      assert.equal(getBlock(world, x + 1, base + trunk - 1, z), LEAVES)
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) assert.equal(treeAt(1, x + dx, z + dz), 0)
    }
    assert.ok(found >= 20, `деревьев ${found}`)
  })

  test('кроны на границах чанков не зависят от порядка генерации', () => {
    const forward = newWorld(7)
    const backward = newWorld(7)
    const coords: [number, number][] = []
    for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) coords.push([cx, cz])
    for (const [cx, cz] of coords) getChunk(forward, cx, cz)
    for (const [cx, cz] of [...coords].reverse()) getChunk(backward, cx, cz)
    for (const [cx, cz] of coords) assert.deepEqual(getChunk(forward, cx, cz), getChunk(backward, cx, cz))
    // и листва действительно пересекает границы: иначе тест ничего не проверяет
    let crossing = 0
    for (let z = -48; z < 48; z++) for (let x = -48; x < 48; x++) {
      if (!treeAt(7, x, z)) continue
      if ((x & 15) < CROWN_RADIUS || (x & 15) >= CHUNK - CROWN_RADIUS || (z & 15) < CROWN_RADIUS || (z & 15) >= CHUNK - CROWN_RADIUS) crossing++
    }
    assert.ok(crossing > 0)
  })
})

describe('правки игрока', () => {
  test('переживают выбрасывание чанка и сериализацию', () => {
    const world = newWorld(3)
    const h = surfaceHeight(3, -5, 9)
    assert.ok(setBlock(world, -5, h - 1, 9, AIR))
    assert.ok(setBlock(world, -5, h + 2, 9, PLANKS))
    assert.ok(setBlock(world, 40, 10, -40, AIR))
    assert.equal(editCount(world), 3)
    world.chunks.clear()
    assert.equal(getBlock(world, -5, h - 1, 9), AIR)
    assert.equal(getBlock(world, -5, h + 2, 9), PLANKS)

    const copy = newWorld(3)
    loadEdits(copy, serializeEdits(world))
    assert.equal(editCount(copy), 3)
    assert.equal(getBlock(copy, -5, h - 1, 9), AIR)
    assert.equal(getBlock(copy, -5, h + 2, 9), PLANKS)
    assert.equal(getBlock(copy, 40, 10, -40), AIR)
    assert.equal(serializeEdits(copy), serializeEdits(world))
  })

  test('за пределами высоты мира ставить нельзя; мусор в сохранении не роняет загрузку', () => {
    const world = newWorld(3)
    assert.equal(setBlock(world, 0, HEIGHT, 0, STONE), false)
    assert.equal(setBlock(world, 0, -1, 0, AIR), false)
    loadEdits(world, 'чушь;1,2:zz=1;;3,x:1=1;0,0:-5=3,10=999')
    assert.equal(editCount(world), 1)
  })

  test('память ограничена: далёкие чанки выбрасываются, мир остаётся тем же', () => {
    const world = newWorld(2)
    const before = getChunk(world, 0, 0).slice()
    for (let i = 1; i <= 700; i++) getChunk(world, i, 0)
    assert.ok(world.chunks.size <= 600)
    assert.deepEqual(getChunk(world, 0, 0), before)
  })
})

describe('точка появления', () => {
  test('на поверхности, под открытым небом, не в дереве', () => {
    for (const seed of [1, 2, 3, 4, 5, 42, 1000]) {
      const world = newWorld(seed)
      const s = findSpawn(world)
      const x = Math.floor(s.x)
      const z = Math.floor(s.z)
      assert.notEqual(getBlock(world, x, s.y - 1, z), AIR)
      for (let y = s.y; y < HEIGHT; y++) assert.equal(getBlock(world, x, y, z), AIR, `зерно ${seed}, y ${y}`)
    }
  })
})
