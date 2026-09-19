// Кадр: луч на каждый пиксель → цвет 0xRRGGBB. Рендер ничего не знает ни о терминале, ни о размере
// экрана: буфер потом превращается в отрезки полублоков (runs.ts) или в PNG (tools/preview.ts).
//
// Цвета намеренно «ступенчатые»: затенение граней и туман квантованы, у неба несколько полос.
// Кадр в терминале — это отрезки одного цвета, и их число ограничено (docs/probes.md): чем больше
// соседних пикселей совпадает, тем дешевле кадр.
import { cast } from './raycast.ts'
import { AIR, BLOCKS, type Rgb } from './blocks.ts'
import { getBlock, type World } from './world.ts'

export type Camera = { x: number; y: number; z: number; yaw: number; pitch: number }
export type Target = { x: number; y: number; z: number }
export type RenderOptions = {
  // горизонтальное поле зрения, радианы; вертикальное — сколько влезет по высоте
  fov?: number
  maxDist?: number
  // блок под прицелом: его грани светлее
  target?: Target
  // доля добычи 0..1: блок под прицелом темнеет по мере ломания
  progress?: number
  crosshair?: boolean
  // во сколько раз пиксель «выше» по углу, чем «шире»: 1 — честная картинка с узким вертикальным
  // обзором, больше — обзор шире, блоки приплюснуты
  squash?: number
}

export const DEFAULT_FOV = (95 * Math.PI) / 180
export const DEFAULT_MAX_DIST = 56

const SKY_HORIZON: Rgb = [176, 208, 236]
const SKY_ZENITH: Rgb = [96, 152, 220]
const SKY_BANDS = 5
const FOG_STEPS = 6
// верх светлее всего, низ темнее; две пары боковых граней различаются — так читаются углы
const SHADE = { top: 1, bottom: 0.5, x: 0.82, z: 0.66 }
// вблизи соседние блоки чуть различаются яркостью, чтобы была видна сетка; вдали — нет, иначе
// кадр рассыпается на слишком много отрезков
const GRID_NEAR = 9
const GRID_CONTRAST = 0.06
// у подножия уступа верхняя грань темнее: на однотонной траве иначе не видно перепадов высоты
const LEDGE_WIDTH = 0.3
const LEDGE_SHADE = 0.74
const LEDGE_FAR = 40

const pack = (r: number, g: number, b: number) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

function sky(elevation: number): number {
  // elevation: −1 вниз … +1 вверх; ниже горизонта небо остаётся цветом горизонта (это туман вдали)
  const t = Math.min(SKY_BANDS - 1, Math.floor(Math.max(0, elevation) * 1.8 * SKY_BANDS)) / (SKY_BANDS - 1)
  return pack(
    Math.round(SKY_HORIZON[0] + (SKY_ZENITH[0] - SKY_HORIZON[0]) * t),
    Math.round(SKY_HORIZON[1] + (SKY_ZENITH[1] - SKY_HORIZON[1]) * t),
    Math.round(SKY_HORIZON[2] + (SKY_ZENITH[2] - SKY_HORIZON[2]) * t),
  )
}

export function renderFrame(world: World, cam: Camera, w: number, h: number, options: RenderOptions = {}): Uint32Array {
  const fov = options.fov ?? DEFAULT_FOV
  const maxDist = options.maxDist ?? DEFAULT_MAX_DIST
  const target = options.target
  const progress = options.progress ?? 0
  const squash = options.squash ?? 1
  const buf = new Uint32Array(w * h)

  // базис камеры: вперёд, вправо, вверх
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const fx = sy * cp, fy = sp, fz = cy * cp
  const rx = cy, rz = -sy
  const ux = -sy * sp, uy = cp, uz = -cy * sp
  // расстояние до плоскости экрана в пикселях
  const dpp = w / 2 / Math.tan(fov / 2)

  for (let py = 0; py < h; py++) {
    const v = (h / 2 - py - 0.5) * squash
    for (let px = 0; px < w; px++) {
      const u = px - w / 2 + 0.5
      let dx = fx * dpp + rx * u + ux * v
      let dy = fy * dpp + uy * v
      let dz = fz * dpp + rz * u + uz * v
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      dx /= len
      dy /= len
      dz /= len
      const hit = cast(world, cam.x, cam.y, cam.z, dx, dy, dz, maxDist)
      if (!hit) {
        buf[py * w + px] = sky(dy)
        continue
      }
      const def = BLOCKS[hit.id]
      const base = hit.ny > 0 ? def.top : hit.ny < 0 ? def.bottom : def.side
      let light = hit.ny > 0 ? SHADE.top : hit.ny < 0 ? SHADE.bottom : hit.nx !== 0 ? SHADE.x : SHADE.z
      if (hit.dist < GRID_NEAR && ((hit.x + hit.y + hit.z) & 1)) light *= 1 - GRID_CONTRAST
      if (hit.ny > 0 && hit.dist < LEDGE_FAR) {
        // точка попадания внутри блока; сосед на блок выше с той стороны, к краю которой она ближе
        const hx = cam.x + dx * hit.dist - hit.x
        const hz = cam.z + dz * hit.dist - hit.z
        const above = hit.y + 1
        if (
          (hx < LEDGE_WIDTH && getBlock(world, hit.x - 1, above, hit.z) !== AIR) ||
          (hx > 1 - LEDGE_WIDTH && getBlock(world, hit.x + 1, above, hit.z) !== AIR) ||
          (hz < LEDGE_WIDTH && getBlock(world, hit.x, above, hit.z - 1) !== AIR) ||
          (hz > 1 - LEDGE_WIDTH && getBlock(world, hit.x, above, hit.z + 1) !== AIR)
        ) light *= LEDGE_SHADE
      }
      if (target && hit.x === target.x && hit.y === target.y && hit.z === target.z) light *= 1.28 - progress * 0.6
      // туман ступенями: дальние блоки растворяются в цвете горизонта
      const fog = Math.floor(Math.min(0.999, Math.max(0, (hit.dist - maxDist * 0.35) / (maxDist * 0.65))) * FOG_STEPS) / FOG_STEPS
      buf[py * w + px] = pack(
        clamp(Math.round(base[0] * light * (1 - fog) + SKY_HORIZON[0] * fog)),
        clamp(Math.round(base[1] * light * (1 - fog) + SKY_HORIZON[1] * fog)),
        clamp(Math.round(base[2] * light * (1 - fog) + SKY_HORIZON[2] * fog)),
      )
    }
  }

  if (options.crosshair) {
    const cx = Math.floor(w / 2)
    const cyy = Math.floor(h / 2)
    for (const [ox, oy] of [[0, 0], [-2, 0], [2, 0], [0, -1], [0, 1]] as const) {
      const x = cx + ox
      const y = cyy + oy
      if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = 0xf4f4f4
    }
  }
  return buf
}
