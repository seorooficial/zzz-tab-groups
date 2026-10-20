// Ajustes de Zzz en chrome.storage.local (nunca se sincronizan ni salen del equipo).
import { normalizeSettings } from './rules.js'

const KEY = 'settings'

export async function loadSettings () {
  const stored = await chrome.storage.local.get(KEY)
  return normalizeSettings(stored[KEY])
}

export async function saveSettings (settings) {
  await chrome.storage.local.set({ [KEY]: normalizeSettings(settings) })
}
