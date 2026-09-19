// Детерминированный шум: всё в мире — функция координат и зерна, поэтому чанк можно построить в
// любой момент и в любом порядке, и он выйдет тем же.

// целые координаты и зерно → [0, 1)
export function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// гладкий шум на целочисленной решётке, [0, 1)
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = smooth(x - x0)
  const tz = smooth(z - z0)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz
}

// несколько октав: крупные холмы плюс мелкая рябь, [0, 1)
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, z, seed + i * 101)
    norm += amp
    x *= 2
    z *= 2
    amp *= 0.5
  }
  return sum / norm
}
