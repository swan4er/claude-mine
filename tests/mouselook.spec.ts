// Взгляд мышью: поворот на смещение указателя. Запуск: node --test "tests/**/*.spec.ts"
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { EDGE_COLUMNS, EDGE_PITCH_HOLD_MS, EDGE_YAW_HOLD_MS, EDGE_YAW_RATE, edgeTurn, lookDelta, type LookView, type Pointer } from '../hooks/game/mouselook.ts'
import { DEFAULT_FOV } from '../hooks/game/render.ts'

const VIEW: LookView = { columns: 140, rows: 17, squash: 1.5, fov: DEFAULT_FOV }
const at = (x: number, y: number, t = 0): Pointer => ({ x, y, at: t })
// провести указатель по точкам, вернуть суммарный поворот
function drag(points: Pointer[], sensitivity = 1) {
  let yaw = 0
  let pitch = 0
  points.forEach((p, i) => {
    const d = lookDelta(points[i - 1], p, VIEW, sensitivity)
    yaw += d.dyaw
    pitch += d.dpitch
  })
  return { yaw, pitch }
}

describe('взгляд мышью', () => {
  test('поворот — в сторону движения мыши, где бы указатель ни был (главная ошибка первой версии)', () => {
    // указатель в правой половине, мышь едет ВЛЕВО: взгляд влево
    assert.ok(lookDelta(at(120, 8), at(115, 8, 30), VIEW, 1).dyaw < 0)
    // в левой половине, мышь вправо: взгляд вправо
    assert.ok(lookDelta(at(10, 8), at(14, 8, 30), VIEW, 1).dyaw > 0)
    // вниз по экрану — взгляд вниз, вверх — вверх
    assert.ok(lookDelta(at(70, 5), at(70, 9, 30), VIEW, 1).dpitch < 0)
    assert.ok(lookDelta(at(70, 9), at(70, 5, 30), VIEW, 1).dpitch > 0)
    // стоит на месте — взгляд стоит
    assert.deepEqual(lookDelta(at(120, 3), at(120, 3, 30), VIEW, 1), { dyaw: 0, dpitch: 0 })
  })

  test('поворот зависит от пройденного пути, а не от числа событий', () => {
    const steps = Array.from({ length: 41 }, (_, i) => at(50 + i, 8, i * 10))
    const bySteps = drag(steps).yaw
    const byJump = drag([at(50, 8), at(62, 8, 100), at(78, 8, 200), at(90, 8, 300)]).yaw
    assert.ok(Math.abs(bySteps - byJump) < 1e-9)
    // туда и обратно — взгляд вернулся
    assert.ok(Math.abs(drag([at(50, 8), at(60, 8, 50), at(50, 8, 100)]).yaw) < 1e-9)
  })

  test('чувствительность ×1: вся ширина поля — примерно весь угол обзора, не больше', () => {
    const full = drag(Array.from({ length: 15 }, (_, i) => at(i * 10, 8, i * 20))).yaw
    assert.ok(full > DEFAULT_FOV * 0.9 && full < DEFAULT_FOV * 1.4, `${(full * 180 / Math.PI).toFixed(0)}°`)
    // одна клетка — меньше градуса (в первой версии у края выходило около 14°)
    assert.ok(lookDelta(at(130, 8), at(131, 8, 10), VIEW, 1).dyaw < Math.PI / 180)
    assert.equal(lookDelta(at(70, 8), at(80, 8, 10), VIEW, 2).dyaw, 2 * lookDelta(at(70, 8), at(80, 8, 10), VIEW, 1).dyaw)
  })

  test('первое событие, долгая пауза и скачок (мышь вышла с поля и вошла в другом месте) взгляд не дёргают', () => {
    assert.deepEqual(lookDelta(undefined, at(100, 8), VIEW, 1), { dyaw: 0, dpitch: 0 })
    assert.deepEqual(lookDelta(at(20, 8), at(30, 8, 5000), VIEW, 1), { dyaw: 0, dpitch: 0 })
    assert.deepEqual(lookDelta(at(5, 8), at(130, 8, 30), VIEW, 1), { dyaw: 0, dpitch: 0 })
    assert.deepEqual(lookDelta(at(70, 1), at(70, 15, 30), VIEW, 1), { dyaw: 0, dpitch: 0 })
  })

  test('у края поля взгляд доворачивается сам, но недолго: ушедшая с поля мышь не крутит его вечно', () => {
    const right = at(VIEW.columns - 1, 8, 1000)
    assert.ok(Math.abs(edgeTurn(right, VIEW, 1100, 100).dyaw - EDGE_YAW_RATE * 0.1) < 1e-9)
    assert.ok(edgeTurn(at(EDGE_COLUMNS - 1, 8, 1000), VIEW, 1100, 100).dyaw < 0)
    assert.deepEqual(edgeTurn(at(70, 8, 1000), VIEW, 1100, 100), { dyaw: 0, dpitch: 0 })
    assert.equal(edgeTurn(right, VIEW, 1000 + EDGE_YAW_HOLD_MS + 1, 100).dyaw, 0)
    // верхняя строка — вверх, нижняя — вниз, и держится короче
    assert.ok(edgeTurn(at(70, 0, 1000), VIEW, 1100, 100).dpitch > 0)
    assert.ok(edgeTurn(at(70, VIEW.rows - 1, 1000), VIEW, 1100, 100).dpitch < 0)
    assert.equal(edgeTurn(at(70, 0, 1000), VIEW, 1000 + EDGE_PITCH_HOLD_MS + 1, 100).dpitch, 0)
    // суммарный доворот после ухода мыши ограничен
    let yaw = 0
    for (let t = 0; t < 5000; t += 64) yaw += edgeTurn(right, VIEW, 1000 + t, 64).dyaw
    assert.ok(yaw < EDGE_YAW_RATE * (EDGE_YAW_HOLD_MS / 1000 + 0.1))
    // подвисший кадр не даёт рывка
    assert.ok(edgeTurn(right, VIEW, 1100, 5000).dyaw <= EDGE_YAW_RATE * 0.25 + 1e-9)
    assert.deepEqual(edgeTurn(undefined, VIEW, 0, 64), { dyaw: 0, dpitch: 0 })
  })
})
