// ¿Alguien está editando el título de un grupo? Zzz no lo toca mientras tanto: el editor de Chromium
// escribe el título en cada tecla y, si cambia desde fuera, pisa lo que se está tecleando.
// Marcas en chrome.storage.session, por grupo:
//   gt:<groupId> → último título visto      gw:<groupId> → último título que escribió Zzz
//   ge:<groupId> → cuándo lo cambió otro (el usuario) por última vez
import { EDIT_QUIET_MS } from './rules.js'

const TITLE = 'gt:'
const WRITTEN = 'gw:'
const EDITED = 'ge:'

// Se llama en cada cambio de un grupo: si el título es distinto del visto y no lo escribió Zzz, lo cambió otro.
export async function noteTitle (group, now = Date.now()) {
  const title = group.title ?? ''
  const stored = await chrome.storage.session.get([TITLE + group.id, WRITTEN + group.id])
  const update = { [TITLE + group.id]: title }
  const seen = stored[TITLE + group.id]
  if (seen !== undefined && title !== seen && title !== stored[WRITTEN + group.id]) update[EDITED + group.id] = now
  await chrome.storage.session.set(update)
}

// Zzz va a escribir este título: que su propio eco no cuente como edición.
export function noteWritten (groupId, title) {
  return chrome.storage.session.set({ [WRITTEN + groupId]: title, [TITLE + groupId]: title })
}

// Milisegundos que faltan para que el título lleve EDIT_QUIET_MS sin editarse (0 = ya está quieto).
export async function quietLeft (groupId, now = Date.now()) {
  const edited = (await chrome.storage.session.get(EDITED + groupId))[EDITED + groupId]
  return typeof edited === 'number' ? Math.max(0, EDIT_QUIET_MS - (now - edited)) : 0
}

export function forgetTitle (groupId) {
  return chrome.storage.session.remove([TITLE + groupId, WRITTEN + groupId, EDITED + groupId])
}
