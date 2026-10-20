// Service worker de Zzz: solo cablea menús y atajo; la lógica vive en lib/.
import { listGroups, sleepGroup, sleepOthers, sleepOtherWindows, wakeGroup, toggleLock, sleepTab, wakeTab } from './lib/groups.js'
import { refreshChips } from './lib/chips.js'
import { MENUS, MENU_CONTEXTS } from './lib/menus.js'
import { WEB_ORIGINS } from './lib/tabmarks.js'
import { loadSettings, saveSettings } from './lib/settings.js'
import { sweep } from './lib/sweep.js'
import { noteActivated, noteAudible, syncActivity, forgetTab } from './lib/activity.js'
import { syncGroupKeys, rememberGroup, settleRenames, forgetGroup } from './lib/groupkeys.js'
import { noteTitle } from './lib/titles.js'
import { EDIT_QUIET_MS } from './lib/rules.js'

// Clic derecho en el contenido de la página y en una pestaña de la barra de pestañas.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create({ ...menu, contexts: MENU_CONTEXTS })
  })
})

// `tab` es la pestaña pulsada; su groupId es -1 si no tiene grupo («Sin grupo»).
async function handleMenu (menuItemId, tab) {
  if (!tab) return
  const groupId = tab.groupId
  switch (menuItemId) {
    case 'sleep-tab': return sleepTab(tab.id)
    case 'sleep-group': return sleepGroup(groupId)
    case 'sleep-others': return sleepOthers(groupId)
    case 'toggle-lock': return toggleLock(groupId)
    case 'wake-group': return wakeGroup(groupId)
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => { handleMenu(info.menuItemId, tab) })

// Atajos de teclado: actúan sobre la pestaña activa de la ventana enfocada.
async function handleCommand (command) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) return undefined
  if (command === 'sleep-current-group') return handleMenu('sleep-group', tab)
  if (command === 'sleep-current-tab') return handleMenu('sleep-tab', tab)
  return undefined
}
chrome.commands.onCommand.addListener((command) => { handleCommand(command) })

// Seguimiento de uso (ver lib/activity.js). Los eventos se procesan de uno en uno para no pisarse.
let queue = Promise.resolve()
const enqueue = (job) => { queue = queue.then(job).catch((err) => console.error('Zzz:', err)) }

// Los 💤 de los chips de grupo se recalculan (con un pequeño margen) cuando algo cambia. Si alguien está
// editando un título, refreshChips pide esperar y se vuelve a intentar cuando lleve quieto el tiempo debido.
let chipsTimer = null
const scheduleChips = (delay = 400) => {
  clearTimeout(chipsTimer)
  chipsTimer = setTimeout(() => enqueue(async () => {
    const { retryInMs } = await refreshChips()
    if (retryInMs) scheduleChips(retryInMs)
  }), delay)
}

// Las reglas siguen a su grupo si cambia de nombre, pero solo cuando el título se queda quieto.
let settleTimer = null
const scheduleSettle = (delay = EDIT_QUIET_MS + 200) => {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => enqueue(async () => {
    const { retryInMs } = await settleRenames()
    if (retryInMs) scheduleSettle(retryInMs)
  }), delay)
}

chrome.tabs.onActivated.addListener((info) => { enqueue(() => noteActivated(info)); scheduleChips() })
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { // Chrome no admite filtros en este evento
  if (changeInfo.audible) enqueue(() => noteAudible(tabId))
  if ('discarded' in changeInfo || 'groupId' in changeInfo) scheduleChips()
})
chrome.tabs.onRemoved.addListener((tabId) => { enqueue(() => forgetTab(tabId)); scheduleChips() })
chrome.tabs.onCreated.addListener(scheduleChips)
chrome.tabs.onReplaced.addListener(scheduleChips) // dormir una pestaña la sustituye por otra
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') scheduleChips() }) // interruptor 💤

// Una regla sigue a su grupo si cambia de nombre o de color.
chrome.tabGroups.onCreated.addListener((group) => { enqueue(() => rememberGroup(group)); scheduleChips() })
chrome.tabGroups.onUpdated.addListener((group) => { enqueue(() => noteTitle(group)); scheduleChips(); scheduleSettle() })
chrome.tabGroups.onRemoved.addListener((group) => enqueue(() => forgetGroup(group.id)))

// Si el usuario retira el acceso a las webs (desde chrome://extensions), el interruptor del 💤 se apaga solo.
async function syncMarkTabs () {
  const settings = await loadSettings()
  if (!settings.markTabs) return
  if (await chrome.permissions.contains({ origins: WEB_ORIGINS })) return
  settings.markTabs = false
  await saveSettings(settings)
}
chrome.permissions.onRemoved.addListener(() => enqueue(syncMarkTabs))

// Cada vez que el service worker despierta: foto del estado actual.
enqueue(syncActivity)
enqueue(syncGroupKeys)
enqueue(syncMarkTabs)
scheduleChips()

// Barrido del automático: cada minuto. Las alarmas pueden perderse al reiniciar el navegador,
// así que se comprueba al instalar, al arrancar y cada vez que el service worker despierta.
const SWEEP_ALARM = 'sweep'
async function ensureAlarm () {
  if (!(await chrome.alarms.get(SWEEP_ALARM))) chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 })
}
chrome.runtime.onInstalled.addListener(ensureAlarm)
chrome.runtime.onStartup.addListener(ensureAlarm)
ensureAlarm()
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SWEEP_ALARM) return
  sweep()
  enqueue(settleRenames) // por si el service worker murió antes de asentar un renombrado
})

// Las acciones del popup las ejecuta el service worker: el popup se cierra (y su código muere) en cuanto
// cambia la pestaña activa, lo que cortaría a medias dormir o despertar.
const ACTIONS = {
  'sleep-tab': ({ tabId }) => sleepTab(tabId),
  'wake-tab': ({ tabId }) => wakeTab(tabId),
  'sleep-group': ({ groupId }) => sleepGroup(groupId),
  'wake-group': ({ groupId }) => wakeGroup(groupId),
  'toggle-lock': ({ groupId }) => toggleLock(groupId),
  'sleep-other-windows': ({ windowId }) => sleepOtherWindows(windowId),
  'sweep-now': () => sweep(Date.now(), { force: true })
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !Object.hasOwn(ACTIONS, message?.zzz)) return false
  ACTIONS[message.zzz](message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: String(error) })
  )
  return true // respuesta asíncrona
})

// API interna: la usan las pruebas e2e (el service worker no es accesible desde las webs).
globalThis.zzz = { listGroups, sleepGroup, sleepOthers, wakeGroup, toggleLock, sleepTab, wakeTab, refreshChips, settleRenames, syncMarkTabs, handleMenu, handleCommand, sleepOtherWindows, sweep, loadSettings, saveSettings }
