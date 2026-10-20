// Envoltorio fino de chrome.tabs / chrome.tabGroups: listar, dormir, despertar y candado.
// Ojo: chrome.tabs.discard CAMBIA el id de la pestaña (comprobado con pruebas en Chromium 154);
// el grupo y la posición se conservan, así que siempre se vuelve a consultar.
import { UNGROUPED_KEY, groupKey, stripMarks, limitMinutes, canSleep, recentlyAudible } from './rules.js'
import { loadSettings, saveSettings } from './settings.js'
import { touchTabs, readActivity } from './activity.js'
import { refreshChips } from './chips.js'
import { setGroupKey } from './groupkeys.js'
import { markTab, unmarkTab } from './tabmarks.js'

const NONE = -1 // chrome.tabGroups.TAB_GROUP_ID_NONE: pestañas sin grupo

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Todos los grupos de todas las ventanas (la ventana enfocada primero) y, al final, «Sin grupo».
export async function listGroups () {
  const [groups, tabs, settings, focused] = await Promise.all([
    chrome.tabGroups.query({}),
    chrome.tabs.query({}),
    loadSettings(),
    chrome.windows.getLastFocused().catch(() => null)
  ])
  const isLocked = (key) => settings.rules[key]?.mode === 'never'
  const list = groups.map((g) => {
    const key = groupKey(g)
    return {
      key,
      groupId: g.id,
      windowId: g.windowId,
      title: stripMarks(g.title),
      color: g.color,
      locked: isLocked(key),
      minutes: limitMinutes(settings, key),
      autoEnabled: settings.autoEnabled,
      tabs: tabs.filter((t) => t.groupId === g.id)
    }
  })
  const here = (g) => (g.windowId === focused?.id ? 1 : 0)
  list.sort((a, b) => here(b) - here(a))
  list.push({
    key: UNGROUPED_KEY,
    groupId: NONE,
    windowId: null,
    title: 'Sin grupo',
    color: 'grey',
    locked: isLocked(UNGROUPED_KEY),
    minutes: limitMinutes(settings, UNGROUPED_KEY),
    autoEnabled: settings.autoEnabled,
    tabs: tabs.filter((t) => t.groupId === NONE)
  })
  return list
}

// Duerme las pestañas que se puedan dormir. Devuelve cuántas durmió, cuántas se saltó a propósito (la activa,
// la que suena, la ya dormida) y cuántas FALLARON (Chromium se negó o hubo un error: no se esconde).
// Las marcas 💤 de título se ponen todas a la vez, para que una página colgada solo cueste un tiempo máximo.
export async function sleepTabs (tabs) {
  const { markTabs } = await loadSettings()
  const candidates = tabs.filter(canSleep)
  if (markTabs) await Promise.all(candidates.map(markTab))
  let slept = 0
  let failed = 0
  for (const tab of candidates) {
    const result = await chrome.tabs.discard(tab.id).catch(() => undefined)
    if (result?.discarded) slept++
    else {
      failed++
      if (markTabs) await unmarkTab(tab) // no se durmió: que no se quede el 💤 en una pestaña despierta
    }
  }
  if (failed) console.warn(`Zzz: no se pudieron dormir ${failed} pestañas`)
  return { slept, skipped: tabs.length - candidates.length, failed }
}

// Duerme un grupo entero (groupId -1 = «Sin grupo»). Ignora el candado: es una orden explícita.
export async function sleepGroup (groupId) {
  const result = await sleepTabs(await chrome.tabs.query({ groupId }))
  await refreshChips()
  return result
}

// Duerme todo menos ese grupo. Respeta el candado de los demás grupos y lo que sonó hace menos de un minuto.
export async function sleepOthers (groupId) {
  const total = { slept: 0, skipped: 0, failed: 0 }
  const { audible } = await readActivity()
  const now = Date.now()
  for (const group of await listGroups()) {
    if (group.groupId === groupId) continue
    if (group.locked) { total.skipped += group.tabs.length; continue }
    const candidates = group.tabs.filter((t) => !recentlyAudible(audible[t.id], now))
    total.skipped += group.tabs.length - candidates.length
    const { slept, skipped, failed } = await sleepTabs(candidates)
    total.slept += slept
    total.skipped += skipped
    total.failed += failed
  }
  await refreshChips()
  return total
}

// Duerme todo lo de las demás ventanas (no la que se pasa). Respeta el candado y lo que sonó hace menos de un minuto;
// la pestaña activa de cada ventana no se duerme nunca (Chromium no deja).
export async function sleepOtherWindows (windowId) {
  const total = { slept: 0, skipped: 0, failed: 0 }
  const { audible } = await readActivity()
  const now = Date.now()
  for (const group of await listGroups()) {
    const outside = group.tabs.filter((t) => t.windowId !== windowId)
    if (!outside.length) continue
    if (group.locked) { total.skipped += outside.length; continue }
    const candidates = outside.filter((t) => !recentlyAudible(audible[t.id], now))
    total.skipped += outside.length - candidates.length
    const { slept, skipped, failed } = await sleepTabs(candidates)
    total.slept += slept
    total.skipped += skipped
    total.failed += failed
  }
  await refreshChips()
  return total
}

// Despierta las pestañas dormidas del grupo, con una pausa entre ellas para no disparar la RAM de golpe.
// Devuelve cuántas despertó: si una se cierra a mitad del proceso, las demás siguen.
export async function wakeGroup (groupId, gapMs = 300) {
  const asleep = (await chrome.tabs.query({ groupId })).filter((t) => t.discarded)
  let woken = 0
  for (let i = 0; i < asleep.length; i++) {
    if (i > 0) await pause(gapMs)
    try {
      await chrome.tabs.reload(asleep[i].id)
      await touchTabs([asleep[i].id]) // despertada a propósito: cuenta como uso, que el barrido no la duerma al minuto
      woken++
    } catch { /* se cerró entre medias */ }
  }
  await refreshChips()
  return woken
}

// La vecina a la que saltar cuando se duerme la pestaña activa. Por orden: despierta y de su mismo grupo (o también
// suelta, si ella lo es); despierta y visible; despierta aunque su grupo esté plegado (se desplegaría); y por último
// cualquiera. Dentro de cada nivel manda la cercanía: primero las de la derecha, luego las de la izquierda.
async function neighborOf (tab) {
  const [all, collapsed] = await Promise.all([
    chrome.tabs.query({ windowId: tab.windowId }),
    chrome.tabGroups.query({ windowId: tab.windowId, collapsed: true })
  ])
  const hidden = new Set(collapsed.map((g) => g.id))
  const tabs = all.sort((a, b) => a.index - b.index)
  const near = [...tabs.filter((t) => t.index > tab.index), ...tabs.filter((t) => t.index < tab.index).reverse()]
  const awake = (t) => !t.discarded
  const visible = (t) => !hidden.has(t.groupId)
  const sameGroup = (t) => t.groupId === tab.groupId && (tab.groupId !== NONE || Math.abs(t.index - tab.index) === 1) // las sueltas no están juntas: solo la inmediata
  return near.find((t) => awake(t) && sameGroup(t)) ??
    near.find((t) => awake(t) && visible(t)) ??
    near.find(awake) ??
    near.find(visible) ??
    near[0]
}

// Duerme UNA pestaña (suelta o de un grupo). Si es la activa, antes pasa a la vecina.
export async function sleepTab (tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab) return { slept: 0, skipped: 1, failed: 0, reason: 'missing' }
  if (tab.discarded) return { slept: 0, skipped: 1, failed: 0, reason: 'already' }
  if (tab.audible) return { slept: 0, skipped: 1, failed: 0, reason: 'audible' }
  if (tab.active) {
    const neighbor = await neighborOf(tab)
    if (!neighbor) return { slept: 0, skipped: 1, failed: 0, reason: 'only-tab' }
    await chrome.tabs.update(neighbor.id, { active: true })
  }
  const { slept, failed } = await sleepTabs([{ ...tab, active: false }]) // ya no es la activa
  await refreshChips()
  return { slept, skipped: 0, failed }
}

// Despierta UNA pestaña dormida sin activarla.
export async function wakeTab (tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab?.discarded) return false
  await chrome.tabs.reload(tabId)
  await touchTabs([tabId])
  await refreshChips()
  return true
}

async function keyOf (groupId) {
  if (groupId === NONE) return UNGROUPED_KEY
  return groupKey(await chrome.tabGroups.get(groupId))
}

// Pone o quita el candado «nunca dormir». Devuelve el estado nuevo (true = con candado).
export async function toggleLock (groupId) {
  const key = await keyOf(groupId)
  const settings = await loadSettings()
  const lock = settings.rules[key]?.mode !== 'never'
  if (lock) settings.rules[key] = { mode: 'never' }
  else delete settings.rules[key]
  await saveSettings(settings)
  if (groupId !== NONE) await setGroupKey(groupId, key) // la regla vive en esta clave: que un renombrado posterior la encuentre
  return lock
}
