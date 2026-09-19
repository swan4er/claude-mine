// Игрок: положение ног, взгляд, гравитация, столкновения. Терминал не сообщает, что клавишу
// отпустили, поэтому ходьба — не «скорость, пока держишь», а запас пути: нажатие добавляет шаг,
// запас расходуется с обычной скоростью ходьбы. Автоповтор удерживаемой клавиши даёт ровную
// ходьбу, отпускание останавливает за долю секунды. Уступ в один блок игрок берёт сам: прыжок и
// «вперёд» одновременно в терминале не нажать.
import { isSolid } from './blocks.ts'
import { getBlock, type World } from './world.ts'

export const WIDTH = 0.6
export const HEIGHT = 1.8
export const EYE = 1.62
const HALF = WIDTH / 2

const STEP = 0.75 // блоков пути за одно нажатие
const MAX_PENDING = 1.5
const WALK_SPEED = 4.3 // блоков в секунду
const GRAVITY = 26
const JUMP_SPEED = 8.4 // прыжок чуть выше блока
const MAX_FALL = 28
export const MAX_PITCH = (85 * Math.PI) / 180

export type Player = {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  vy: number
  // несделанный путь по горизонтали
  px: number
  pz: number
  onGround: boolean
}

export const newPlayer = (x: number, y: number, z: number): Player =>
  ({ x, y, z, yaw: 0, pitch: (-12 * Math.PI) / 180, vy: 0, px: 0, pz: 0, onGround: false })

// пересекает ли тело игрока, стоящего ногами в (x, y, z), хоть один твёрдый блок
export function collides(world: World, x: number, y: number, z: number): boolean {
  const x0 = Math.floor(x - HALF), x1 = Math.floor(x + HALF - 1e-9)
  const y0 = Math.floor(y), y1 = Math.floor(y + HEIGHT - 1e-9)
  const z0 = Math.floor(z - HALF), z1 = Math.floor(z + HALF - 1e-9)
  for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
    if (isSolid(getBlock(world, bx, by, bz))) return true
  }
  return false
}

// занял бы блок (bx, by, bz) место, где стоит игрок
export function overlapsBlock(p: Player, bx: number, by: number, bz: number): boolean {
  return p.x + HALF > bx && p.x - HALF < bx + 1 && p.y + HEIGHT > by && p.y < by + 1 && p.z + HALF > bz && p.z - HALF < bz + 1
}

export function look(p: Player, dyaw: number, dpitch: number): void {
  p.yaw = (p.yaw + dyaw) % (Math.PI * 2)
  p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + dpitch))
}

// нажатие «вперёд/назад/вбок»: добавляет шаг к запасу пути в направлении взгляда
export function walk(p: Player, forward: number, strafe: number): void {
  const sin = Math.sin(p.yaw)
  const cos = Math.cos(p.yaw)
  p.px += (sin * forward + cos * strafe) * STEP
  p.pz += (cos * forward - sin * strafe) * STEP
  const len = Math.hypot(p.px, p.pz)
  if (len > MAX_PENDING) {
    p.px *= MAX_PENDING / len
    p.pz *= MAX_PENDING / len
  }
}

export function jump(p: Player): void {
  if (p.onGround) {
    p.vy = JUMP_SPEED
    p.onGround = false
  }
}

// одна ось горизонтального движения; упёрся — пробует подняться на уступ в один блок
function slide(world: World, p: Player, dx: number, dz: number): boolean {
  if (!collides(world, p.x + dx, p.y, p.z + dz)) {
    p.x += dx
    p.z += dz
    return true
  }
  if (p.onGround && !collides(world, p.x, p.y + 1, p.z) && !collides(world, p.x + dx, p.y + 1, p.z + dz)) {
    p.x += dx
    p.y += 1
    p.z += dz
    return true
  }
  return false
}

// шаг физики на dt секунд; возвращает true, если игрок сдвинулся
export function stepPlayer(world: World, p: Player, dt: number): boolean {
  const before = p.x + p.y * 31 + p.z * 977

  const pending = Math.hypot(p.px, p.pz)
  if (pending > 1e-6) {
    const go = Math.min(pending, WALK_SPEED * dt)
    const dx = (p.px / pending) * go
    const dz = (p.pz / pending) * go
    // оси по отдельности: вдоль стены игрок скользит, а не застревает
    const movedX = dx !== 0 && slide(world, p, dx, 0)
    const movedZ = dz !== 0 && slide(world, p, 0, dz)
    p.px -= dx
    p.pz -= dz
    // в стену идти незачем: запас по упёршейся оси сгорает
    if (dx !== 0 && !movedX) p.px = 0
    if (dz !== 0 && !movedZ) p.pz = 0
    if (Math.hypot(p.px, p.pz) < 1e-3) p.px = p.pz = 0
  }

  p.vy = Math.max(-MAX_FALL, p.vy - GRAVITY * dt)
  const dy = p.vy * dt
  if (!collides(world, p.x, p.y + dy, p.z)) {
    p.y += dy
    p.onGround = false
  } else if (dy < 0) {
    // приземление: ноги встают ровно на верх блока
    // самая низкая целая высота между «куда падал» и «где был», на которой тело свободно
    let y = Math.floor(p.y + dy) + 1
    while (y < p.y && collides(world, p.x, y, p.z)) y++
    p.y = Math.min(y, p.y)
    p.vy = 0
    p.onGround = true
  } else {
    p.vy = 0
  }

  return before !== p.x + p.y * 31 + p.z * 977
}
