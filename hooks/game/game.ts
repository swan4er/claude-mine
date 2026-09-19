// Состояние игры и действия над ним. Game — изменяемый объект (внутри живёт кэш чанков, по
// которому рендер ходит сотни тысяч раз за кадр): действия меняют его на месте. Поле version
// растёт при любом видимом изменении — по нему вид понимает, что кадр пора пересчитать.
//
// Терминал не сообщает, что клавишу отпустили, поэтому добыча не «пока держишь»: нажатие начинает
// ломать блок под прицелом, и дальше она идёт сама, пока прицел с блока не ушёл.
import { AIR, BLOCKS, ITEMS, isPlaceable } from './blocks.ts'
import { RECIPES, craft, type Recipe } from './craft.ts'
import { HOTBAR, addItem, emptyInventory, parseInventory, serializeInventory, takeFromSlot, type Inventory } from './inventory.ts'
import { breakSeconds, dropOf } from './mining.ts'
import { EYE, collides, jump, look, newPlayer, overlapsBlock, stepPlayer, walk, type Player } from './player.ts'
import { pick, type Hit } from './raycast.ts'
import { findSpawn, getBlock, loadEdits, newWorld, serializeEdits, setBlock, type World } from './world.ts'

export const TICK_MS = 50
const DT = TICK_MS / 1000
export const REACH = 5
const TURN = (9 * Math.PI) / 180
const TILT = (6 * Math.PI) / 180
const SAVE_VERSION = 1

export type Mining = { x: number; y: number; z: number; progress: number }
export type Game = {
  world: World
  player: Player
  inventory: Inventory
  selected: number
  target: Hit | undefined
  mining: Mining | undefined
  // меню инвентаря и крафта; cursor — выбранный рецепт
  menu: boolean
  cursor: number
  // короткое сообщение в строке статуса и тик, на котором оно появилось
  note: string
  noteAt: number
  ticks: number
  version: number
  // есть несохранённые изменения
  dirty: boolean
}

export function newGame(seed: number): Game {
  const world = newWorld(seed)
  const spawn = findSpawn(world)
  const g: Game = {
    world, player: newPlayer(spawn.x, spawn.y, spawn.z), inventory: emptyInventory(), selected: 0,
    target: undefined, mining: undefined, menu: false, cursor: 0, note: '', noteAt: 0, ticks: 0, version: 1, dirty: false,
  }
  retarget(g)
  return g
}

const touch = (g: Game) => { g.version++ }
const say = (g: Game, note: string) => { g.note = note; g.noteAt = g.ticks; touch(g) }
// сообщение игроку от вида (например, о переполненном сохранении)
export const notify = (g: Game, note: string) => say(g, note)
export const heldItem = (g: Game): number | undefined => g.inventory[g.selected]?.item
export const eyeOf = (p: Player) => ({ x: p.x, y: p.y + EYE, z: p.z })

function retarget(g: Game): void {
  const p = g.player
  const next = pick(g.world, p.x, p.y + EYE, p.z, p.yaw, p.pitch, REACH)
  const was = g.target
  const same = was && next ? was.x === next.x && was.y === next.y && was.z === next.z && was.nx === next.nx && was.ny === next.ny && was.nz === next.nz : was === next
  g.target = next
  if (!same) touch(g)
  // прицел ушёл с блока — добыча сбрасывается
  if (g.mining && !(next && next.x === g.mining.x && next.y === g.mining.y && next.z === g.mining.z)) {
    g.mining = undefined
    touch(g)
  }
}

// ── действия игрока ─────────────────────────────────────────────────────────

export function actLook(g: Game, dyaw: number, dpitch: number): void {
  if (g.menu) return
  look(g.player, dyaw, dpitch)
  touch(g)
  retarget(g)
}
export const actTurn = (g: Game, dir: number) => actLook(g, dir * TURN, 0)
export const actTilt = (g: Game, dir: number) => actLook(g, 0, dir * TILT)

export function actWalk(g: Game, forward: number, strafe: number): void {
  if (!g.menu) walk(g.player, forward, strafe)
}

export function actJump(g: Game): void {
  if (!g.menu) jump(g.player)
}

export function actSelect(g: Game, slot: number): void {
  if (slot < 0 || slot >= HOTBAR || slot === g.selected) return
  g.selected = slot
  // другой инструмент — другое время добычи: начатая добыча сбрасывается
  g.mining = undefined
  touch(g)
}

export function actMine(g: Game): void {
  if (g.menu) return
  const t = g.target
  if (!t) return say(g, 'не достать: подойдите ближе')
  if (breakSeconds(t.id, heldItem(g), t.y) === Infinity) return say(g, 'это дно мира, его не сломать')
  if (g.mining && g.mining.x === t.x && g.mining.y === t.y && g.mining.z === t.z) return
  g.mining = { x: t.x, y: t.y, z: t.z, progress: 0 }
  touch(g)
}

export function actPlace(g: Game): void {
  if (g.menu) return
  const t = g.target
  const held = heldItem(g)
  if (!t) return say(g, 'некуда ставить: нужен блок под прицелом')
  if (held === undefined || !isPlaceable(held)) return say(g, 'в руке нет блока')
  const x = t.x + t.nx
  const y = t.y + t.ny
  const z = t.z + t.nz
  if (getBlock(g.world, x, y, z) !== AIR) return
  if (overlapsBlock(g.player, x, y, z)) return say(g, 'здесь стоите вы')
  const next = takeFromSlot(g.inventory, g.selected)
  if (!next || !setBlock(g.world, x, y, z, held)) return
  g.inventory = next
  g.dirty = true
  touch(g)
  retarget(g)
}

export function actMenu(g: Game): void {
  g.menu = !g.menu
  g.mining = undefined
  g.player.px = g.player.pz = 0
  touch(g)
}

export function actCursor(g: Game, dir: number): void {
  if (!g.menu) return
  g.cursor = (g.cursor + dir + RECIPES.length) % RECIPES.length
  touch(g)
}

export function actCraft(g: Game): void {
  if (!g.menu) return
  const recipe: Recipe = RECIPES[g.cursor]
  const next = craft(g.inventory, recipe)
  if (!next) return say(g, `не хватает материалов или места: ${ITEMS[recipe.out].name}`)
  g.inventory = next
  g.dirty = true
  say(g, `готово: ${ITEMS[recipe.out].name}${recipe.count > 1 ? ` ×${recipe.count}` : ''}`)
}

// ── шаг игры ────────────────────────────────────────────────────────────────

export function tick(g: Game): void {
  g.ticks++
  if (g.note && g.ticks - g.noteAt > 60) { g.note = ''; touch(g) }
  if (g.menu) return

  if (stepPlayer(g.world, g.player, DT)) {
    g.dirty = true
    touch(g)
    retarget(g)
  }

  const m = g.mining
  if (!m) return
  const id = getBlock(g.world, m.x, m.y, m.z)
  if (id === AIR) { g.mining = undefined; return }
  const held = heldItem(g)
  m.progress += DT / breakSeconds(id, held, m.y)
  touch(g)
  if (m.progress < 1) return
  setBlock(g.world, m.x, m.y, m.z, AIR)
  g.mining = undefined
  g.dirty = true
  const drop = dropOf(id, held)
  if (drop === undefined) say(g, BLOCKS[id].needsTool ? `${BLOCKS[id].name}: без кирки ничего не выпало` : `${BLOCKS[id].name} рассыпалась`)
  else {
    const added = addItem(g.inventory, drop, 1)
    g.inventory = added.inv
    say(g, added.left ? 'инвентарь полон' : `+1 ${ITEMS[drop].name}`)
  }
  retarget(g)
}

// Переводит реальное время в шаги логики (кадры терминала приходят реже и неровно). clock — момент,
// до которого игра просчитана. Возвращает новый clock.
const MAX_STEPS = 6
export function advance(g: Game, clock: number, now: number): number {
  let steps = 0
  while (clock + TICK_MS <= now && steps < MAX_STEPS) {
    tick(g)
    clock += TICK_MS
    steps++
  }
  // после простоя (свернули терминал) игра не проматывается
  return steps === MAX_STEPS ? now : clock
}

// ── сохранение ──────────────────────────────────────────────────────────────

export type Save = { v: number; seed: number; player: number[]; selected: number; inventory: string; edits: string }

export function toSave(g: Game): Save {
  const p = g.player
  const r = (n: number) => Math.round(n * 1000) / 1000
  return { v: SAVE_VERSION, seed: g.world.seed, player: [r(p.x), r(p.y), r(p.z), r(p.yaw), r(p.pitch)], selected: g.selected, inventory: serializeInventory(g.inventory), edits: serializeEdits(g.world) }
}

// негодное сохранение не роняет игру: вместо него начинается новый мир
export function fromSave(save: unknown, fallbackSeed: number): Game {
  const s = save as Partial<Save> | null | undefined
  if (!s || s.v !== SAVE_VERSION || typeof s.seed !== 'number' || !Array.isArray(s.player) || s.player.length < 5 || s.player.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
    return newGame(fallbackSeed)
  }
  const g = newGame(s.seed)
  if (typeof s.edits === 'string') loadEdits(g.world, s.edits)
  if (typeof s.inventory === 'string') g.inventory = parseInventory(s.inventory)
  if (typeof s.selected === 'number' && s.selected >= 0 && s.selected < HOTBAR) g.selected = Math.floor(s.selected)
  const [x, y, z, yaw, pitch] = s.player
  Object.assign(g.player, { x, y, z, yaw, pitch })
  // сохранённое место могло оказаться внутри блока (сменилась генерация): поднимаем на поверхность
  while (collides(g.world, g.player.x, g.player.y, g.player.z) && g.player.y < 63) g.player.y = Math.floor(g.player.y) + 1
  retarget(g)
  return g
}
