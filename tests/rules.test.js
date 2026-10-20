import test from 'node:test'
import assert from 'node:assert/strict'
import {
  UNGROUPED_KEY, DEFAULT_SETTINGS, AUDIBLE_GRACE_MS, groupKey, normalizeSettings,
  limitMinutes, canSleep, lastUseOf, recentlyAudible, shouldAutoSleep, stripMarks, removeMarks, markedTitle, EDIT_QUIET_MS,
  markTabTitle, unmarkTabTitle, validUiMinutes
} from '../lib/rules.js'
import { MENUS, MENU_CONTEXTS } from '../lib/menus.js'

const MIN = 60000

test('groupKey usa el título si existe', () => {
  assert.equal(groupKey({ title: 'Ads', color: 'red' }), 't:Ads')
})

test('groupKey usa el color si el título está vacío o falta', () => {
  assert.equal(groupKey({ title: '', color: 'red' }), 'c:red')
  assert.equal(groupKey({ color: 'blue' }), 'c:blue')
})

test('DEFAULT_SETTINGS es el acordado en el diseño', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { autoEnabled: true, markGroups: true, markTabs: false, defaultMinutes: 15, rules: {} })
  assert.equal(UNGROUPED_KEY, '__sin_grupo__')
})

test('normalizeSettings devuelve los valores por defecto con basura', () => {
  for (const raw of [null, undefined, 'x', 42, [], { defaultMinutes: -3 }, { defaultMinutes: NaN }, { defaultMinutes: '20' }]) {
    const s = normalizeSettings(raw)
    assert.equal(s.defaultMinutes, 15, `defaultMinutes con ${JSON.stringify(raw)}`)
    assert.equal(s.autoEnabled, true)
    assert.deepEqual(s.rules, {})
  }
})

test('normalizeSettings conserva lo válido', () => {
  const s = normalizeSettings({
    autoEnabled: false,
    defaultMinutes: 20,
    rules: { 't:Ads': { mode: 'never' }, 't:Parking': { mode: 'minutes', minutes: 5 } }
  })
  assert.equal(s.autoEnabled, false)
  assert.equal(s.defaultMinutes, 20)
  assert.deepEqual(s.rules['t:Ads'], { mode: 'never' })
  assert.deepEqual(s.rules['t:Parking'], { mode: 'minutes', minutes: 5 })
})

test('normalizeSettings: las reglas inválidas o en «default» no se guardan (equivalen a no tener regla)', () => {
  const s = normalizeSettings({
    rules: {
      a: { mode: 'zzz' },
      b: { mode: 'minutes', minutes: -1 },
      c: { mode: 'minutes' },
      d: 'nope',
      e: { mode: 'default' },
      f: { mode: 'never' }
    }
  })
  assert.deepEqual(s.rules, { f: { mode: 'never' } })
})

test('normalizeSettings no comparte estado con DEFAULT_SETTINGS', () => {
  const s = normalizeSettings(null)
  s.rules.x = { mode: 'never' }
  assert.deepEqual(DEFAULT_SETTINGS.rules, {})
})

test('limitMinutes: defecto, never, minutes y sin grupo', () => {
  const s = normalizeSettings({
    rules: { 't:Ads': { mode: 'never' }, 't:Parking': { mode: 'minutes', minutes: 30 } }
  })
  assert.equal(limitMinutes(s, 't:Otro'), 15)
  assert.equal(limitMinutes(s, 't:Ads'), Infinity)
  assert.equal(limitMinutes(s, 't:Parking'), 30)
  assert.equal(limitMinutes(s, UNGROUPED_KEY), 15)
})

test('limitMinutes: «Sin grupo» puede tener regla propia', () => {
  const s = normalizeSettings({ rules: { [UNGROUPED_KEY]: { mode: 'minutes', minutes: 7 } } })
  assert.equal(limitMinutes(s, UNGROUPED_KEY), 7)
})

test('canSleep: nunca la activa, la que suena ni la ya dormida', () => {
  assert.equal(canSleep({ active: true }), false)
  assert.equal(canSleep({ audible: true }), false)
  assert.equal(canSleep({ discarded: true }), false)
  assert.equal(canSleep({ active: false, audible: false, discarded: false }), true)
})

test('canSleep: las fijadas SÍ se pueden dormir', () => {
  assert.equal(canSleep({ pinned: true, active: false, audible: false, discarded: false }), true)
})

test('shouldAutoSleep: duerme al llegar al límite, no antes', () => {
  const settings = normalizeSettings(null)
  const now = 100 * MIN
  const base = { active: false, audible: false, discarded: false }
  assert.equal(shouldAutoSleep({ ...base, lastAccessed: now - 15 * MIN }, { now, settings, key: 't:X' }), true)
  assert.equal(shouldAutoSleep({ ...base, lastAccessed: now - 14 * MIN }, { now, settings, key: 't:X' }), false)
})

test('shouldAutoSleep: con el automático apagado nunca duerme', () => {
  const settings = normalizeSettings({ autoEnabled: false })
  const tab = { active: false, audible: false, discarded: false, lastAccessed: 0 }
  assert.equal(shouldAutoSleep(tab, { now: 999 * MIN, settings, key: 't:X' }), false)
})

test('shouldAutoSleep: respeta el candado', () => {
  const settings = normalizeSettings({ rules: { 't:Ads': { mode: 'never' } } })
  const tab = { active: false, audible: false, discarded: false, lastAccessed: 0 }
  assert.equal(shouldAutoSleep(tab, { now: 999 * MIN, settings, key: 't:Ads' }), false)
})

test('shouldAutoSleep: nunca la activa ni la que suena aunque lleve horas', () => {
  const settings = normalizeSettings(null)
  const old = { discarded: false, lastAccessed: 0 }
  assert.equal(shouldAutoSleep({ ...old, active: true, audible: false }, { now: 999 * MIN, settings, key: 't:X' }), false)
  assert.equal(shouldAutoSleep({ ...old, active: false, audible: true }, { now: 999 * MIN, settings, key: 't:X' }), false)
})

test('shouldAutoSleep: sin lastAccessed cuenta desde firstSeen', () => {
  const settings = normalizeSettings(null)
  const tab = { active: false, audible: false, discarded: false }
  assert.equal(shouldAutoSleep(tab, { now: 100 * MIN, settings, key: 't:X', firstSeen: 80 * MIN }), true)
  assert.equal(shouldAutoSleep(tab, { now: 100 * MIN, settings, key: 't:X', firstSeen: 90 * MIN }), false)
})

test('shouldAutoSleep: sin ninguna marca de tiempo no duerme (no se sabe cuánto lleva)', () => {
  const settings = normalizeSettings(null)
  const tab = { active: false, audible: false, discarded: false }
  assert.equal(shouldAutoSleep(tab, { now: 999 * MIN, settings, key: 't:X' }), false)
})

test('lastUseOf toma la marca más reciente de las conocidas', () => {
  assert.equal(lastUseOf({ lastAccessed: 100 }, { touchedAt: 300, audibleAt: 200 }), 300)
  assert.equal(lastUseOf({ lastAccessed: 500 }, { touchedAt: 300 }), 500)
  assert.equal(lastUseOf({ lastAccessed: 100 }, { audibleAt: 900 }), 900)
  assert.equal(lastUseOf({}, { firstSeen: 7 }), 7)
  assert.equal(lastUseOf({}, {}), undefined)
})

test('shouldAutoSleep: la pestaña que acabas de dejar no se duerme aunque su lastAccessed sea viejo', () => {
  const settings = normalizeSettings(null)
  const now = 100 * MIN
  const tab = { active: false, audible: false, discarded: false, lastAccessed: now - 60 * MIN }
  assert.equal(shouldAutoSleep(tab, { now, settings, key: 't:X', touchedAt: now - 1 * MIN }), false)
  assert.equal(shouldAutoSleep(tab, { now, settings, key: 't:X' }), true)
})

test('shouldAutoSleep: lo que sonó hace poco cuenta como uso', () => {
  const settings = normalizeSettings(null)
  const now = 100 * MIN
  const tab = { active: false, audible: false, discarded: false, lastAccessed: now - 60 * MIN }
  assert.equal(shouldAutoSleep(tab, { now, settings, key: 't:X', audibleAt: now - 1 * MIN }), false)
})

test('recentlyAudible: dentro y fuera del margen de 60 s', () => {
  assert.equal(AUDIBLE_GRACE_MS, 60000)
  const now = 1000000
  assert.equal(recentlyAudible(now - 30000, now), true)
  assert.equal(recentlyAudible(now - 61000, now), false)
  assert.equal(recentlyAudible(undefined, now), false)
})

test('stripMarks quita el 💤 de Zzz del título del grupo', () => {
  assert.equal(stripMarks('💤 Ads'), 'Ads')
  assert.equal(stripMarks('Parking 💤3/5'), 'Parking')
  assert.equal(stripMarks('💤'), '')
  assert.equal(stripMarks('💤3/5'), '')
  assert.equal(stripMarks('Ads'), 'Ads')
  assert.equal(stripMarks(undefined), '')
})

test('markedTitle: entero dormido, a medias o despierto', () => {
  assert.equal(markedTitle('Ads', 2, 2), '💤 Ads')
  assert.equal(markedTitle('Parking', 3, 5), 'Parking 💤3/5')
  assert.equal(markedTitle('Ads', 0, 2), 'Ads')
  assert.equal(markedTitle('', 2, 2), '💤')
  assert.equal(markedTitle('', 1, 4), '💤1/4')
  assert.equal(markedTitle('Vacío', 0, 0), 'Vacío')
})

test('markedTitle y stripMarks son inversos', () => {
  for (const [base, a, t] of [['Ads', 2, 2], ['Parking', 3, 5], ['Ads', 0, 3], ['', 2, 2], ['', 1, 4]]) {
    assert.equal(stripMarks(markedTitle(base, a, t)), base)
  }
})

test('groupKey ignora el 💤 de Zzz: la regla no cambia al dormir el grupo', () => {
  assert.equal(groupKey({ title: '💤 Ads', color: 'red' }), 't:Ads')
  assert.equal(groupKey({ title: 'Parking 💤3/5', color: 'grey' }), 't:Parking')
  assert.equal(groupKey({ title: '💤', color: 'red' }), 'c:red')
  assert.equal(groupKey({ title: '💤2/2', color: 'blue' }), 'c:blue')
})

test('normalizeSettings: markGroups por defecto true, conserva false, basura → true', () => {
  assert.equal(normalizeSettings(null).markGroups, true)
  assert.equal(normalizeSettings({ markGroups: false }).markGroups, false)
  assert.equal(normalizeSettings({ markGroups: 'no' }).markGroups, true)
})

test('removeMarks quita SOLO la marca de Zzz y respeta el resto del título tal cual', () => {
  assert.equal(removeMarks('💤 Ads'), 'Ads')
  assert.equal(removeMarks('Parking 💤3/5'), 'Parking')
  assert.equal(removeMarks('Google '), 'Google ') // sin recortar
  assert.equal(removeMarks(' Ads'), ' Ads')
  assert.equal(removeMarks('Parking 💤3/5 viejo'), 'Parking viejo') // marca en medio
  assert.equal(removeMarks('Parking 💤3/5Hello'), 'Parking Hello') // texto pegado a la marca
  assert.equal(removeMarks('💤'), '')
  assert.equal(removeMarks('💤3/5'), '')
  assert.equal(removeMarks(undefined), '')
})

test('markedTitle + removeMarks son idempotentes aunque el título tenga espacios del usuario', () => {
  for (const base of ['Google ', ' Ads', 'Ads  cliente', 'Parking']) {
    for (const [a, t] of [[0, 2], [1, 2], [2, 2]]) {
      const once = markedTitle(removeMarks(markedTitle(base, a, t)), a, t)
      assert.equal(once, markedTitle(base, a, t), `${JSON.stringify(base)} ${a}/${t}`)
      assert.equal(removeMarks(markedTitle(base, a, t)), base, `ida y vuelta ${JSON.stringify(base)} ${a}/${t}`)
    }
  }
})

test('groupKey respeta el título del usuario sin recortarlo; solo espacios = sin título', () => {
  assert.equal(groupKey({ title: 'Ads ', color: 'red' }), 't:Ads ')
  assert.equal(groupKey({ title: '💤 Ads ', color: 'red' }), 't:Ads ')
  assert.equal(groupKey({ title: '   ', color: 'blue' }), 'c:blue')
})

test('EDIT_QUIET_MS: Zzz espera 5 s tras la última edición del usuario', () => {
  assert.equal(EDIT_QUIET_MS, 5000)
})

test('normalizeSettings: markTabs por defecto false, conserva true, basura → false', () => {
  assert.equal(normalizeSettings(null).markTabs, false)
  assert.equal(normalizeSettings({ markTabs: true }).markTabs, true)
  assert.equal(normalizeSettings({ markTabs: 'si' }).markTabs, false)
})

test('markTabTitle / unmarkTabTitle: el 💤 de la pestaña dormida', () => {
  assert.equal(markTabTitle('Gmail'), '💤 Gmail')
  assert.equal(markTabTitle('💤 Gmail'), '💤 Gmail') // no se duplica
  assert.equal(markTabTitle(''), '💤')
  assert.equal(unmarkTabTitle('💤 Gmail'), 'Gmail')
  assert.equal(unmarkTabTitle('Gmail'), 'Gmail')
  assert.equal(unmarkTabTitle('💤'), '')
  assert.equal(unmarkTabTitle(undefined), '')
})

test('validUiMinutes: la interfaz exige 1 minuto o más', () => {
  assert.equal(validUiMinutes(1), true)
  assert.equal(validUiMinutes(30), true)
  assert.equal(validUiMinutes(0.5), false)
  assert.equal(validUiMinutes(0), false)
  assert.equal(validUiMinutes(-3), false)
  assert.equal(validUiMinutes(NaN), false)
})

test('menús: ids únicos y salen también sobre enlaces, selección, campos, imágenes, vídeo y la barra de pestañas', () => {
  const ids = MENUS.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(ids, ['sleep-tab', 'sleep-group', 'sleep-others', 'toggle-lock', 'wake-group'])
  for (const ctx of ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'tab']) {
    assert.ok(MENU_CONTEXTS.includes(ctx), `falta el contexto ${ctx}`)
  }
})
