// Pantalla de reglas: tiempo por defecto, interruptor del automático y regla por grupo.
// Fuente única de verdad: chrome.storage. Cada cambio se guarda y la página se vuelve a pintar.
import { listGroups } from '../lib/groups.js'
import { loadSettings, saveSettings } from '../lib/settings.js'
import { UNGROUPED_KEY, validUiMinutes } from '../lib/rules.js'
import { WEB_ORIGINS } from '../lib/tabmarks.js'

const COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa7b17'
}

const autoEl = document.getElementById('auto')
const markEl = document.getElementById('mark-groups')
const markTabsEl = document.getElementById('mark-tabs')
const markTabsNote = document.getElementById('mark-tabs-note')
const defaultEl = document.getElementById('default-minutes')
const rulesEl = document.getElementById('rules')
let renders = 0

// Una fila por clave: grupos abiertos, «Sin grupo» y reglas guardadas de grupos hoy cerrados.
async function entries (settings) {
  const seen = new Map()
  let ungrouped = null
  for (const g of await listGroups()) {
    if (g.key === UNGROUPED_KEY) { ungrouped = { key: g.key, name: 'Sin grupo', color: 'grey', note: 'pestañas sueltas, sin grupo: el automático también las duerme con esta regla' }; continue }
    const prev = seen.get(g.key)
    if (prev) { prev.count++; continue }
    seen.set(g.key, { key: g.key, name: g.title || `Grupo ${g.color} (sin nombre)`, color: g.color, count: 1 })
  }
  const open = [...seen.values()].map((e) => ({ ...e, note: e.count > 1 ? `${e.count} grupos con este nombre comparten la regla` : '' }))
  const closed = Object.keys(settings.rules)
    .filter((key) => key !== UNGROUPED_KEY && !seen.has(key))
    .map((key) => ({
      key,
      name: key.startsWith('t:') ? key.slice(2) : `Grupo ${key.slice(2)} (sin nombre)`,
      color: key.startsWith('c:') ? key.slice(2) : 'grey',
      note: 'cerrado ahora'
    }))
  return [...open, ...(ungrouped ? [ungrouped] : []), ...closed]
}

function radio (index, value, label, checked) {
  const wrap = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'radio'
  input.name = `mode-${index}`
  input.value = value
  input.checked = checked
  const text = document.createElement('span')
  text.textContent = label
  wrap.append(input, text)
  return { wrap, text }
}

function ruleRow (entry, index, settings) {
  const rule = settings.rules[entry.key] || { mode: 'default' }
  const li = document.createElement('li')
  li.className = 'rule'
  li.dataset.ruleKey = entry.key

  const name = document.createElement('div')
  name.className = 'name'
  const title = document.createElement('b')
  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.style.background = COLORS[entry.color] || COLORS.grey
  title.append(dot, document.createTextNode(entry.name))
  name.append(title)
  if (entry.note) {
    const note = document.createElement('small')
    note.textContent = entry.note
    name.append(note)
  }

  const modes = document.createElement('fieldset')
  modes.className = 'modes'
  const legend = document.createElement('legend')
  legend.className = 'sr-only'
  legend.textContent = `Regla para ${entry.name}`
  const def = radio(index, 'default', `Defecto (${settings.defaultMinutes} min)`, rule.mode === 'default')
  const min = radio(index, 'minutes', 'Minutos', rule.mode === 'minutes')
  const minutes = document.createElement('input')
  minutes.type = 'number'
  minutes.className = 'minutes'
  minutes.min = '1'
  minutes.step = '1'
  minutes.inputMode = 'numeric'
  minutes.setAttribute('aria-label', `Minutos sin usar para ${entry.name}`)
  minutes.value = rule.mode === 'minutes' ? String(rule.minutes) : ''
  min.text.append(minutes)
  const never = radio(index, 'never', '🔒 Nunca', rule.mode === 'never')
  modes.append(legend, def.wrap, min.wrap, never.wrap)

  li.append(name, modes)
  return li
}

async function render () {
  const settings = await loadSettings()
  autoEl.checked = settings.autoEnabled
  markEl.checked = settings.markGroups
  markTabsEl.checked = settings.markTabs
  if (document.activeElement !== defaultEl) defaultEl.value = String(settings.defaultMinutes)
  const rows = await entries(settings)
  rulesEl.replaceChildren(...rows.map((entry, i) => ruleRow(entry, i, settings)))
  rulesEl.dataset.renders = String(++renders)
}

async function update (mutator) {
  const settings = await loadSettings()
  mutator(settings)
  await saveSettings(settings)
}

autoEl.addEventListener('change', () => update((s) => { s.autoEnabled = autoEl.checked }))
markEl.addEventListener('change', () => update((s) => { s.markGroups = markEl.checked }))

// El permiso de modificar títulos de las webs es opcional: solo se pide al activar el interruptor (gesto del usuario)
// y se retira al apagarlo. Sin permiso, Zzz sigue durmiendo pestañas, solo que sin el 💤 en el título.
markTabsEl.addEventListener('change', async () => {
  const want = markTabsEl.checked
  if (want) {
    const granted = await chrome.permissions.request({ origins: WEB_ORIGINS }).catch(() => false)
    if (!granted) {
      markTabsEl.checked = false
      markTabsNote.textContent = 'Sin ese permiso Zzz no puede poner el 💤 en el título de la pestaña. Puedes volver a activarlo cuando quieras.'
      return
    }
  } else {
    await chrome.permissions.remove({ origins: WEB_ORIGINS }).catch(() => false)
  }
  await update((s) => { s.markTabs = want })
})

defaultEl.addEventListener('change', () => {
  const n = Number(defaultEl.value)
  if (validUiMinutes(n)) update((s) => { s.defaultMinutes = n })
  else render()
})

rulesEl.addEventListener('change', (event) => {
  const row = event.target.closest('[data-rule-key]')
  if (!row) return
  const key = row.dataset.ruleKey
  const minutesEl = row.querySelector('.minutes')
  if (event.target === minutesEl) {
    const n = Number(minutesEl.value)
    if (validUiMinutes(n)) update((s) => { s.rules[key] = { mode: 'minutes', minutes: n } })
    else render()
    return
  }
  if (event.target.type !== 'radio') return
  update((s) => {
    const typed = Number(minutesEl.value)
    if (event.target.value === 'default') delete s.rules[key]
    else if (event.target.value === 'never') s.rules[key] = { mode: 'never' }
    else s.rules[key] = { mode: 'minutes', minutes: validUiMinutes(typed) ? typed : s.defaultMinutes }
  })
})

chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') render() })

await render()
