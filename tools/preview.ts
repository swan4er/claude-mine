// Предпросмотр рендера без Claude Code: node tools/preview.ts [зерно]
// Пишет PNG в preview/: вид «как в полосе» (140×34) с разных наклонов и обзорный кадр сверху.
import { mkdirSync, writeFileSync } from 'node:fs'
import { renderFrame, type Camera } from '../hooks/game/render.ts'
import { findSpawn, newWorld } from '../hooks/game/world.ts'
import { encodePng } from './png.ts'

const seed = Number(process.argv[2]) || 1
const world = newWorld(seed)
const spawn = findSpawn(world)
const eye = { x: spawn.x, y: spawn.y + 1.62, z: spawn.z }
const deg = (d: number) => (d * Math.PI) / 180
mkdirSync('preview', { recursive: true })

const shots: [string, Camera, number, number, number][] = [
  ['band-front', { ...eye, yaw: deg(30), pitch: deg(-12) }, 140, 34, 8],
  ['band-right', { ...eye, yaw: deg(120), pitch: deg(-12) }, 140, 34, 8],
  ['band-back', { ...eye, yaw: deg(210), pitch: deg(-12) }, 140, 34, 8],
  ['band-down', { ...eye, yaw: deg(30), pitch: deg(-40) }, 140, 34, 8],
  ['band-up', { ...eye, yaw: deg(30), pitch: deg(25) }, 140, 34, 8],
  ['overview', { x: eye.x - 14, y: eye.y + 16, z: eye.z - 14, yaw: deg(45), pitch: deg(-28) }, 360, 200, 3],
]
for (const [name, cam, w, h, scale] of shots) {
  const t = performance.now()
  const frame = renderFrame(world, cam, w, h, { crosshair: name.startsWith('band') })
  const ms = performance.now() - t
  writeFileSync(`preview/${name}-seed${seed}.png`, encodePng(frame, w, h, scale))
  console.log(`${name}: ${w}×${h}, ${ms.toFixed(0)} мс, цветов ${new Set(frame).size}, чанков в памяти ${world.chunks.size}`)
}
console.log(`зерно ${seed}, появление ${JSON.stringify(spawn)}`)
