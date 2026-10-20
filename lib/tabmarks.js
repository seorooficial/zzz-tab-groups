// 💤 en el título de la pestaña dormida. Chromium no deja a una extensión pintar nada en la pestaña,
// así que se cambia su título justo antes de dormirla (una pestaña dormida conserva el último título).
// Necesita acceso a las webs: es un permiso OPCIONAL que solo se pide al activar el interruptor en Opciones.
// Si no está concedido, la página es interna (chrome://) o aún está cargando, simplemente no se marca.

export const WEB_ORIGINS = ['http://*/*', 'https://*/*']

// Una página colgada no responde a la inyección: sin límite de tiempo bloquearía el dormir de todas las demás.
const MARK_TIMEOUT_MS = 1000

// Se inyectan en la página tal cual: no pueden usar nada de fuera (solo `document` y `location`).
export function addPrefix () {
  if (document.title.startsWith('💤')) return
  document.title = document.title ? `💤 ${document.title}` : `💤 ${location.hostname}`
}

export function removePrefix () {
  if (!document.title.startsWith('💤')) return
  // Una página sin título quedó como «💤 sitio»: al deshacer vuelve a no tener título.
  document.title = document.title === `💤 ${location.hostname}` ? '' : document.title.replace(/^💤 ?/u, '')
}

async function allowed (tab) {
  if (!/^https?:\/\//.test(tab.url ?? '')) return false
  return chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] })
}

// Resuelve a 'timeout' si la inyección no responde a tiempo.
function inject (tab, func) {
  let timer
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), MARK_TIMEOUT_MS) })
  const run = chrome.scripting.executeScript({ target: { tabId: tab.id }, func })
  return Promise.race([run, limit]).finally(() => clearTimeout(timer))
}

// Devuelve true si la marca se puso.
export async function markTab (tab) {
  try {
    if (tab.status !== 'complete' || !(await allowed(tab))) return false // cargando: el historial copiaría el título
    return (await inject(tab, addPrefix)) !== 'timeout'
  } catch {
    return false // página que no admite scripts, pestaña cerrada…
  }
}

export async function unmarkTab (tab) {
  try {
    await inject(tab, removePrefix)
  } catch { /* nada que deshacer */ }
}
