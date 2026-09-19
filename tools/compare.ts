// Сравнение вариантов вертикального обзора для полосы: node tools/compare.ts [зерно]
import { mkdirSync, writeFileSync } from 'node:fs'
import { renderFrame } from '../hooks/game/render.ts'
import { newWorld, surfaceHeight, treeAt } from '../hooks/game/world.ts'
import { encodePng } from './png.ts'

const seed = Number(process.argv[2]) || 1
const world = newWorld(seed)
// точка обзора: самая высокая клетка без дерева в радиусе 40 блоков, взгляд в сторону начала координат
let best = { x: 0, z: 0, h: 0 }
for (let z = -40; z <= 40; z++) for (let x = -40; x <= 40; x++) {
  const h = surfaceHeight(seed, x, z)
  if (h <= best.h) continue
  // без деревьев рядом, иначе полкадра займёт крона
  let clear = true
  for (let dz = -6; dz <= 6 && clear; dz++) for (let dx = -6; dx <= 6; dx++) if (treeAt(seed, x + dx, z + dz)) clear = false
  if (clear) best = { x, z, h }
}
const cam = { x: best.x + 0.5, y: best.h + 1.62, z: best.z + 0.5, yaw: Math.atan2(-best.x, -best.z), pitch: (-14 * Math.PI) / 180 }
mkdirSync('preview', { recursive: true })
const W = 140, H = 34, SCALE = 8
for (const squash of [1, 1.5, 2]) {
  const frame = renderFrame(world, cam, W, H, { crosshair: true, squash })
  writeFileSync(`preview/squash-${squash}-seed${seed}.png`, encodePng(frame, W, H, SCALE))
}
console.log('точка обзора', best)
