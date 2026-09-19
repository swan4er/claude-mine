// Крафт списком: рецепт — это «что нужно» и «что выйдет», без раскладки по сетке. Рецепты — данные:
// новый добавляется строкой.
import {
  LOG, PLANKS, STICK, STONE, STONE_AXE, STONE_PICKAXE, STONE_SHOVEL, STONE_SWORD, WOOD_AXE, WOOD_PICKAXE, WOOD_SHOVEL, WOOD_SWORD,
} from './blocks.ts'
import { addItem, countItem, removeItem, type Inventory } from './inventory.ts'

export type Recipe = { out: number; count: number; needs: readonly (readonly [item: number, count: number])[] }

export const RECIPES: readonly Recipe[] = [
  { out: PLANKS, count: 4, needs: [[LOG, 1]] },
  { out: STICK, count: 4, needs: [[PLANKS, 2]] },
  { out: WOOD_PICKAXE, count: 1, needs: [[PLANKS, 3], [STICK, 2]] },
  { out: WOOD_AXE, count: 1, needs: [[PLANKS, 3], [STICK, 2]] },
  { out: WOOD_SHOVEL, count: 1, needs: [[PLANKS, 1], [STICK, 2]] },
  { out: WOOD_SWORD, count: 1, needs: [[PLANKS, 2], [STICK, 1]] },
  { out: STONE_PICKAXE, count: 1, needs: [[STONE, 3], [STICK, 2]] },
  { out: STONE_AXE, count: 1, needs: [[STONE, 3], [STICK, 2]] },
  { out: STONE_SHOVEL, count: 1, needs: [[STONE, 1], [STICK, 2]] },
  { out: STONE_SWORD, count: 1, needs: [[STONE, 2], [STICK, 1]] },
]

// чего и сколько не хватает; пустой список — можно крафтить
export const missing = (inv: Inventory, recipe: Recipe): [item: number, count: number][] =>
  recipe.needs.flatMap(([item, count]) => {
    const lack = count - countItem(inv, item)
    return lack > 0 ? [[item, lack] as [number, number]] : []
  })

export const canCraft = (inv: Inventory, recipe: Recipe) => missing(inv, recipe).length === 0

// undefined — не хватает материалов или результат некуда положить
export function craft(inv: Inventory, recipe: Recipe): Inventory | undefined {
  let next: Inventory | undefined = inv
  for (const [item, count] of recipe.needs) {
    next = removeItem(next, item, count)
    if (!next) return undefined
  }
  const added = addItem(next, recipe.out, recipe.count)
  return added.left === 0 ? added.inv : undefined
}
