// Lógica pura de Zzz: sin APIs de Chrome, para poder probarla con node:test.

export const UNGROUPED_KEY = '__sin_grupo__'

export const DEFAULT_SETTINGS = Object.freeze({
  autoEnabled: true,
  markGroups: true,
  markTabs: false,
  defaultMinutes: 15,
  rules: Object.freeze({})
})

const MIN_MS = 60000

// Una pestaña que sonó hace menos de esto sigue protegida: `tab.audible` solo dura 2 s.
export const AUDIBLE_GRACE_MS = 60000

const validMinutes = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0

// La interfaz exige 1 minuto o más (la API acepta cualquier valor > 0: las pruebas usan fracciones).
export const validUiMinutes = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 1

// 💤 en el título de una pestaña dormida («💤 Gmail»). Lo pone Zzz justo antes de dormirla; al despertar
// la página vuelve a poner su título.
export function markTabTitle (title) {
  const base = String(title ?? '')
  if (base.startsWith('💤')) return base
  return base ? `💤 ${base}` : '💤'
}

export function unmarkTabTitle (title) {
  return String(title ?? '').replace(/^💤(?: |$)/u, '')
}

// Cuánto tiene que estar quieto el título de un grupo (nadie lo está editando) para que Zzz lo toque.
export const EDIT_QUIET_MS = 5000

// Marcas que Zzz añade al título del grupo: «💤 Ads» (entero dormido) o «Parking 💤3/5» (a medias).
// removeMarks quita SOLO las marcas y respeta el resto del título tal cual (sin recortar espacios);
// cubre también marcas que el usuario dejó en medio o pegadas a su texto al editar.
export function removeMarks (title) {
  return String(title ?? '')
    .replace(/^💤(?: |$)/u, '')
    .replace(/ ?💤\d+\/\d+(?= |$)/gu, '')
    .replace(/💤\d+\/\d+/gu, '')
}

// Para mostrar: sin marcas y recortado.
export function stripMarks (title) {
  return removeMarks(title).trim()
}

export function markedTitle (base, asleep, total) {
  if (total === 0 || asleep === 0) return base
  if (asleep === total) return base ? `💤 ${base}` : '💤'
  return base ? `${base} 💤${asleep}/${total}` : `💤${asleep}/${total}`
}

// Clave estable de un grupo: los ids de grupo cambian al reiniciar, el título no.
// Ignora las marcas 💤 de Zzz (dormir un grupo no cambia su regla) pero NO recorta el título del usuario.
export function groupKey ({ title, color }) {
  const base = removeMarks(title)
  return base.trim() ? `t:${base}` : `c:${color}`
}

function normalizeRule (raw) {
  if (!raw || typeof raw !== 'object') return { mode: 'default' }
  if (raw.mode === 'never') return { mode: 'never' }
  if (raw.mode === 'minutes' && validMinutes(raw.minutes)) return { mode: 'minutes', minutes: raw.minutes }
  return { mode: 'default' }
}

// Acepta cualquier cosa que venga de storage y devuelve ajustes válidos.
export function normalizeSettings (raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rules = {}
  if (src.rules && typeof src.rules === 'object' && !Array.isArray(src.rules)) {
    for (const [key, raw] of Object.entries(src.rules)) {
      const rule = normalizeRule(raw)
      if (rule.mode !== 'default') rules[key] = rule // «default» equivale a no tener regla: no se guarda
    }
  }
  return {
    autoEnabled: typeof src.autoEnabled === 'boolean' ? src.autoEnabled : DEFAULT_SETTINGS.autoEnabled,
    markGroups: typeof src.markGroups === 'boolean' ? src.markGroups : DEFAULT_SETTINGS.markGroups,
    markTabs: typeof src.markTabs === 'boolean' ? src.markTabs : DEFAULT_SETTINGS.markTabs,
    defaultMinutes: validMinutes(src.defaultMinutes) ? src.defaultMinutes : DEFAULT_SETTINGS.defaultMinutes,
    rules
  }
}

// Minutos sin usar antes de que el automático duerma ese grupo (Infinity = 🔒).
export function limitMinutes (settings, key) {
  const rule = settings.rules[key]
  if (rule?.mode === 'never') return Infinity
  if (rule?.mode === 'minutes') return rule.minutes
  return settings.defaultMinutes
}

// Lo único intocable siempre: la activa, la que suena y la que ya duerme.
export function canSleep (tab) {
  return !tab.active && !tab.audible && !tab.discarded
}

// Último momento en que la pestaña estuvo EN USO: la marca más reciente que se conozca.
// ojo: tab.lastAccessed es «cuándo se hizo activa», no «cuándo se dejó»; por eso se
// completa con touchedAt (la dejaste/despertaste a propósito) y audibleAt (sonó).
export function lastUseOf (tab, { touchedAt, audibleAt, firstSeen } = {}) {
  const marks = [tab.lastAccessed, touchedAt, audibleAt, firstSeen].filter((v) => typeof v === 'number')
  return marks.length ? Math.max(...marks) : undefined
}

export function recentlyAudible (audibleAt, now, graceMs = AUDIBLE_GRACE_MS) {
  return typeof audibleAt === 'number' && now - audibleAt < graceMs
}

export function shouldAutoSleep (tab, { now, settings, key, firstSeen, touchedAt, audibleAt }) {
  if (!settings.autoEnabled || !canSleep(tab)) return false
  const since = lastUseOf(tab, { touchedAt, audibleAt, firstSeen })
  if (since === undefined) return false
  return now - since >= limitMinutes(settings, key) * MIN_MS
}
