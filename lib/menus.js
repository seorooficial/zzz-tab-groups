// Entradas del clic derecho. Salen sobre la barra de pestañas y sobre cualquier parte de la página
// (también enlaces, texto seleccionado, campos, imágenes y vídeo, donde «page» a secas no sale).
export const MENU_CONTEXTS = ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'tab']

export const MENUS = [
  { id: 'sleep-tab', title: '💤 Dormir solo esta pestaña' },
  { id: 'sleep-group', title: '💤 Dormir este grupo' },
  { id: 'sleep-others', title: '💤 Dormir todos los demás grupos' },
  { id: 'toggle-lock', title: '🔒 Alternar «nunca dormir» en este grupo' },
  { id: 'wake-group', title: '☀️ Despertar este grupo' }
]
