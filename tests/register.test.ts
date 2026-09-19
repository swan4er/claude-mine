// Тесты хуков и поверхности в окружении движка. Запуск: claude plugin test .
// Игровая логика проверяется отдельно (tests/*.spec.ts, node --test): поверхность считает время по
// настоящим часам, а тестовый `ui.advance` двигает только таймер кадров.
import type { On, RenderElement } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

// что движок рисует в полосе сам, «под» плагином
const BENEATH: RenderElement = { type: 'Text', children: [''] }
const run = (args: string) => ({ command: 'mine', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const
const band = (maxRows: number) => ({
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 120, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
}) as const

function world(on: On, stored: Record<string, unknown> = {}) {
  mock.clock(on)
  // хранилище отвечает сам тест, чтобы видеть записи
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => BENEATH)
  return stored
}

describe('register', () => {
  test('/mine открывает игру; клавиши открывают меню крафта и выбирают слот; /mine закрывает', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const opened = await $.command.run(run(''))
    expect(opened.text).toContain('кликните по полю')

    const ui = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', ...band(19) })
    expect(await ui.find({ type: 'Text', text: /в руке: ничего/, in: 'mine0' })).toBeDefined()
    // русская раскладка: ш = i
    await ui.key({ key: 'ш' })
    expect(await ui.find({ type: 'Text', text: /Инвентарь и крафт/, in: 'mine0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ доски ×4 ← бревно ×1/, in: 'mine0' })).toBeDefined()
    await ui.key({ key: 'return' })
    expect(await ui.find({ type: 'Text', text: /не хватает материалов/, in: 'mine0' })).toBeDefined()
    await ui.key({ key: 'down' })
    expect(await ui.find({ type: 'Text', text: /▶ палка ×4/, in: 'mine0' })).toBeDefined()
    await ui.key({ key: 'i' })
    expect(await ui.find({ type: 'Text', text: /Инвентарь и крафт/, in: 'mine0' })).toBeUndefined()
    await ui.unmount()

    const closed = await $.command.run(run(''))
    expect(closed.text).toContain('закрыта')
  })

  test('сохранение от поверхности пишется в хранилище; /mine new сбрасывает его и даёт новый экземпляр', async ($, on) => {
    const stored = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(run(''))
    const ui = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', ...band(19) })
    await ui.post({ save: { v: 1, seed: 5, player: [0.5, 30, 0.5, 0, 0], selected: 0, inventory: '', edits: '' } }, { in: 'mine0' })
    expect((stored.save as { seed?: number }).seed).toBe(5)
    await ui.unmount()

    const fresh = await $.command.run(run('new 77'))
    expect(fresh.text).toContain('зерно 77')
    expect(stored.save).toBe(null)
    const next = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', ...band(19) })
    expect(await next.find({ type: 'Text', text: /в руке/, in: 'mine1' })).toBeDefined()
    await next.unmount()
  })

  test('сохранённый мир поднимается при старте сессии', async ($, on) => {
    world(on, { save: { v: 1, seed: 9, player: [0.5, 40, 0.5, 0, 0], selected: 2, inventory: '4x7,,101x1', edits: '' } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(run(''))
    const ui = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', ...band(19) })
    expect(await ui.find({ type: 'Text', text: /в руке: деревянная кирка/, in: 'mine0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1:бр7/, in: 'mine0' })).toBeDefined()
    await ui.unmount()
  })

  test('в низком окне вместо игры — строка с объяснением; в обычном режиме — подсказка про мышь', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(run(''))
    const low = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', ...band(6) })
    expect(await low.find({ type: 'Text', text: /низковато/ })).toBeDefined()
    expect(await low.find({ type: 'Client' })).toBeUndefined()
    await low.unmount()

    const plain = await $.ui.mount({ plugin: 'claude-mine', surface: 'terminal', viewport: { columns: 120, rows: 50, isFullscreen: false }, ...band(19) })
    expect(await plain.find({ type: 'Text', text: /tui fullscreen/, in: 'mine0' })).toBeDefined()
    await plain.unmount()
  })
})
