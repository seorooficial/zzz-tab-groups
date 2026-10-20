// Las reglas se guardan por clave (título o color del grupo). Si el grupo cambia de nombre o de color,
// la regla (sobre todo el candado 🔒) tiene que seguirlo en vez de quedarse huérfana.
// Solo se mueve cuando el título lleva un rato quieto (ver lib/titles.js): tecleando se pasa por claves
// intermedias («Ads », vacío…) que no deben mover ni robar reglas.
import { groupKey } from './rules.js'
import { loadSettings, saveSettings } from './settings.js'
import { noteTitle, quietLeft, forgetTitle } from './titles.js'

const GK = 'gk:' // gk:<groupId> → la clave que tenía el grupo la última vez que se asentó

export async function syncGroupKeys () {
  const groups = await chrome.tabGroups.query({})
  const stored = await chrome.storage.session.get(groups.map((g) => GK + g.id))
  const missing = {}
  for (const g of groups) if (!(GK + g.id in stored)) missing[GK + g.id] = groupKey(g)
  if (Object.keys(missing).length) await chrome.storage.session.set(missing)
  for (const g of groups) await noteTitle(g)
}

export async function rememberGroup (group) {
  await chrome.storage.session.set({ [GK + group.id]: groupKey(group) })
  await noteTitle(group)
}

// Cuando se pone o quita una regla a mano, la clave actual del grupo pasa a ser su clave «asentada».
export function setGroupKey (groupId, key) {
  return chrome.storage.session.set({ [GK + groupId]: key })
}

export async function forgetGroup (groupId) {
  await chrome.storage.session.remove(GK + groupId)
  await forgetTitle(groupId)
}

// Para cada grupo con el título quieto: si su clave cambió, mueve su regla a la clave nueva
// (salvo que otro grupo siga usando la vieja; y si la nueva ya tenía regla, se conservan las dos).
export async function settleRenames (now = Date.now()) {
  const groups = await chrome.tabGroups.query({})
  const stored = await chrome.storage.session.get(groups.map((g) => GK + g.id))
  let settings = null
  let changed = false
  let retryInMs = 0
  for (const group of groups) {
    const left = await quietLeft(group.id, now)
    if (left > 0) { retryInMs = Math.max(retryInMs, left + 100); continue }
    const newKey = groupKey(group)
    const oldKey = stored[GK + group.id]
    if (oldKey === newKey) continue
    await chrome.storage.session.set({ [GK + group.id]: newKey })
    if (!oldKey) continue
    if (groups.some((g) => g.id !== group.id && groupKey(g) === oldKey)) continue
    settings ??= await loadSettings()
    const rule = settings.rules[oldKey]
    if (!rule || settings.rules[newKey]) continue
    settings.rules[newKey] = rule
    delete settings.rules[oldKey]
    changed = true
  }
  if (changed) await saveSettings(settings)
  return { retryInMs }
}
