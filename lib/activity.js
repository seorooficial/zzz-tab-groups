// Marcas de uso por pestaña en chrome.storage.session (un fichero por clave: sin lecturas-modificaciones-escrituras).
// Hacen falta porque tab.lastAccessed es «cuándo se hizo activa», no «cuándo se dejó»:
//   touched:<tabId>  → la última vez que se usó o se despertó a propósito
//   audible:<tabId>  → la última vez que sonó (tab.audible solo dura 2 s)
//   active:<winId>   → qué pestaña estaba activa en esa ventana (para saber cuál se acaba de dejar)
const TOUCHED = 'touched:'
const AUDIBLE = 'audible:'
const ACTIVE = 'active:'

export function touchTabs (ids, now = Date.now()) {
  return chrome.storage.session.set(Object.fromEntries(ids.map((id) => [TOUCHED + id, now])))
}

export function noteAudible (tabId, now = Date.now()) {
  return chrome.storage.session.set({ [AUDIBLE + tabId]: now })
}

// Una pestaña pasa a ser la activa: cuenta como uso, y la que estaba activa antes acaba de dejarse.
export async function noteActivated ({ tabId, windowId }, now = Date.now()) {
  const prev = (await chrome.storage.session.get(ACTIVE + windowId))[ACTIVE + windowId]
  const update = { [TOUCHED + tabId]: now, [ACTIVE + windowId]: tabId }
  if (prev !== undefined && prev !== tabId) update[TOUCHED + prev] = now
  await chrome.storage.session.set(update)
}

// Lo que está en uso AHORA: las pestañas activas y las que suenan.
export async function recordUse (tabs, now = Date.now()) {
  const update = {}
  for (const tab of tabs) {
    if (tab.active) { update[TOUCHED + tab.id] = now; update[ACTIVE + tab.windowId] = tab.id }
    if (tab.audible) update[AUDIBLE + tab.id] = now
  }
  if (Object.keys(update).length) await chrome.storage.session.set(update)
}

export async function syncActivity (now = Date.now()) {
  await recordUse(await chrome.tabs.query({}), now)
}

export async function readActivity () {
  const touched = {}
  const audible = {}
  for (const [key, value] of Object.entries(await chrome.storage.session.get(null))) {
    if (key.startsWith(TOUCHED)) touched[Number(key.slice(TOUCHED.length))] = value
    else if (key.startsWith(AUDIBLE)) audible[Number(key.slice(AUDIBLE.length))] = value
  }
  return { touched, audible }
}

export function forgetTab (tabId) {
  return chrome.storage.session.remove([TOUCHED + tabId, AUDIBLE + tabId])
}

// Borra las marcas de pestañas que ya no existen.
export async function forgetTabsExcept (liveIds) {
  const live = new Set(liveIds)
  const { touched, audible } = await readActivity()
  const stale = [
    ...Object.keys(touched).filter((id) => !live.has(Number(id))).map((id) => TOUCHED + id),
    ...Object.keys(audible).filter((id) => !live.has(Number(id))).map((id) => AUDIBLE + id)
  ]
  if (stale.length) await chrome.storage.session.remove(stale)
}
