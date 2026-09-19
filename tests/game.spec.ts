import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AIR, DIRT, GRASS, LEAVES, LOG, PLANKS, STICK, STONE, STONE_PICKAXE, WOOD_PICKAXE, WOOD_SWORD,
} from '../hooks/game/blocks.ts'
import { RECIPES, canCraft, craft, missing } from '../hooks/game/craft.ts'
import {
  REACH, TICK_MS, actCraft, actCursor, actJump, actLook, actMenu, actMine, actPlace, actSelect, actWalk, advance, fromSave, heldItem, newGame, tick, toSave,
  type Game,
} from '../hooks/game/game.ts'
import { HOTBAR, STACK, addItem, countItem, emptyInventory, parseInventory, removeItem, serializeInventory, takeFromSlot } from '../hooks/game/inventory.ts'
import { breakSeconds, dropOf } from '../hooks/game/mining.ts'
import { EYE, collides, newPlayer, stepPlayer, walk } from '../hooks/game/player.ts'
import { getBlock, newWorld, setBlock, surfaceHeight, treeAt } from '../hooks/game/world.ts'

const ticks = (g: Game, n: number) => { for (let i = 0; i < n; i++) tick(g) }
const give = (g: Game, item: number, count: number) => { g.inventory = addItem(g.inventory, item, count).inv }

// плоская площадка из камня на высоте 40 поверх настоящего мира: физику удобнее проверять на ровном
function arena(seed = 1) {
  const world = newWorld(seed)
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
    for (let y = 30; y < 64; y++) setBlock(world, x, y, z, y === 39 ? STONE : AIR)
  }
  return world
}

describe('игрок', () => {
  test('падает на землю и стоит ровно на блоке', () => {
    const world = arena()
    const p = newPlayer(0.5, 44, 0.5)
    for (let i = 0; i < 60; i++) stepPlayer(world, p, 0.05)
    assert.equal(p.y, 40)
    assert.ok(p.onGround)
    assert.equal(stepPlayer(world, p, 0.05), false)
  })

  test('нажатие — это шаг; серия нажатий — ровная ходьба, без нажатий останавливается', () => {
    const world = arena()
    const p = newPlayer(0.5, 40, 0.5)
    stepPlayer(world, p, 0.05)
    walk(p, 1, 0)
    for (let i = 0; i < 20; i++) stepPlayer(world, p, 0.05)
    assert.ok(Math.abs(p.z - 1.25) < 1e-6, `один шаг: z=${p.z}`)
    // автоповтор: нажатие каждый тик две секунды → скорость ходьбы, а не скорость автоповтора
    for (let i = 0; i < 40; i++) { walk(p, 1, 0); stepPlayer(world, p, 0.05) }
    const walked = p.z - 1.25
    assert.ok(walked > 4 && walked < 9.5, `прошёл ${walked}`)
    const z = p.z
    for (let i = 0; i < 20; i++) stepPlayer(world, p, 0.05)
    assert.ok(p.z - z <= 1.5 + 1e-6)
    assert.equal(stepPlayer(world, p, 0.05), false)
  })

  test('сам поднимается на уступ в один блок, в стену из двух упирается', () => {
    const world = arena()
    for (let z = 3; z <= 8; z++) setBlock(world, 0, 40, z, STONE)
    const p = newPlayer(0.5, 40, 0.5)
    for (let i = 0; i < 22; i++) { walk(p, 1, 0); stepPlayer(world, p, 0.05) }
    for (let i = 0; i < 10; i++) stepPlayer(world, p, 0.05)
    assert.equal(p.y, 41)
    assert.ok(p.z > 3)

    const wall = arena()
    setBlock(wall, 0, 40, 3, STONE)
    setBlock(wall, 0, 41, 3, STONE)
    const q = newPlayer(0.5, 40, 0.5)
    for (let i = 0; i < 30; i++) { walk(q, 1, 0); stepPlayer(wall, q, 0.05) }
    assert.equal(q.y, 40)
    assert.ok(q.z < 3 - 0.29)
    assert.ok(!collides(wall, q.x, q.y, q.z))
  })

  test('прыжок выше блока, но ниже двух; под потолком не пролезает', () => {
    const world = arena()
    const g = newGame(1)
    g.world = world
    Object.assign(g.player, { x: 0.5, y: 40, z: 0.5 })
    ticks(g, 3)
    actJump(g)
    let peak = 0
    for (let i = 0; i < 30; i++) { tick(g); peak = Math.max(peak, g.player.y - 40) }
    assert.ok(peak > 1.05 && peak < 1.9, `высота прыжка ${peak}`)
    assert.equal(g.player.y, 40)
    setBlock(world, 0, 42, 0, STONE)
    actJump(g)
    for (let i = 0; i < 30; i++) { tick(g); assert.ok(!collides(world, g.player.x, g.player.y, g.player.z)) }
  })

  test('быстрое падение не пробивает пол', () => {
    const world = arena()
    const p = newPlayer(0.5, 62, 0.5)
    p.vy = -28
    for (let i = 0; i < 40; i++) stepPlayer(world, p, 0.05)
    assert.equal(p.y, 40)
  })
})

describe('инвентарь', () => {
  test('стопки по 64, инструменты по одному, лишнее не теряется молча', () => {
    let inv = addItem(emptyInventory(), DIRT, 70).inv
    assert.deepEqual([inv[0], inv[1]], [{ item: DIRT, count: STACK }, { item: DIRT, count: 6 }])
    inv = addItem(inv, WOOD_PICKAXE, 2).inv
    assert.equal(inv[2]?.count, 1)
    assert.equal(inv[3]?.count, 1)
    const full = addItem(emptyInventory(), WOOD_SWORD, 30)
    assert.equal(full.left, 3)
  })

  test('removeItem забирает ровно столько или ничего; хотбар опустошается последним', () => {
    const inv = addItem(addItem(emptyInventory(), DIRT, 64).inv, DIRT, 10).inv
    assert.equal(removeItem(inv, DIRT, 75), undefined)
    const less = removeItem(inv, DIRT, 12)
    assert.ok(less)
    assert.equal(countItem(less, DIRT), 62)
    assert.equal(less[1], null)
    assert.equal(takeFromSlot(less, 0)?.[0]?.count, 61)
  })

  test('сериализация туда-обратно, мусор отбрасывается', () => {
    const inv = addItem(addItem(emptyInventory(), LOG, 5).inv, STONE_PICKAXE, 1).inv
    assert.deepEqual(parseInventory(serializeInventory(inv)), inv)
    assert.equal(countItem(parseInventory('999x5,1x-3,чушь,4x2'), LOG), 2)
  })
})

describe('крафт и добыча', () => {
  test('цепочка: бревно → доски → палки → кирка', () => {
    const recipe = (out: number) => RECIPES.find(r => r.out === out)!
    let inv = addItem(emptyInventory(), LOG, 2).inv
    assert.ok(!canCraft(inv, recipe(WOOD_PICKAXE)))
    assert.deepEqual(missing(inv, recipe(WOOD_PICKAXE)), [[PLANKS, 3], [STICK, 2]])
    inv = craft(craft(inv, recipe(PLANKS))!, recipe(PLANKS))!
    assert.equal(countItem(inv, PLANKS), 8)
    inv = craft(inv, recipe(STICK))!
    inv = craft(inv, recipe(WOOD_PICKAXE))!
    assert.equal(countItem(inv, WOOD_PICKAXE), 1)
    assert.equal(countItem(inv, PLANKS), 3)
    assert.equal(countItem(inv, STICK), 2)
    assert.equal(craft(emptyInventory(), recipe(PLANKS)), undefined)
  })

  test('кирка ускоряет камень и даёт дроп; рукой камень не выпадает; дно мира не ломается', () => {
    assert.ok(breakSeconds(STONE, WOOD_PICKAXE, 10) < breakSeconds(STONE, undefined, 10) / 4)
    assert.ok(breakSeconds(STONE, STONE_PICKAXE, 10) < breakSeconds(STONE, WOOD_PICKAXE, 10))
    assert.equal(breakSeconds(LOG, WOOD_PICKAXE, 10), breakSeconds(LOG, undefined, 10))
    assert.equal(dropOf(STONE, undefined), undefined)
    assert.equal(dropOf(STONE, WOOD_PICKAXE), STONE)
    assert.equal(dropOf(GRASS, undefined), DIRT)
    assert.equal(dropOf(LEAVES, undefined), undefined)
    assert.equal(breakSeconds(STONE, STONE_PICKAXE, 0), Infinity)
    for (const r of RECIPES) assert.ok(r.needs.length > 0 && r.count > 0)
  })
})

describe('игра', () => {
  const lookAt = (g: Game, x: number, y: number, z: number) => {
    const p = g.player
    const dx = x - p.x, dy = y - (p.y + EYE), dz = z - p.z
    actLook(g, Math.atan2(dx, dz) - p.yaw, Math.atan2(dy, Math.hypot(dx, dz)) - p.pitch)
  }

  test('новая игра: игрок на земле, под прицелом блок, version растёт от видимых изменений', () => {
    const g = newGame(1)
    ticks(g, 20)
    assert.ok(g.player.onGround)
    assert.ok(!collides(g.world, g.player.x, g.player.y, g.player.z))
    const v = g.version
    ticks(g, 5)
    assert.equal(g.version, v, 'стоячий мир кадр не пересчитывает')
    actLook(g, 0.3, 0)
    assert.ok(g.version > v)
  })

  test('добыча: нажатие начинает, идёт сама, даёт предмет; уход прицела сбрасывает', () => {
    const g = newGame(1)
    ticks(g, 20)
    lookAt(g, g.player.x + 0.2, g.player.y - 0.5, g.player.z + 1.2)
    const t = g.target
    assert.ok(t && t.dist <= REACH)
    assert.equal(t.id, GRASS)
    actMine(g)
    assert.ok(g.mining)
    ticks(g, 4)
    assert.ok(g.mining && g.mining.progress > 0 && g.mining.progress < 1)
    actLook(g, 1.5, 0)
    assert.equal(g.mining, undefined, 'отвернулся — добыча сброшена')
    assert.equal(getBlock(g.world, t.x, t.y, t.z), GRASS)

    lookAt(g, t.x + 0.5, t.y + 0.9, t.z + 0.5)
    actMine(g)
    ticks(g, 40)
    assert.equal(getBlock(g.world, t.x, t.y, t.z), AIR)
    assert.equal(countItem(g.inventory, DIRT), 1)
    assert.ok(g.dirty)
    assert.match(g.note, /земля/)
  })

  test('установка: тратит блок из руки, в себя и без блока в руке не ставит', () => {
    const g = newGame(1)
    ticks(g, 20)
    lookAt(g, g.player.x, g.player.y - 1, g.player.z + 2.5)
    const t = g.target!
    actPlace(g)
    assert.match(g.note, /нет блока/)
    give(g, PLANKS, 2)
    actPlace(g)
    assert.equal(getBlock(g.world, t.x + t.nx, t.y + t.ny, t.z + t.nz), PLANKS)
    assert.equal(countItem(g.inventory, PLANKS), 1)
    // под ноги себе поставить нельзя
    actLook(g, 0, -3)
    const under = g.target!
    assert.equal(under.ny, 1)
    actPlace(g)
    assert.equal(countItem(g.inventory, PLANKS), 1)
    assert.match(g.note, /стоите вы/)
  })

  test('меню: мир стоит, стрелки выбирают рецепт, Enter крафтит', () => {
    const g = newGame(1)
    ticks(g, 20)
    give(g, LOG, 1)
    actMenu(g)
    const yaw = g.player.yaw
    actLook(g, 1, 0)
    actWalk(g, 1, 0)
    ticks(g, 10)
    assert.equal(g.player.yaw, yaw)
    assert.equal(g.player.px, 0)
    actCraft(g)
    assert.equal(countItem(g.inventory, PLANKS), 4)
    actCursor(g, -1)
    assert.equal(g.cursor, RECIPES.length - 1)
    actCraft(g)
    assert.match(g.note, /не хватает/)
    actMenu(g)
    assert.equal(g.menu, false)
  })

  test('смена слота сбрасывает добычу; слот вне хотбара игнорируется', () => {
    const g = newGame(1)
    ticks(g, 20)
    actLook(g, 0, -1)
    actMine(g)
    assert.ok(g.mining)
    actSelect(g, 3)
    assert.equal(g.mining, undefined)
    actSelect(g, HOTBAR)
    assert.equal(g.selected, 3)
  })

  test('сохранение и загрузка: мир, правки, инвентарь и место — те же; мусор даёт новый мир', () => {
    const g = newGame(7)
    ticks(g, 20)
    give(g, PLANKS, 5)
    lookAt(g, g.player.x, g.player.y - 1, g.player.z + 2.5)
    actPlace(g)
    actSelect(g, 2)
    const save = JSON.parse(JSON.stringify(toSave(g)))
    const back = fromSave(save, 99)
    assert.equal(back.world.seed, 7)
    assert.deepEqual(toSave(back), toSave(g))
    const t = g.target!
    assert.equal(getBlock(back.world, t.x, t.y, t.z), getBlock(g.world, t.x, t.y, t.z))
    for (const junk of [null, 'x', { v: 99 }, { v: 1, seed: 'a' }, { v: 1, seed: 1, player: [1, 2] }, { v: 1, seed: 1, player: [NaN, 1, 1, 1, 1] }]) {
      assert.equal(fromSave(junk, 99).world.seed, 99)
    }
  })

  test('время: шаги логики по настенным часам при любой частоте кадров, простой не проматывается', () => {
    for (const frameMs of [16, 50, 64, 100]) {
      const g = newGame(1)
      let clock = 0
      for (let now = frameMs; now <= 3000; now += frameMs) clock = advance(g, clock, now)
      assert.ok(Math.abs(g.ticks - 3000 / TICK_MS) <= 2, `кадр ${frameMs} мс: ${g.ticks} тиков`)
    }
    const g = newGame(1)
    assert.equal(advance(g, 0, 60_000), 60_000)
    assert.equal(g.ticks, 6)
  })

  // Бот проходит весь цикл игры только действиями игрока: находит дерево, добывает бревно, крафтит
  // доски → палки → деревянную кирку, докапывается до камня, добывает три, крафтит каменную кирку.
  for (const seed of [1, 2, 3, 4, 5]) {
    test(`бот-выживальщик, зерно ${seed}`, () => {
      const g = newGame(seed)
      ticks(g, 20)
      const recipe = (out: number) => RECIPES.findIndex(r => r.out === out)
      const make = (out: number) => {
        if (!g.menu) actMenu(g)
        while (g.cursor !== recipe(out)) actCursor(g, 1)
        const before = countItem(g.inventory, out)
        actCraft(g)
        assert.ok(countItem(g.inventory, out) > before, `крафт ${out}: ${g.note}`)
        actMenu(g)
      }
      const hold = (item: number) => {
        const slot = g.inventory.findIndex(s => s?.item === item)
        assert.ok(slot >= 0 && slot < HOTBAR, `предмет ${item} не в хотбаре`)
        actSelect(g, slot)
      }
      // ломает блок, который реально оказался под прицелом при взгляде в точку; возвращает его вид
      const mineToward = (x: number, y: number, z: number): number => {
        lookAt(g, x, y, z)
        const t = g.target
        // там, куда смотрим, уже пусто (сломали раньше) — не ошибка
        if (!t) return AIR
        const { x: bx, y: by, z: bz, id } = t
        actMine(g)
        for (let i = 0; i < 400 && getBlock(g.world, bx, by, bz) !== AIR; i++) tick(g)
        assert.equal(getBlock(g.world, bx, by, bz), AIR, `блок ${id} не сломался`)
        return id
      }

      // ближайшее дерево
      let tree: { x: number; z: number } | undefined
      for (let r = 1; r < 40 && !tree; r++) for (let z = -r; z <= r && !tree; z++) for (let x = -r; x <= r; x++) {
        if (treeAt(seed, Math.floor(g.player.x) + x, Math.floor(g.player.z) + z)) { tree = { x: Math.floor(g.player.x) + x, z: Math.floor(g.player.z) + z }; break }
      }
      assert.ok(tree, 'дерева рядом нет')
      // идём к нему: повернуться, жать «вперёд»; застрял — прыгнуть, не помогло — обойти боком
      let stuck = 0
      for (let i = 0; i < 2400; i++) {
        const dx = tree.x + 0.5 - g.player.x
        const dz = tree.z + 0.5 - g.player.z
        if (Math.hypot(dx, dz) < 1.6) break
        actLook(g, Math.atan2(dx, dz) - g.player.yaw, 0)
        if (stuck > 12) actWalk(g, 0, stuck % 60 < 30 ? 1 : -1)
        else actWalk(g, 1, 0)
        const was = g.player.x + g.player.z * 3
        tick(g)
        stuck = Math.abs(was - (g.player.x + g.player.z * 3)) < 1e-4 ? stuck + 1 : Math.max(0, stuck - 2)
        if (stuck === 6) actJump(g)
      }
      assert.ok(Math.hypot(tree.x + 0.5 - g.player.x, tree.z + 0.5 - g.player.z) < 2.2, 'до дерева не дошёл')
      ticks(g, 20)

      const base = surfaceHeight(seed, tree.x, tree.z)
      // бьём в сторону ствола; что бы ни оказалось на пути (склон, листва) — ломаем и его
      for (let i = 0; i < 16 && countItem(g.inventory, LOG) < 2; i++) {
        mineToward(tree.x + 0.5, base + 0.5 + (i % 5), tree.z + 0.5)
        ticks(g, 5)
      }
      assert.ok(countItem(g.inventory, LOG) >= 2, `брёвен ${countItem(g.inventory, LOG)}`)
      make(PLANKS)
      make(PLANKS)
      make(STICK)
      make(WOOD_PICKAXE)

      // отходим от ствола и копаем под себя до камня
      actLook(g, Math.PI, 0)
      for (let i = 0; i < 30; i++) { actWalk(g, 1, 0); tick(g) }
      ticks(g, 20)
      hold(WOOD_PICKAXE)
      for (let i = 0; i < 24 && countItem(g.inventory, STONE) < 3; i++) {
        ticks(g, 15)
        // целимся в центр клетки под ногами: при взгляде «строго вниз» у края клетки луч уходит в соседнюю
        const cx = Math.floor(g.player.x) + 0.5
        const cz = Math.floor(g.player.z) + 0.5
        const y = g.player.y
        mineToward(cx, y - 0.5, cz)
        // стоим на краю ямы — шагаем в неё
        if (g.player.y === y && Math.hypot(cx - g.player.x, cz - g.player.z) > 0.05) {
          actLook(g, Math.atan2(cx - g.player.x, cz - g.player.z) - g.player.yaw, 0)
          actWalk(g, 1, 0)
        }
      }
      assert.ok(countItem(g.inventory, STONE) >= 3, `камня ${countItem(g.inventory, STONE)}`)
      make(STONE_PICKAXE)
      assert.equal(countItem(g.inventory, STONE_PICKAXE), 1)
      hold(STONE_PICKAXE)
      assert.equal(heldItem(g), STONE_PICKAXE)
    })
  }
})
