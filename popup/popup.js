// Popup de Zzz: grupos (y «Sin grupo») con dormir / despertar / candado, y la lista de sus pestañas.
import { listGroups } from '../lib/groups.js'
import { loadSettings, saveSettings } from '../lib/settings.js'
import { unmarkTabTitle } from '../lib/rules.js'

const COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa7b17'
}

const listEl = document.getElementById('groups')
const statusEl = document.getElementById('status')
const autoEl = document.getElementById('auto')
const noticeEl = document.getElementById('notice')
const sweepBtn = document.getElementById('sweep-now')
const otherBtn = document.getElementById('other-windows')
const expanded = new Set() // ids de grupo desplegados (-1 = «Sin grupo»)
let lastGroups = []

function button (action, label, title, { disabled = false, on = false } = {}) {
  const el = document.createElement('button')
  el.type = 'button'
  el.dataset.action = action
  el.textContent = label
  el.title = title
  el.setAttribute('aria-label', title)
  el.disabled = disabled
  if (on) el.classList.add('on')
  return el
}

// Qué hará el automático con este grupo, dicho en claro (también para «Sin grupo»).
function autoNote (group) {
  if (group.locked) return ' · 🔒 nunca'
  if (!group.autoEnabled) return ' · auto apagado'
  return ` · auto ${group.minutes} min`
}

function tabRow (tab) {
  const asleep = Boolean(tab.discarded)
  const row = document.createElement('div')
  row.className = asleep ? 'tab asleep' : 'tab'
  row.dataset.tabId = String(tab.id)
  row.dataset.asleep = String(asleep)

  const state = document.createElement('span')
  state.className = 'state'
  state.textContent = asleep ? '💤' : '●'
  state.title = asleep ? 'Dormida' : 'Despierta'

  const title = document.createElement('span')
  title.className = 'title'
  const shown = unmarkTabTitle(tab.title) // el 💤 ya se ve en la columna de estado
  title.textContent = shown || 'Sin título'
  title.title = shown

  const act = asleep
    ? button('wake-tab', '☀️', 'Despertar solo esta pestaña')
    : button('sleep-tab', '💤', tab.audible ? 'Está sonando: no se duerme' : tab.active ? 'Dormir (pasarás a la pestaña de al lado)' : 'Dormir solo esta pestaña', { disabled: Boolean(tab.audible) })
  row.append(state, title, act)
  return row
}

function row (group) {
  const asleep = group.tabs.filter((t) => t.discarded).length
  const total = group.tabs.length
  const open = expanded.has(group.groupId)
  const li = document.createElement('li')
  li.className = 'row'
  li.dataset.groupId = String(group.groupId)

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.style.background = COLORS[group.color] || COLORS.grey

  const name = document.createElement('div')
  name.className = 'name'
  const title = document.createElement('b')
  title.textContent = group.title || `Grupo ${group.color}`
  const detail = document.createElement('small')
  detail.textContent = `${total} pestañas · ${asleep} dormidas${autoNote(group)}`
  name.append(title, detail)

  const actions = document.createElement('div')
  actions.className = 'actions'
  const toggle = button('toggle', open ? '▴' : '▾', open ? 'Ocultar las pestañas' : 'Ver las pestañas', { disabled: total === 0 })
  toggle.setAttribute('aria-expanded', String(open))
  actions.append(
    toggle,
    button('lock', '🔒', group.locked ? 'Quitar el candado «nunca dormir»' : 'Poner candado «nunca dormir»', { on: group.locked }),
    button('wake', '☀️', 'Despertar el grupo', { disabled: asleep === 0 }),
    button('sleep', '💤', 'Dormir el grupo', { disabled: total - asleep === 0 })
  )

  li.append(dot, name, actions)
  if (open) {
    const tabs = document.createElement('div')
    tabs.className = 'tabs'
    tabs.append(...group.tabs.map(tabRow))
    li.append(tabs)
  }
  return li
}

// Qué elemento tenía el foco (por su grupo, su pestaña y su acción), para devolvérselo tras repintar.
function focusedSpot () {
  const el = document.activeElement
  if (!el || !el.dataset || !el.dataset.action || !listEl.contains(el)) return null
  const group = el.closest('[data-group-id]')
  const tab = el.closest('[data-tab-id]')
  return { action: el.dataset.action, groupId: group?.dataset.groupId, tabId: tab?.dataset.tabId }
}

function restoreFocus (spot) {
  if (!spot) return
  const base = `[data-group-id="${spot.groupId}"]`
  const exact = spot.tabId ? listEl.querySelector(`${base} [data-tab-id="${spot.tabId}"] [data-action="${spot.action}"]`) : null
  const el = exact ?? listEl.querySelector(`${base} > .actions [data-action="${spot.action}"]`) ?? listEl.querySelector(`${base} [data-action="toggle"]`)
  if (el && !el.disabled) el.focus({ preventScroll: true })
}

export function render (groups) {
  lastGroups = groups
  const spot = focusedSpot()
  listEl.replaceChildren(...groups.map(row))
  restoreFocus(spot)
  const sleeping = groups.reduce((n, g) => n + g.tabs.filter((t) => t.discarded).length, 0)
  const total = groups.reduce((n, g) => n + g.tabs.length, 0)
  statusEl.textContent = `${sleeping} de ${total} dormidas`
}

// Dormir, despertar y candado los ejecuta el service worker (ver background.js).
const MESSAGES = { sleep: 'sleep-group', wake: 'wake-group', lock: 'toggle-lock', 'sleep-tab': 'sleep-tab', 'wake-tab': 'wake-tab' }

async function send (zzz, args) {
  const reply = await chrome.runtime.sendMessage({ zzz, ...args })
  if (!reply?.ok) throw new Error(reply?.error || 'El service worker no respondió')
  return reply.result
}

let manualNotice = ''

// Aviso persistente: si el último barrido del automático no pudo dormir algo, no se queda en silencio.
async function autoNotice () {
  const { sweepfail } = await chrome.storage.session.get('sweepfail')
  if (!sweepfail || Date.now() - sweepfail.at > 30 * 60000) return ''
  const n = sweepfail.count
  return `El automático no pudo dormir ${n} ${n === 1 ? 'pestaña' : 'pestañas'} (Chromium se negó o hubo un error). Lo reintenta cada minuto.`
}

async function refresh () {
  const [groups, settings, auto] = await Promise.all([listGroups(), loadSettings(), autoNotice()])
  render(groups)
  autoEl.checked = settings.autoEnabled
  otherBtn.hidden = (await chrome.windows.getAll({ windowTypes: ['normal'] })).length < 2 // solo con más de una ventana
  showNotice(manualNotice || auto)
}

// El popup se mantiene al día solo: si algo cambia mientras está abierto (el automático duerme algo, cierras una
// pestaña…), se repinta con un pequeño margen para agrupar ráfagas de eventos. No repinta con el ratón pulsado
// (se perdería el clic) y, al repintar, no mueve el scroll.
let liveTimer = null
let pressedAt = 0
const scheduleRefresh = () => {
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    if (pressedAt && Date.now() - pressedAt < 3000) { scheduleRefresh(); return }
    pressedAt = 0
    refresh().catch(() => {})
  }, 250)
}
listEl.addEventListener('pointerdown', () => { pressedAt = Date.now() }, true)
const release = () => { if (pressedAt) { pressedAt = 0; scheduleRefresh() } }
window.addEventListener('pointerup', release)
window.addEventListener('pointercancel', release)
for (const event of [
  chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onRemoved, chrome.tabs.onCreated, chrome.tabs.onReplaced,
  chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved
]) event.addListener(scheduleRefresh)
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') scheduleRefresh() }) // la sesión cambia cada minuto: no cuenta

// Por qué «no pasó nada» (o no todo): se dice, en vez de quedarse en silencio.
function sleepNotice (result) {
  if (!result) return ''
  if (result.failed > 0) return failedText(result.failed)
  if (result.slept > 0) return ''
  if (result.reason === 'audible') return 'Esa pestaña está sonando: no se duerme.'
  if (result.reason === 'only-tab') return 'Es la única pestaña de la ventana: no hay otra a la que pasar.'
  if (result.skipped > 0) return 'No había nada que dormir: la pestaña activa y las que suenan no se duermen.'
  return ''
}

function showNotice (text) {
  noticeEl.textContent = text
  noticeEl.hidden = !text
}

autoEl.addEventListener('change', async () => {
  const checked = autoEl.checked // se lee YA: un repintado en vivo no debe cambiar lo que el usuario acaba de pulsar
  const settings = await loadSettings()
  settings.autoEnabled = checked
  await saveSettings(settings)
  await refresh()
})

const failedText = (n) => `No se pudo dormir ${n} ${n === 1 ? 'pestaña' : 'pestañas'}: Chromium se negó o hubo un error.`

sweepBtn.addEventListener('click', async () => {
  sweepBtn.disabled = true
  manualNotice = ''
  try {
    const r = await send('sweep-now')
    if (r.failed > 0) manualNotice = failedText(r.failed)
    else if (r.slept > 0) manualNotice = `Barrido: ${r.slept} ${r.slept === 1 ? 'pestaña dormida' : 'pestañas dormidas'}.`
    else manualNotice = 'Nada que dormir ahora: ninguna lleva más del tiempo de su regla sin usarse.'
  } finally {
    sweepBtn.disabled = false
    await refresh()
  }
})

otherBtn.addEventListener('click', async () => {
  otherBtn.disabled = true
  manualNotice = ''
  try {
    const win = await chrome.windows.getCurrent()
    const r = await send('sleep-other-windows', { windowId: win.id })
    if (r.failed > 0) manualNotice = failedText(r.failed)
    else if (r.slept > 0) manualNotice = `Dormidas ${r.slept} ${r.slept === 1 ? 'pestaña' : 'pestañas'} de las demás ventanas.`
    else manualNotice = 'No había nada que dormir en las demás ventanas (la activa de cada una no se duerme).'
  } finally {
    otherBtn.disabled = false
    await refresh()
  }
})

document.getElementById('rules').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
  window.close()
})

listEl.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]')
  if (!btn || btn.disabled) return
  const action = btn.dataset.action
  const groupId = Number(btn.closest('[data-group-id]').dataset.groupId)
  if (action === 'toggle') {
    if (expanded.has(groupId)) expanded.delete(groupId)
    else expanded.add(groupId)
    render(lastGroups)
    return
  }
  btn.disabled = true
  manualNotice = ''
  try {
    const tabEl = btn.closest('[data-tab-id]')
    const result = await send(MESSAGES[action], tabEl ? { tabId: Number(tabEl.dataset.tabId) } : { groupId })
    if (action === 'sleep' || action === 'sleep-tab') manualNotice = sleepNotice(result)
  } finally {
    await refresh()
  }
})

await refresh()
