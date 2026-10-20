// Servidor de páginas de prueba para los tests e2e.
import { createServer } from 'node:http'

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}</body>`

const routes = {
  // Reserva y toca `mb` MB para que el renderer ocupe memoria de verdad.
  '/mem': (q) => page(q.get('t') || 'mem', `<script>
    const mb = ${Number(q.get('mb')) || 60}
    window.__ballast = new Uint8Array(mb * 1024 * 1024).fill(1)
  </script>`),
  // Oscilador de WebAudio sonando (necesita --autoplay-policy=no-user-gesture-required).
  '/audio': (q) => page(q.get('t') || 'audio', `<script>
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 220
    osc.connect(ctx.destination)
    osc.start()
    ctx.resume()
  </script>`),
  // Sin <title>: document.title es ''.
  '/notitle': () => '<!doctype html><meta charset="utf-8"><body><p>sin título</p></body>',
  '/plain': (q) => page(q.get('t') || 'plain', '<p>hola</p>')
}

export async function serve () {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    // Página que tarda en terminar de cargar: ya tiene título pero su estado sigue en «cargando» unos segundos.
    if (u.pathname === '/slow') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' })
      res.write(`<!doctype html><meta charset="utf-8"><title>${u.searchParams.get('t') || 'slow'}</title><body>cargando…`)
      setTimeout(() => res.end('</body>'), 3500)
      return
    }
    const route = routes[u.pathname]
    if (!route) { res.writeHead(404).end('no'); return }
    // CORS abierto a propósito: así, si una petición desde la extensión falla, es por su manifest y no por CORS.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' }).end(route(u.searchParams))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: (name, params = {}) => `http://127.0.0.1:${port}/${name}?${new URLSearchParams(params)}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}
