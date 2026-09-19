// Луч через воксельную сетку (3D-DDA, Аманатидес — Ву): шагаем от границы к границе клеток по той
// оси, до которой ближе. Один и тот же луч служит рендеру (что видно в пикселе) и прицелу (какой
// блок под перекрестьем), поэтому «вижу» и «ломаю» не расходятся.
import { AIR } from './blocks.ts'
import { CHUNK, HEIGHT, getChunk, type World } from './world.ts'

export type Hit = {
  id: number
  x: number
  y: number
  z: number
  // нормаль грани, в которую вошёл луч: сюда ставится новый блок
  nx: number
  ny: number
  nz: number
  dist: number
}

// Результат пишется в один общий объект: рендер зовёт cast() тысячи раз за кадр, и объект на каждый
// пиксель был бы мусором. Следующий вызов его перезапишет, поэтому хранить результат cast() нельзя —
// игровая логика пользуется pick(), который возвращает копию.
const out: Hit = { id: AIR, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, dist: 0 }

// (dx, dy, dz) — единичный вектор. Возвращает общий объект или undefined, если до maxDist пусто
export function cast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): Hit | undefined {
  let mx = Math.floor(ox)
  let my = Math.floor(oy)
  let mz = Math.floor(oz)
  const sx = dx < 0 ? -1 : 1
  const sy = dy < 0 ? -1 : 1
  const sz = dz < 0 ? -1 : 1
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tdy = dy === 0 ? Infinity : Math.abs(1 / dy)
  const tdz = dz === 0 ? Infinity : Math.abs(1 / dz)
  let tx = dx === 0 ? Infinity : (dx < 0 ? ox - mx : mx + 1 - ox) * tdx
  let ty = dy === 0 ? Infinity : (dy < 0 ? oy - my : my + 1 - oy) * tdy
  let tz = dz === 0 ? Infinity : (dz < 0 ? oz - mz : mz + 1 - oz) * tdz

  let chunkX = mx >> 4
  let chunkZ = mz >> 4
  let chunk = getChunk(world, chunkX, chunkZ)
  let dist = 0
  let axis = 0

  for (;;) {
    if (tx < ty && tx < tz) { dist = tx; tx += tdx; mx += sx; axis = 0 }
    else if (ty < tz) { dist = ty; ty += tdy; my += sy; axis = 1 }
    else { dist = tz; tz += tdz; mz += sz; axis = 2 }
    if (dist > maxDist) return undefined
    if (my >= HEIGHT) {
      // выше мира пусто навсегда, если луч идёт вверх
      if (sy > 0) return undefined
      continue
    }
    if (my < 0) return undefined
    // проверяется на каждом шаге, а не только на горизонтальном: пока луч шёл выше мира, чанк мог смениться
    if (mx >> 4 !== chunkX || mz >> 4 !== chunkZ) {
      chunkX = mx >> 4
      chunkZ = mz >> 4
      chunk = getChunk(world, chunkX, chunkZ)
    }
    const id = chunk[(my * CHUNK + (mz & 15)) * CHUNK + (mx & 15)]
    if (id !== AIR) {
      out.id = id
      out.x = mx
      out.y = my
      out.z = mz
      out.nx = axis === 0 ? -sx : 0
      out.ny = axis === 1 ? -sy : 0
      out.nz = axis === 2 ? -sz : 0
      out.dist = dist
      return out
    }
  }
}

// что под прицелом: копия результата, которую можно хранить
export function pick(world: World, ox: number, oy: number, oz: number, yaw: number, pitch: number, reach: number): Hit | undefined {
  const [dx, dy, dz] = lookDir(yaw, pitch)
  const hit = cast(world, ox, oy, oz, dx, dy, dz, reach)
  return hit && { ...hit }
}

// направление взгляда: yaw — поворот вокруг вертикали (0 смотрит вдоль +z), pitch — наклон вверх
export function lookDir(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch)
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c]
}
