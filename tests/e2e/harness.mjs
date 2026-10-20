// Banco de pruebas e2e: un Chromium APARTE (perfil temporal, sin ventana) con la
// extensión cargada y controlado por CDP. Nunca toca el Chromium de uso diario.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Cliente CDP mínimo sobre el WebSocket global de Node.
export function cdp (wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 0
  const pending = new Map()
  const listeners = []
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`CDP: no conecta con ${wsUrl}`))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message}`))
      else p.resolve(msg.result)
    } else {
      listeners.forEach((l) => l(msg))
    }
  }
  return {
    ready,
    send (method, params = {}) {
      const id = ++nextId
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    on: (listener) => listeners.push(listener),
    close: () => ws.close()
  }
}

// PIDs descendientes de `root` (renderers, GPU, zygote…) leyendo /proc.
function descendants (root) {
  const children = new Map()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const status = readFileSync(`/proc/${name}/status`, 'utf8')
      const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1])
      if (!children.has(ppid)) children.set(ppid, [])
      children.get(ppid).push(Number(name))
    } catch { /* el proceso murió mientras leíamos */ }
  }
  const out = []
  const stack = [root]
  while (stack.length) {
    const pid = stack.pop()
    out.push(pid)
    stack.push(...(children.get(pid) || []))
  }
  return out
}

// readyExpr: expresión que debe dar true dentro del service worker antes de usarlo
// (su target aparece ANTES de que el script termine de arrancar).
const SW_READY = 'typeof chrome !== "undefined" && !!chrome.tabs'

export async function launch ({ extensionDir, localState, readyExpr = SW_READY } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'zzz-e2e-'))
  if (localState) writeFileSync(join(userDataDir, 'Local State'), JSON.stringify(localState))

  const args = [
    '--headless=new',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    ...(extensionDir ? [`--load-extension=${extensionDir}`] : []),
    'about:blank'
  ]
  const proc = spawn('chromium', args, { detached: true, stdio: 'ignore' })
  let exited = false
  proc.on('exit', () => { exited = true })

  // Puerto de depuración: Chromium lo escribe en DevToolsActivePort.
  const portFile = join(userDataDir, 'DevToolsActivePort')
  let port
  for (let i = 0; i < 100 && !port; i++) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
    else await sleep(100)
  }
  if (!port) { await close(); throw new Error('Chromium de pruebas no abrió el puerto de depuración') }

  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()

  async function close () {
    sw?.close()
    if (!exited) {
      try { process.kill(-proc.pid, 'SIGTERM') } catch { /* ya muerto */ }
      for (let i = 0; i < 50 && !exited; i++) await sleep(100)
      if (!exited) { try { process.kill(-proc.pid, 'SIGKILL') } catch { /* ya muerto */ } }
    }
    // Solo borramos nuestro propio directorio temporal.
    if (userDataDir.includes('zzz-e2e-')) rmSync(userDataDir, { recursive: true, force: true })
  }

  let sw = null
  let swTargetId = null
  async function connectSW (exceptId) {
    for (let i = 0; i < 100; i++) {
      const t = (await targets()).find((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://') && x.id !== exceptId)
      if (t) {
        swTargetId = t.id
        sw = cdp(t.webSocketDebuggerUrl)
        await sw.ready
        await sw.send('Runtime.enable')
        for (let k = 0; k < 100; k++) {
          try {
            const r = await sw.send('Runtime.evaluate', { expression: readyExpr, returnByValue: true })
            if (r.result?.value === true) return t.url
          } catch { /* el contexto aún no existe: reintentar */ }
          await sleep(100)
        }
        throw new Error(`El service worker no llegó a estar listo (${readyExpr})`)
      }
      await sleep(100)
    }
    throw new Error('No aparece el service worker de la extensión (¿se cargó --load-extension?)')
  }

  let swUrl = null
  if (extensionDir) {
    try { swUrl = await connectSW() } catch (e) { await close(); throw e }
  }

  // Ejecuta código dentro del service worker y devuelve el resultado como JSON.
  async function evalSW (code) {
    const r = await sw.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    }
    return r.result.value
  }

  // Suelta el service worker (sin depurador conectado, Chromium lo apaga a los ~30 s de inactividad).
  function detachSW () { sw?.close(); sw = null }
  const swAlive = async () => (await targets()).some((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))
  const reattachSW = () => connectSW(null)

  // Abre una pestaña (en segundo plano por defecto) y espera a que cargue.
  async function newTab (url, { active = false } = {}) {
    return evalSW(`(async () => {
      const t = await chrome.tabs.create({ url: ${JSON.stringify(url)}, active: ${active} })
      for (let i = 0; i < 100; i++) {
        const cur = await chrome.tabs.get(t.id)
        if (cur.status === 'complete') break
        await new Promise((r) => setTimeout(r, 100))
      }
      return t.id
    })()`)
  }

  // Memoria de los procesos renderer de ESTE Chromium: RSS + swap, en MB.
  function rendererRssMB () {
    let kb = 0
    for (const pid of descendants(proc.pid)) {
      try {
        if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type=renderer')) continue
        const status = readFileSync(`/proc/${pid}/status`, 'utf8')
        kb += Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0)
        kb += Number(/^VmSwap:\s+(\d+)/m.exec(status)?.[1] || 0)
      } catch { /* proceso desaparecido */ }
    }
    return Math.round(kb / 1024)
  }

  const { Browser: browser } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()

  return { evalSW, newTab, detachSW, swAlive, reattachSW, rendererRssMB, close, port, swUrl, userDataDir, browser, targets }
}

// Atajo para los scripts de fase: lanza, ejecuta y limpia siempre.
export async function withBrowser (opts, fn) {
  const b = await launch(opts)
  try { return await fn(b) } finally { await b.close() }
}
