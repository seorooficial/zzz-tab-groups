# Zzz — dormir pestañas de Chromium, por grupo o una a una

🇬🇧 [README in English](README.md)

El *Ahorro de memoria* de Chromium decide por su cuenta qué pestañas descarga y no te deja opinar. **Zzz te da el control:**
duerme un grupo entero, una sola pestaña, todo lo demás o las otras ventanas, a mano o de forma automática, con un tiempo (o un
🔒 «nunca») por grupo. Una pestaña dormida libera la memoria de su proceso y se recarga cuando la pulsas.

> **Estado:** proyecto personal, hecho y probado en **Chromium 154 sobre Linux (Arch)**. Necesita Chrome/Chromium
> **150 o superior** (usa la API de menú de pestañas añadida en la 150). **No** está en la Chrome Web Store: se carga sin
> empaquetar. La interfaz y los comentarios del código están en español.

## Qué hace

- **Popup (el botón Z):** todos los grupos de todas las ventanas y una fila «Sin grupo». Cada fila dice cuántas pestañas duermen y
  qué hará el automático (`auto 15 min`, `🔒 nunca`, `auto apagado`). Se despliega (▾) para ver sus pestañas, con 💤 en las dormidas y
  un botón para dormir o despertar **solo esa**.
- **Clic derecho** en una pestaña de la barra o en cualquier parte de la página (también enlaces, selección, imágenes…):
  dormir solo esta pestaña · dormir este grupo · dormir todos los demás · alternar 🔒 «nunca dormir» · despertar este grupo.
- **Atajos:** `Alt+Shift+D` duerme el grupo de la pestaña actual y `Alt+Shift+S` duerme solo la pestaña actual y te pasa a una vecina
  despierta (se cambian en `chrome://extensions/shortcuts`).
- **Automático:** cada minuto, una pestaña sin usar más del tiempo de su grupo se duerme (15 min por defecto; cada grupo, y las
  sueltas, pueden tener el suyo o 🔒). «Sin usar» cuenta desde que **dejaste** la pestaña; que suene o despertarla a propósito cuenta
  como uso. «🧹 Barrer ahora» aplica las reglas ya, aunque el automático esté apagado.
- **Chip del grupo:** el título muestra `💤 Ads` si todo el grupo duerme, `Parking 💤3/5` a medias, y vuelve a `Parking` al
  despertar. Espera a que termines de teclear un nombre antes de tocarlo. Se puede apagar.
- **Opcional — 💤 en el título de cada pestaña dormida** (`💤 Gmail`). Chromium no deja pintar nada en una pestaña, así que se cambia
  el título de la página justo antes de dormirla. Requiere un permiso opcional sobre las webs; mira *Seguridad*.
- **Otras ventanas:** botón «💤 Dormir las demás ventanas» (solo con más de una ventana).

## Instalar

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
3. **Cargar descomprimida** y elige la carpeta del repositorio.
4. (Opcional) fija el icono **Z** en la barra de herramientas.

## Qué nunca se duerme

- La pestaña activa de cada ventana y la que está sonando. («Dormir todos los demás» respeta además lo que sonó hace menos de 1 min.)
- Un grupo con 🔒 frente al automático, «dormir todos los demás» y «dormir las demás ventanas». La orden explícita «dormir este
  grupo» sí lo duerme.
- Las pestañas **fijadas** y las que tienen un **formulario a medias** SÍ se duermen, y lo escrito puede perderse. Pon candado a los
  grupos donde editas cosas (un panel de anuncios, un borrador de correo…).

## Seguridad — léelo

- **Por defecto Zzz no tiene acceso a ninguna web.** El acceso a http/https es un permiso **opcional** que solo se pide cuando
  activas «Poner 💤 en el título de cada pestaña dormida» en las reglas. Se retira al apagarlo (o si lo quitas desde
  `chrome://extensions`, y entonces el interruptor se apaga solo).
- **Sin ese permiso** las páginas de la propia extensión no pueden enviar datos fuera: el CSP del manifest bloquea fetch/XHR/WebSocket
  (`connect-src 'none'`) e imágenes, formularios e iframes externos.
- **Con ese permiso**, Chromium lo describe como «leer y cambiar todos tus datos» en esos sitios (no existe uno más pequeño para cambiar
  solo el título). Zzz solo inyecta dos funciones muy cortas que tocan `document.title` y no leen nada de la página
  (`lib/tabmarks.js`), pero el bloqueo de red del manifest **no cubre el código que corre dentro de las páginas**: esa garantía pasa a
  depender de que leas el código, que es corto. Si no quieres ese riesgo, deja el interruptor apagado: lo demás funciona igual.
- Permisos obligatorios: `tabGroups`, `contextMenus`, `storage`, `alarms`, `tabs` (para mostrar los títulos en la lista), `scripting`.

## Límites conocidos

- No hay menú en el propio chip del grupo: Chromium no ofrece ese contexto a las extensiones (haz clic derecho en cualquier pestaña del grupo).
- No muestra MB por grupo (esa API no está en Chrome estable).
- Chromium siempre deja una pestaña despierta por ventana (no descarta la activa).
- Las pestañas que descarta el propio Chromium (su Ahorro de memoria) no llevan 💤 en el título; solo se ven atenuadas.
- Zzz modifica los títulos de los grupos (`💤 …`). **Apaga las marcas del chip en las reglas antes de desinstalar**, o se quedan en los nombres.
- Probada en una sola máquina (Chromium 154, Linux). La convivencia a largo plazo con el Ahorro de memoria nativo no está verificada.

## Desarrollo y pruebas

Sin dependencias ni compilación. Node 22 o superior (desarrollada con Node 26) y un binario `chromium` en el `PATH`.

```
npm test          # lógica pura y manifest (node:test)
npm run test:e2e  # pruebas de extremo a extremo, ~20 min (algunas esperan alarmas reales)
```

Las pruebas e2e lanzan un **Chromium aparte, sin ventana y con perfil temporal**, y lo controlan por el protocolo de DevTools; nunca
tocan tu navegador. `ONLY=texto` ejecuta solo las pruebas cuyo nombre lo contenga y `DEBUG=1` imprime la traza completa. Las notas de
diseño y los comportamientos de Chromium descubiertos al construirla están en [`docs/DESIGN.md`](docs/DESIGN.md).

## Licencia

[MIT](LICENSE)
