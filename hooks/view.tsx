/* @jsx h */
import type { ClientSurface } from 'claude-code'
import { ITEMS } from './game/blocks.ts'
import { RECIPES, missing } from './game/craft.ts'
import {
  TICK_MS, actCraft, actCursor, actJump, actLook, actMenu, actMine, actPlace, actSelect, actTilt, actTurn, actWalk, advance, eyeOf, fromSave, toSave,
  type Game,
} from './game/game.ts'
import { HOTBAR } from './game/inventory.ts'
import { DEFAULT_FOV, renderFrame } from './game/render.ts'
import { toRows, type Packed } from './game/runs.ts'

// Поверхность игры: модуль, который хуки (./register.tsx) монтируют над строкой ввода. Работает в
// потоке отрисовки со своим таймером кадров, клавишами (после клика по полю; Esc возвращает фокус
// строке ввода) и мышью. Вся игра — в ./game, здесь только ввод, время и вывод.
//
// Нельзя называть локальную переменную `h`: каждый JSX-тег компилируется в вызов `h`.

// rows — высота, которую хуки запросили для области: до первой раскладки surface.rows ещё 0
type Props = { save?: unknown; seed?: number; done?: number; mouse?: boolean; rows?: number } | undefined
// В состоянии поверхности только простые значения: движок вправе заморозить или скопировать его, а игра —
// изменяемый объект с кэшем чанков. version — какую версию игры видел последний кадр.
type State = { version: number; seenDone: number; banner: boolean; squash: number; mouseLook: boolean }
// игра и её часы живут в модуле; clock — момент, до которого игра просчитана (мс)
let live: { game: Game; clock: number; savedAt: number } | undefined

// во сколько раз картинка сжата по вертикали: полоса низкая, сжатие расширяет обзор (клавиша v)
const SQUASH = [1.5, 2, 1]
const SAVE_EVERY_MS = 10_000
// сохранение уходит хукам одним сообщением, а сообщение ограничено ~100 000 символов
const MAX_SAVE_CHARS = 95_000
const MOUSE_PULL = 0.3

type Action = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight' | 'tiltUp' | 'tiltDown' | 'jump' | 'mine' | 'place' | 'menu' | 'view' | 'mouse' | 'confirm'
// та же клавиша в русской раскладке: ц = w, ф = a, ы = s, в = d, й = q, у = e, ш = i, м = v, ь = m
const KEYS: Record<string, Action> = {
  w: 'forward', ц: 'forward', s: 'back', ы: 'back', a: 'left', ф: 'left', d: 'right', в: 'right',
  left: 'turnLeft', right: 'turnRight', up: 'tiltUp', down: 'tiltDown',
  ' ': 'jump', space: 'jump', q: 'mine', й: 'mine', e: 'place', у: 'place',
  i: 'menu', ш: 'menu', tab: 'menu', v: 'view', м: 'view', m: 'mouse', ь: 'mouse', return: 'confirm',
}

// кадр пересчитывается только когда изменилась игра или размер: стоячий мир не стоит ничего
let cache: { key: string; packed: Packed } | undefined

export default function View(props: Props, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  const cols = Math.max(20, surface.columns || 100)
  const rows = Math.max(4, surface.rows || props?.rows || 12)
  // две нижние строки — хотбар и статус
  const viewRows = rows - 2

  const act = (fn: (g: Game) => void) => {
    const s = surface.state
    if (!s || !live) return
    fn(live.game)
    surface.setState({ ...s, banner: false, version: live.game.version })
  }

  if (surface.state === undefined) {
    // новый экземпляр поверхности — новая игра из сохранения (или новый мир после /mine new)
    live = { game: fromSave(props?.save, props?.seed ?? 1), clock: Date.now(), savedAt: Date.now() }
    cache = undefined
    surface.setState({ version: 0, seenDone: props?.done ?? 0, banner: false, squash: 0, mouseLook: true })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (!s || !live) return
      const now = Date.now()
      // таймер кадров приходит реже и неровнее TICK_MS: шагов логики делается столько, сколько реально прошло времени
      live.clock = advance(live.game, live.clock, now)
      if (live.game.dirty && now - live.savedAt >= SAVE_EVERY_MS) {
        const save = toSave(live.game)
        if (JSON.stringify(save).length <= MAX_SAVE_CHARS) {
          surface.post({ save })
          live.game.dirty = false
        }
        live.savedAt = now
      }
      // стоячий мир не перерисовывается
      if (live.game.version !== s.version) surface.setState({ ...s, version: live.game.version })
    })
    const onKey = (key: string): void => {
      const k = key.toLowerCase()
      const s = surface.state
      if (!s || !live) return
      // несколько нажатий, пришедших пачкой (быстрый автоповтор), движок отдаёт одной строкой «www»
      if ([...k].length > 1 && !KEYS[k]) return [...k].forEach(onKey)
      if (k >= '1' && k <= '9') return act(g => actSelect(g, Number(k) - 1))
      const action = KEYS[k]
      if (!action) return
      if (live.game.menu) {
        if (action === 'tiltUp' || action === 'forward') act(g => actCursor(g, -1))
        else if (action === 'tiltDown' || action === 'back') act(g => actCursor(g, 1))
        else if (action === 'confirm' || action === 'place' || action === 'jump') act(actCraft)
        else if (action === 'menu' || action === 'mine') act(actMenu)
        return
      }
      if (action === 'forward') act(g => actWalk(g, 1, 0))
      else if (action === 'back') act(g => actWalk(g, -1, 0))
      else if (action === 'left') act(g => actWalk(g, 0, -1))
      else if (action === 'right') act(g => actWalk(g, 0, 1))
      else if (action === 'turnLeft') act(g => actTurn(g, -1))
      else if (action === 'turnRight') act(g => actTurn(g, 1))
      else if (action === 'tiltUp') act(g => actTilt(g, 1))
      else if (action === 'tiltDown') act(g => actTilt(g, -1))
      else if (action === 'jump') act(actJump)
      else if (action === 'mine' || action === 'confirm') act(actMine)
      else if (action === 'place') act(actPlace)
      else if (action === 'menu') act(actMenu)
      else if (action === 'view') surface.setState({ ...s, squash: (s.squash + 1) % SQUASH.length, version: -1 })
      else if (action === 'mouse') surface.setState({ ...s, mouseLook: !s.mouseLook })
    }
    surface.onKey(({ key }) => onKey(key))
    surface.onPointer(ev => {
      const s = surface.state
      if (!s || !live || live.game.menu) return
      if (ev.type === 'down') return act(ev.button === 'right' ? actPlace : actMine)
      // движение мыши над полем (без кнопки) тянет взгляд к указателю
      if (ev.type !== 'move' || !s.mouseLook) return
      const w = Math.max(20, surface.columns || 100)
      const vr = Math.max(2, (surface.rows || 12) - 2)
      if (ev.y >= vr) return
      const dpp = w / 2 / Math.tan(DEFAULT_FOV / 2)
      const yaw = Math.atan((ev.x + 0.5 - w / 2) / dpp)
      const pitch = -Math.atan((((ev.y + 0.5) * 2 - vr) * SQUASH[s.squash]) / dpp)
      act(g => actLook(g, yaw * MOUSE_PULL, pitch * MOUSE_PULL))
    })
  }

  // хуки увеличивают props.done, когда Claude заканчивает ход: плашка, игра при этом не останавливается
  const seen = surface.state
  const done = props?.done ?? 0
  if (seen && done !== seen.seenDone) surface.setState({ ...seen, seenDone: done, banner: true })

  const s = surface.state
  if (!s || !live) return <Text dimColor>{'claude-mine: мир строится…'}</Text>
  const g = live.game
  const squash = SQUASH[s.squash]

  const hotbar = (
    <Text wrap="truncate-end">
      {Array.from({ length: HOTBAR }, (_, i) => {
        const stack = g.inventory[i]
        const label = ` ${i + 1}:${stack ? `${ITEMS[stack.item].short}${stack.count > 1 ? stack.count : ''}` : '·'} `
        return i === g.selected ? <Text inverse bold>{label}</Text> : <Text dimColor={!stack}>{label}</Text>
      })}
      <Text dimColor>{`  в руке: ${g.inventory[g.selected] ? ITEMS[g.inventory[g.selected]!.item].name : 'ничего'}`}</Text>
    </Text>
  )

  const p = g.player
  const where = `x ${Math.floor(p.x)} y ${Math.floor(p.y)} z ${Math.floor(p.z)}`
  const hint = props?.mouse === false
    ? 'клавиатуру игре даёт клик, а клики Claude Code видит только в полноэкранном режиме: /tui fullscreen, затем /mine'
    // в меню строка статуса сначала отвечает на действие («готово», «не хватает»), потом снова подсказывает
    : g.menu ? `${g.note ? `${g.note} · ` : ''}↑↓ рецепт · Enter скрафтить · i закрыть`
    : g.ticks < 200 && s.version <= 1 ? 'кликните по полю · WASD идти · ←→↑↓ или мышь смотреть · пробел прыжок · q ломать · e ставить · i крафт · v обзор · Esc к строке ввода'
    : `${g.note || 'q/клик ломать · e/правый клик ставить · i крафт · v обзор · m мышь'} · ${where}`
  const status = s.banner
    ? <Text color="yellow" bold wrap="truncate-end">{`● Claude закончил · ${hint}`}</Text>
    : <Text dimColor wrap="truncate-end">{hint}</Text>

  if (g.menu) {
    // меню вместо вида: инвентарь и рецепты; окно прокрутки держит выбранный рецепт на экране
    const have = g.inventory.filter(Boolean).map(st => `${ITEMS[st!.item].name} ×${st!.count}`).join(', ') || 'пусто'
    const space = Math.max(1, viewRows - 3)
    const first = Math.max(0, Math.min(RECIPES.length - space, g.cursor - Math.floor(space / 2)))
    return (
      <Box flexDirection="column" width={cols}>
        <Text bold wrap="truncate-end">{'Инвентарь и крафт'}</Text>
        <Text wrap="truncate-end">{`У вас: ${have}`}</Text>
        <Text dimColor wrap="truncate-end">{'Рецепты:'}</Text>
        {RECIPES.slice(first, first + space).map((r, i) => {
          const lack = missing(g.inventory, r)
          const needs = r.needs.map(([item, n]) => `${ITEMS[item].name} ×${n}`).join(' + ')
          const line = `${first + i === g.cursor ? '▶' : ' '} ${ITEMS[r.out].name}${r.count > 1 ? ` ×${r.count}` : ''} ← ${needs}${lack.length ? `   не хватает: ${lack.map(([item, n]) => `${ITEMS[item].name} ×${n}`).join(', ')}` : '   ✓ можно'}`
          return first + i === g.cursor ? <Text inverse wrap="truncate-end">{line}</Text> : <Text dimColor={lack.length > 0} wrap="truncate-end">{line}</Text>
        })}
        {hotbar}
        {status}
      </Box>
    )
  }

  const key = `${g.version}:${cols}:${viewRows}:${squash}`
  if (!cache || cache.key !== key) {
    const frame = renderFrame(g.world, { ...eyeOf(p), yaw: p.yaw, pitch: p.pitch }, cols, viewRows * 2, {
      target: g.target, progress: g.mining?.progress ?? 0, crosshair: true, squash,
    })
    cache = { key, packed: toRows(frame, cols, viewRows) }
  }

  return (
    <Box flexDirection="column" width={cols}>
      {cache.packed.rows.map(row => (
        <Text>{row.map(run => (run.bg ? <Text color={run.fg} backgroundColor={run.bg}>{run.text}</Text> : <Text color={run.fg}>{run.text}</Text>))}</Text>
      ))}
      {hotbar}
      {status}
    </Box>
  )
}
