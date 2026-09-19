// Добыча: сколько секунд ломается блок тем, что в руке, и что из него выпадет.
import { BLOCKS, ITEMS } from './blocks.ts'

// времена оригинала для терминала долгие: добыча идёт без удержания кнопки, ждать скучно
const PACE = 0.6

const toolFor = (block: number, held: number | undefined) => {
  const need = BLOCKS[block]?.tool
  const tool = held === undefined ? undefined : ITEMS[held]?.tool
  return need && tool && tool.kind === need ? tool : undefined
}

// Infinity — блок не ломается (нижний слой мира)
export function breakSeconds(block: number, held: number | undefined, y: number): number {
  const def = BLOCKS[block]
  if (!def || y <= 0) return Infinity
  return (def.hardness * PACE) / (toolFor(block, held)?.speed ?? 1)
}

// id предмета или undefined: камень без кирки крошится в ничто
export function dropOf(block: number, held: number | undefined): number | undefined {
  const def = BLOCKS[block]
  if (!def || def.drop === undefined) return undefined
  if (def.needsTool && !toolFor(block, held)) return undefined
  return def.drop
}
