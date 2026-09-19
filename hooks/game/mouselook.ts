// Взгляд мышью. Терминал не умеет захватывать указатель: приходят только его координаты в клетках
// поля. Взгляд поворачивается на СМЕЩЕНИЕ указателя, как в обычных шутерах: мышь вправо на N клеток —
// взгляд вправо на те же N клеток обзора, где бы указатель ни находился.
//
// (Первая версия тянула взгляд к ПОЛОЖЕНИЮ указателя: каждое событие поворачивало на долю угла от
// центра до указателя. Указатель правее центра + мышь влево = поворот всё равно вправо, а скорость
// зависела от числа событий. Игрок описал это как «поворачивает туда, куда я двигал раньше».)
//
// Указатель упирается в край поля, поэтому у краёв — зоны доворота: пока указатель там, взгляд
// продолжает поворачиваться сам. Событие «указатель ушёл с поля» (leave) движок даёт, но только когда
// мышь осталась в окне терминала; ушедшая за край окна неотличима от стоящей в зоне, поэтому доворот длится недолго после последнего события: вбок — секунду
// (за край окна мышь уходит редко), вверх и вниз — 0,4 с (вверх, к переписке, она уходит постоянно).

// x, y — в клетках поля; дробные, если терминал сообщает положение мыши точнее клетки (iTerm2, kitty,
// Ghostty, WezTerm; tmux дробей не пропускает). С зажатой кнопкой приходят и значения за краями поля.
export type Pointer = { x: number; y: number; at: number }
// columns × rows — поле вида в клетках (без хотбара и статуса); squash — сжатие картинки по вертикали
export type LookView = { columns: number; rows: number; squash: number; fov: number }

export const SENSITIVITIES = [0.5, 0.75, 1, 1.5, 2] as const
export const DEFAULT_SENSITIVITY = 2
// скачок больше этого — указатель вышел с поля и вошёл в другом месте, а не проехал по нему
const MAX_JUMP_COLUMNS = 16
const MAX_JUMP_ROWS = 6
const STALE_MS = 500
export const EDGE_COLUMNS = 4
export const EDGE_YAW_HOLD_MS = 1000
export const EDGE_PITCH_HOLD_MS = 400
// рад/с
export const EDGE_YAW_RATE = 1.4
export const EDGE_PITCH_RATE = 0.9

// радиан на один пиксель кадра в центре экрана
const perPixel = (view: LookView) => Math.tan(view.fov / 2) / (view.columns / 2)

// поворот за одно событие движения; prev — предыдущее положение указателя
export function lookDelta(prev: Pointer | undefined, next: Pointer, view: LookView, sensitivity: number): { dyaw: number; dpitch: number } {
  if (!prev || next.at - prev.at > STALE_MS) return { dyaw: 0, dpitch: 0 }
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  if (Math.abs(dx) > MAX_JUMP_COLUMNS || Math.abs(dy) > MAX_JUMP_ROWS) return { dyaw: 0, dpitch: 0 }
  const k = perPixel(view) * sensitivity
  // клетка — один пиксель кадра по ширине и два по высоте; вниз по экрану — взгляд вниз
  return { dyaw: dx * k, dpitch: (prev.y - next.y) * 2 * view.squash * k }
}

// доворот у края за dtMs; ноль, если указатель не в зоне или давно не двигался
export function edgeTurn(pointer: Pointer | undefined, view: LookView, now: number, dtMs: number): { dyaw: number; dpitch: number } {
  if (!pointer || pointer.y < 0 || pointer.y >= view.rows + 2) return { dyaw: 0, dpitch: 0 }
  const idle = now - pointer.at
  const dt = Math.min(dtMs, 250) / 1000
  const side = pointer.x < EDGE_COLUMNS ? -1 : pointer.x >= view.columns - EDGE_COLUMNS ? 1 : 0
  const tilt = pointer.y < 1 ? 1 : pointer.y >= view.rows - 1 ? -1 : 0
  return { dyaw: idle <= EDGE_YAW_HOLD_MS ? side * EDGE_YAW_RATE * dt : 0, dpitch: idle <= EDGE_PITCH_HOLD_MS ? tilt * EDGE_PITCH_RATE * dt : 0 }
}
