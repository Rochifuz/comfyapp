// Lista de categorías de gasto, compartida entre Gastos personales, los
// gastos de grupo y (más adelante) la sección de Estadísticas — un único
// lugar para no terminar con nombres de categoría distintos en cada lado.

export const CATEGORIAS = [
    { valor: 'comida', texto: 'Comida', icono: '🍔' },
    { valor: 'transporte', texto: 'Transporte', icono: '🚗' },
    { valor: 'servicios', texto: 'Servicios', icono: '💡' },
    { valor: 'entretenimiento', texto: 'Entretenimiento', icono: '🎬' },
    { valor: 'gaming', texto: 'Gaming', icono: '🎮' },
    { valor: 'salud', texto: 'Salud', icono: '🩺' },
    { valor: 'hogar', texto: 'Hogar', icono: '🏠' },
    { valor: 'alquiler', texto: 'Alquiler', icono: '🔑' },
    { valor: 'otros', texto: 'Otros', icono: '📦' },
];

export function opcionesDeCategorias() {
    return CATEGORIAS.map(c => `<option value="${c.valor}">${c.icono} ${c.texto}</option>`).join('');
}

export function etiquetaDeCategoria(valor) {
    const categoria = CATEGORIAS.find(c => c.valor === valor);
    return categoria ? `${categoria.icono} ${categoria.texto}` : '📦 Otros';
}
