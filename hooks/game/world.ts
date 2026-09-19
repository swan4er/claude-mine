// Бесконечный мир кусками (чанками) 16×16×64. Чанк строится при первом обращении и целиком
// определяется зерном и своими координатами; правки игрока хранятся отдельно и накладываются
// поверх — поэтому в сохранение идут только они, а чанки можно выбрасывать из памяти.
//
// World — изменяемый объект (кэш чанков), а не значение: рендер обращается к нему сотни тысяч раз
// за кадр.
import { AIR, DIRT, GRASS, LEAVES, LOG, SAND, STONE } from './blocks.ts'
import { fbm, hash2 } from './noise.ts'

export const CHUNK = 16
export const HEIGHT = 64
const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT
// столько чанков держим в памяти (по 16 КБ); дальние выбрасываются и при нужде строятся заново
const MAX_CHUNKS = 600

export type World = {
  seed: number
  chunks: Map<number, Uint8Array>
  // ключ чанка → (индекс блока в чанке → id)
  edits: Map<number, Map<number, number>>
}

export const newWorld = (seed: number): World => ({ seed: seed | 0, chunks: new Map(), edits: new Map() })

const OFFSET = 32768
export const chunkKey = (cx: number, cz: number) => (cx + OFFSET) * 65536 + (cz + OFFSET)
const keyToCoords = (key: number): [number, number] => [Math.floor(key / 65536) - OFFSET, (key % 65536) - OFFSET]
const blockIndex = (lx: number, y: number, lz: number) => (y * CHUNK + lz) * CHUNK + lx

// сколько блоков в столбце: верхний блок лежит на y = высота − 1
export function surfaceHeight(seed: number, x: number, z: number): number {
  const hills = fbm(x / 56, z / 56, seed, 4)
  const bumps = fbm(x / 13, z / 13, seed + 977, 2)
  return Math.floor(14 + hills * 26 + bumps * 5)
}

const SAND_BELOW = 23
const isSandy = (height: number) => height <= SAND_BELOW

// Деревья: мир разбит на клетки 6×6, в клетке не больше одного дерева, и стоит оно не ближе чем в
// блоке от края клетки — стволы никогда не оказываются вплотную. Возвращает высоту ствола или 0.
const TREE_CELL = 6
const TREE_CHANCE = 0.42
export const CROWN_RADIUS = 2
export function treeAt(seed: number, x: number, z: number): number {
  const cellX = Math.floor(x / TREE_CELL)
  const cellZ = Math.floor(z / TREE_CELL)
  if (hash2(cellX, cellZ, seed + 12) >= TREE_CHANCE) return 0
  const tx = cellX * TREE_CELL + 1 + Math.floor(hash2(cellX, cellZ, seed + 13) * (TREE_CELL - 2))
  const tz = cellZ * TREE_CELL + 1 + Math.floor(hash2(cellX, cellZ, seed + 14) * (TREE_CELL - 2))
  if (tx !== x || tz !== z) return 0
  if (isSandy(surfaceHeight(seed, x, z))) return 0
  return 4 + Math.floor(hash2(x, z, seed + 15) * 3)
}

// форма кроны относительно верхушки ствола (dy = 0): радиус по слоям
const CROWN: readonly { dy: number; radius: number; corners: boolean }[] = [
  { dy: -2, radius: 2, corners: false },
  { dy: -1, radius: 2, corners: false },
  { dy: 0, radius: 1, corners: true },
  { dy: 1, radius: 1, corners: false },
]

function generate(world: World, cx: number, cz: number): Uint8Array {
  const { seed } = world
  const data = new Uint8Array(CHUNK_VOLUME)
  const x0 = cx * CHUNK
  const z0 = cz * CHUNK
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const height = surfaceHeight(seed, x0 + lx, z0 + lz)
      const sandy = isSandy(height)
      for (let y = 0; y < height; y++) {
        const depth = height - 1 - y
        data[blockIndex(lx, y, lz)] = sandy ? (depth < 3 ? SAND : STONE) : depth === 0 ? GRASS : depth < 4 ? DIRT : STONE
      }
    }
  }
  // деревья, чьи кроны заходят в чанк, растут и за его пределами. Сначала все стволы, потом вся
  // листва и только в воздух: итог не зависит от порядка обхода и от порядка генерации чанков
  const trees: { x: number; z: number; base: number; trunk: number }[] = []
  for (let z = z0 - CROWN_RADIUS; z < z0 + CHUNK + CROWN_RADIUS; z++) {
    for (let x = x0 - CROWN_RADIUS; x < x0 + CHUNK + CROWN_RADIUS; x++) {
      const trunk = treeAt(seed, x, z)
      if (trunk) trees.push({ x, z, base: surfaceHeight(seed, x, z), trunk })
    }
  }
  const put = (x: number, y: number, z: number, id: number, onlyAir: boolean) => {
    const lx = x - x0
    const lz = z - z0
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return
    const i = blockIndex(lx, y, lz)
    if (!onlyAir || data[i] === AIR) data[i] = id
  }
  for (const t of trees) for (let i = 0; i < t.trunk; i++) put(t.x, t.base + i, t.z, LOG, false)
  for (const t of trees) {
    const top = t.base + t.trunk - 1
    for (const layer of CROWN) {
      for (let dz = -layer.radius; dz <= layer.radius; dz++) {
        for (let dx = -layer.radius; dx <= layer.radius; dx++) {
          const corner = Math.abs(dx) === layer.radius && Math.abs(dz) === layer.radius
          if (corner && !layer.corners) continue
          put(t.x + dx, top + layer.dy, t.z + dz, LEAVES, true)
        }
      }
    }
  }
  const edits = world.edits.get(chunkKey(cx, cz))
  if (edits) for (const [i, id] of edits) data[i] = id
  return data
}

export function getChunk(world: World, cx: number, cz: number): Uint8Array {
  const key = chunkKey(cx, cz)
  let chunk = world.chunks.get(key)
  if (!chunk) {
    chunk = generate(world, cx, cz)
    world.chunks.set(key, chunk)
    if (world.chunks.size > MAX_CHUNKS) {
      // Map хранит порядок вставки: первые — самые старые
      let drop = MAX_CHUNKS / 4
      for (const old of world.chunks.keys()) {
        if (drop-- <= 0) break
        if (old !== key) world.chunks.delete(old)
      }
    }
  }
  return chunk
}

// ниже мира — камень (в пустоту не провалиться), выше — воздух
export function getBlock(world: World, x: number, y: number, z: number): number {
  if (y < 0) return STONE
  if (y >= HEIGHT) return AIR
  return getChunk(world, x >> 4, z >> 4)[blockIndex(x & 15, y, z & 15)]
}

export function setBlock(world: World, x: number, y: number, z: number, id: number): boolean {
  if (y < 0 || y >= HEIGHT) return false
  const cx = x >> 4
  const cz = z >> 4
  const i = blockIndex(x & 15, y, z & 15)
  getChunk(world, cx, cz)[i] = id
  const key = chunkKey(cx, cz)
  let edits = world.edits.get(key)
  if (!edits) world.edits.set(key, (edits = new Map()))
  edits.set(i, id)
  return true
}

export const editCount = (world: World) => {
  let n = 0
  for (const edits of world.edits.values()) n += edits.size
  return n
}

// правки строкой: «cx,cz:индекс=id,индекс=id;…», числа в системе по основанию 36
export function serializeEdits(world: World): string {
  const parts: string[] = []
  for (const [key, edits] of world.edits) {
    if (edits.size === 0) continue
    const [cx, cz] = keyToCoords(key)
    parts.push(`${cx},${cz}:${[...edits].map(([i, id]) => `${i.toString(36)}=${id.toString(36)}`).join(',')}`)
  }
  return parts.join(';')
}

export function loadEdits(world: World, text: string): void {
  world.edits.clear()
  world.chunks.clear()
  for (const part of text.split(';')) {
    const [where, list] = part.split(':')
    if (!where || !list) continue
    const [cx, cz] = where.split(',').map(Number)
    if (!Number.isInteger(cx) || !Number.isInteger(cz)) continue
    const edits = new Map<number, number>()
    for (const pair of list.split(',')) {
      const [i, id] = pair.split('=').map(v => parseInt(v, 36))
      if (i >= 0 && i < CHUNK_VOLUME && id >= 0 && id < 256) edits.set(i, id)
    }
    world.edits.set(chunkKey(cx, cz), edits)
  }
}

// точка появления: ближайший к началу координат столбец, где нет дерева и его кроны
export function findSpawn(world: World): { x: number; y: number; z: number } {
  for (let r = 0; r < 64; r++) {
    for (let z = -r; z <= r; z++) {
      for (let x = -r; x <= r; x++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
        let clear = true
        for (let dz = -CROWN_RADIUS; dz <= CROWN_RADIUS && clear; dz++) {
          for (let dx = -CROWN_RADIUS; dx <= CROWN_RADIUS; dx++) if (treeAt(world.seed, x + dx, z + dz)) clear = false
        }
        if (clear) return { x: x + 0.5, y: surfaceHeight(world.seed, x, z), z: z + 0.5 }
      }
    }
  }
  return { x: 0.5, y: surfaceHeight(world.seed, 0, 0), z: 0.5 }
}
