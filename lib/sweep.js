// Barrido del automático: duerme las pestañas que llevan más del tiempo de su regla sin usarse.
// «Sin usar» = desde la marca más reciente entre lastAccessed, la última vez que la dejaste o
// despertaste (touched) y la última vez que sonó (audible); ver lib/activity.js.
import { shouldAutoSleep } from './rules.js'
import { loadSettings } from './settings.js'
import { listGroups, sleepTabs } from './groups.js'
import { recordUse, readActivity, forgetTabsExcept } from './activity.js'
import { refreshChips } from './chips.js'

// force: «Barrer ahora» del popup: aplica las reglas de tiempo YA aunque el interruptor Auto esté apagado (es una orden
// explícita); sigue respetando los tiempos por grupo, los candados, la pestaña activa y lo que suena.
export async function sweep (now = Date.now(), { force = false } = {}) {
  const loaded = await loadSettings()
  if (!loaded.autoEnabled && !force) return { slept: 0, failed: 0 }
  const settings = force ? { ...loaded, autoEnabled: true } : loaded
  const groups = await listGroups()
  const tabs = groups.flatMap((g) => g.tabs)
  await recordUse(tabs, now) // lo que está activo o sonando ahora mismo, está en uso ahora mismo
  const { touched, audible } = await readActivity()
  let slept = 0
  let failed = 0
  for (const group of groups) {
    const idle = group.tabs.filter((tab) => shouldAutoSleep(tab, {
      now, settings, key: group.key, touchedAt: touched[tab.id], audibleAt: audible[tab.id]
    }))
    const result = await sleepTabs(idle)
    slept += result.slept
    failed += result.failed
  }
  await forgetTabsExcept(tabs.map((t) => t.id))
  if (slept > 0) await refreshChips()
  // Si Chromium se niega a dormir, el popup lo avisa (ver popup.js); un barrido bueno lo borra.
  if (failed > 0) await chrome.storage.session.set({ sweepfail: { count: failed, at: now } })
  else if (slept > 0) await chrome.storage.session.remove('sweepfail')
  return { slept, failed }
}
