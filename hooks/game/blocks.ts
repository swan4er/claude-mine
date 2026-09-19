// Реестр блоков и предметов — данными. Новый блок, инструмент или предмет — это строка здесь
// (и рецепт в craft.ts), а не правка логики.

export type Rgb = readonly [number, number, number]
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword'

export const AIR = 0
export const GRASS = 1
export const DIRT = 2
export const STONE = 3
export const LOG = 4
export const LEAVES = 5
export const PLANKS = 6
export const SAND = 7

export type BlockDef = {
  name: string
  top: Rgb
  side: Rgb
  bottom: Rgb
  // секунд на добычу голой рукой
  hardness: number
  // инструмент, который ускоряет добычу
  tool?: ToolKind
  // без этого инструмента блок ломается, но ничего не выпадает
  needsTool?: boolean
  // что выпадает: id предмета; undefined — ничего
  drop?: number
}

const same = (c: Rgb) => ({ top: c, side: c, bottom: c })

export const BLOCKS: Record<number, BlockDef> = {
  [GRASS]: { name: 'трава', top: [96, 168, 72], side: [126, 104, 66], bottom: [120, 86, 58], hardness: 0.9, tool: 'shovel', drop: DIRT },
  [DIRT]: { name: 'земля', ...same([120, 86, 58]), hardness: 0.8, tool: 'shovel', drop: DIRT },
  [STONE]: { name: 'камень', ...same([128, 128, 132]), hardness: 6, tool: 'pickaxe', needsTool: true, drop: STONE },
  [LOG]: { name: 'бревно', top: [168, 136, 84], side: [96, 70, 44], bottom: [168, 136, 84], hardness: 2.4, tool: 'axe', drop: LOG },
  [LEAVES]: { name: 'листва', ...same([52, 124, 52]), hardness: 0.35 },
  [PLANKS]: { name: 'доски', ...same([184, 148, 92]), hardness: 2, tool: 'axe', drop: PLANKS },
  [SAND]: { name: 'песок', ...same([216, 204, 148]), hardness: 0.7, tool: 'shovel', drop: SAND },
}

export const isSolid = (id: number) => id !== AIR

// предметы: блоки лежат в инвентаре под своими id, инструменты и материалы — от 100
export const STICK = 100
export const WOOD_PICKAXE = 101
export const STONE_PICKAXE = 102
export const WOOD_AXE = 103
export const STONE_AXE = 104
export const WOOD_SHOVEL = 105
export const STONE_SHOVEL = 106
export const WOOD_SWORD = 107
export const STONE_SWORD = 108

export type ItemDef = {
  name: string
  // две буквы для хотбара, где названию не хватает места
  short: string
  // speed — во сколько раз быстрее руки по «своему» блоку
  tool?: { kind: ToolKind; speed: number }
}

export const ITEMS: Record<number, ItemDef> = {
  [DIRT]: { name: 'земля', short: 'зм' },
  [STONE]: { name: 'камень', short: 'км' },
  [LOG]: { name: 'бревно', short: 'бр' },
  [PLANKS]: { name: 'доски', short: 'дс' },
  [SAND]: { name: 'песок', short: 'пс' },
  [STICK]: { name: 'палка', short: 'пл' },
  [WOOD_PICKAXE]: { name: 'деревянная кирка', short: 'К₁', tool: { kind: 'pickaxe', speed: 5 } },
  [STONE_PICKAXE]: { name: 'каменная кирка', short: 'К₂', tool: { kind: 'pickaxe', speed: 10 } },
  [WOOD_AXE]: { name: 'деревянный топор', short: 'Т₁', tool: { kind: 'axe', speed: 2.5 } },
  [STONE_AXE]: { name: 'каменный топор', short: 'Т₂', tool: { kind: 'axe', speed: 5 } },
  [WOOD_SHOVEL]: { name: 'деревянная лопата', short: 'Л₁', tool: { kind: 'shovel', speed: 2.5 } },
  [STONE_SHOVEL]: { name: 'каменная лопата', short: 'Л₂', tool: { kind: 'shovel', speed: 5 } },
  [WOOD_SWORD]: { name: 'деревянный меч', short: 'М₁', tool: { kind: 'sword', speed: 1 } },
  [STONE_SWORD]: { name: 'каменный меч', short: 'М₂', tool: { kind: 'sword', speed: 1 } },
}

// предмет можно поставить в мир, если он же — блок
export const isPlaceable = (item: number) => item in BLOCKS
