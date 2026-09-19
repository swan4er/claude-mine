// Инвентарь: фиксированный массив ячеек, первые HOTBAR — панель быстрого доступа. Функции не меняют
// вход, а возвращают новый массив: ячеек мало, а сравнивать и сохранять значения проще.
import { ITEMS } from './blocks.ts'

export const HOTBAR = 9
export const SLOTS = 27
export const STACK = 64

export type Stack = { item: number; count: number }
export type Inventory = readonly (Stack | null)[]

export const emptyInventory = (): Inventory => Array<Stack | null>(SLOTS).fill(null)

// инструменты не складываются в стопку
const stackLimit = (item: number) => (ITEMS[item]?.tool ? 1 : STACK)

export const countItem = (inv: Inventory, item: number) => inv.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0)

// кладёт сначала в неполные стопки, потом в пустые ячейки; left — что не влезло
export function addItem(inv: Inventory, item: number, count: number): { inv: Inventory; left: number } {
  const out = inv.map(s => (s ? { ...s } : null))
  const limit = stackLimit(item)
  let left = count
  for (const s of out) {
    if (left <= 0) break
    if (s && s.item === item && s.count < limit) {
      const n = Math.min(left, limit - s.count)
      s.count += n
      left -= n
    }
  }
  for (let i = 0; i < out.length && left > 0; i++) {
    if (out[i]) continue
    const n = Math.min(left, limit)
    out[i] = { item, count: n }
    left -= n
  }
  return { inv: out, left }
}

// забирает count штук; undefined, если столько нет
export function removeItem(inv: Inventory, item: number, count: number): Inventory | undefined {
  if (countItem(inv, item) < count) return undefined
  const out = inv.map(s => (s ? { ...s } : null))
  let left = count
  // с конца: хотбар опустошается последним
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const s = out[i]
    if (!s || s.item !== item) continue
    const n = Math.min(left, s.count)
    s.count -= n
    left -= n
    if (s.count === 0) out[i] = null
  }
  return out
}

// забирает одну штуку именно из этой ячейки (поставить блок из руки)
export function takeFromSlot(inv: Inventory, slot: number): Inventory | undefined {
  const s = inv[slot]
  if (!s) return undefined
  return inv.map((v, i) => (i !== slot ? v : s.count > 1 ? { item: s.item, count: s.count - 1 } : null))
}

export const serializeInventory = (inv: Inventory): string => inv.map(s => (s ? `${s.item}x${s.count}` : '')).join(',')

export function parseInventory(text: string): Inventory {
  const out = emptyInventory().slice()
  text.split(',').slice(0, SLOTS).forEach((part, i) => {
    const [item, count] = part.split('x').map(Number)
    if (ITEMS[item] && Number.isInteger(count) && count > 0) out[i] = { item, count: Math.min(count, stackLimit(item)) }
  })
  return out
}
