// 💤 en el chip (título) del grupo: «💤 Ads» entero dormido, «Parking 💤3/5» a medias, «Parking» despierto.
// Zzz es dueño de esa marca; groupKey() la ignora, así que las reglas no se ven afectadas.
// No toca un título que alguien está editando: devuelve cuánto esperar para volver a intentarlo.
import { removeMarks, markedTitle } from './rules.js'
import { loadSettings } from './settings.js'
import { quietLeft, noteWritten } from './titles.js'

export async function refreshChips (now = Date.now()) {
  const settings = await loadSettings()
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})])
  let retryInMs = 0
  for (const group of groups) {
    const left = await quietLeft(group.id, now)
    if (left > 0) { retryInMs = Math.max(retryInMs, left + 100); continue }
    const inGroup = tabs.filter((t) => t.groupId === group.id)
    const asleep = inGroup.filter((t) => t.discarded).length
    const base = removeMarks(group.title)
    const wanted = settings.markGroups ? markedTitle(base, asleep, inGroup.length) : base
    if (wanted === (group.title ?? '')) continue // idempotente: no hay bucle de eventos
    await noteWritten(group.id, wanted)
    await chrome.tabGroups.update(group.id, { title: wanted }).catch(() => { /* el grupo se cerró entre medias */ })
  }
  return { retryInMs }
}
