/* @jsx h */
import type { Register } from 'claude-code'

// Модуль хуков. Одна команда, /mine: открывает и закрывает игру над строкой ввода; /mine new [зерно]
// начинает новый мир. Саму игру рисует ./view.tsx в потоке отрисовки; здесь — команда, сохранение
// в $.store и сигнал поверхности, что Claude закончил ход. Команда отвечает сама, модель не
// вызывается; её ответы движок сам подписывает именем плагина (`claude-mine: …`).

// меньше — в поле не помещается даже узкая щель с хотбаром и статусом
const MIN_BAND_ROWS = 8
// больше полоса всё равно не даёт; запас на высокие терминалы
const MAX_BAND_ROWS = 40

let open = false
let save: unknown
let seed = 1
// растёт с каждым новым миром: новый ключ Client → новый экземпляр поверхности
let epoch = 0
// растёт с каждым завершённым ходом; поверхность показывает плашку, когда видит новое значение
let turnsDone = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // непойманный отказ здесь выгрузил бы весь модуль: хранилище стоит сохранения, но не игры
    save = await $.store.get('save').catch(err => $.ui.log(`claude-mine: сохранение не прочитано: ${err}`))
    seed = (Date.now() % 1_000_000_000) | 0
    await $.command.register({
      name: 'mine',
      description: 'Воксельная песочница над строкой ввода: открыть или закрыть; new — новый мир (claude-mine)',
      argumentHint: '[new [зерно] | stop]',
      immediate: true,
    }).catch(err => $.ui.log(`claude-mine: /mine не зарегистрирована: ${err}`))
    return r
  })

  on('command.run', { command: 'mine' }, async ($, e) => {
    const [cmd = '', arg] = e.args.trim().toLowerCase().split(/\s+/)
    if (cmd === 'new') {
      const wanted = Number(arg)
      seed = Number.isInteger(wanted) ? wanted | 0 : (Date.now() % 1_000_000_000) | 0
      save = undefined
      epoch++
      open = true
      await $.store.set('save', null).catch(err => $.ui.log(`claude-mine: сохранение не сброшено: ${err}`))
      $.ui.invalidate('ui.render')
      return { text: `новый мир, зерно ${seed} · кликните по полю над строкой ввода` }
    }
    if (cmd !== '' && cmd !== 'stop') return { text: `не знаю «${cmd}» · /mine открывает и закрывает, /mine new [зерно] — новый мир` }
    open = cmd === 'stop' ? false : !open
    $.ui.invalidate('ui.render')
    return { text: open ? 'кликните по полю над строкой ввода · WASD идти, стрелки или мышь смотреть, q ломать, e ставить, i крафт · Esc возвращает к строке ввода · /mine закрывает' : 'игра закрыта, мир сохранён' }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (open) {
      turnsDone++
      $.ui.invalidate('ui.render')
    }
    return r
  })

  // поверхность присылает сохранение; оно же вернётся ей в props, если экземпляр пересоздадут
  on('ui.message', async ($, e, next) => {
    const data = e.data as { save?: unknown } | null
    if (!data || typeof data !== 'object' || !('save' in data)) return next(e)
    save = data.save
    await $.store.set('save', save).catch(err => $.ui.log(`claude-mine: мир не сохранён: ${err}`))
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // игре нужны клавиши и мышь терминала; опрос занимает полосу сам
    if (!open || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    // полосе достаётся примерно половина высоты терминала минус строка ввода с рамками
    const rows = Math.min(MAX_BAND_ROWS, e.props.maxRows)
    if (rows < MIN_BAND_ROWS) {
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">{`mine: окно низковато (над строкой ввода ${e.props.maxRows} строк из ${MIN_BAND_ROWS}) — растяните терминал хотя бы до ~30 строк, лучше до 45 · /mine закрывает`}</Text>
          {await next(e)}
        </Box>
      )
    }
    const mouse = e.viewport?.isFullscreen !== false
    // в props годится только JSON: undefined движок отвергает, поэтому пустое сохранение — null
    return (
      <Box flexDirection="column">
        <Client key={`mine${epoch}`} module="./view.tsx" width={e.props.bodyColumns} height={rows} props={{ save: save ?? null, seed, done: turnsDone, mouse, rows }} />
        {await next(e)}
      </Box>
    )
  })
}
