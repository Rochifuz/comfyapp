// Convierte un archivo de imagen elegido por el usuario en un avatar
// chico y liviano (recortado a cuadrado y comprimido) — pensado para
// fotos de perfil, no para fotos grandes. El resultado es un data URI
// (texto, empieza con "data:image/jpeg;base64,...") que se guarda tal
// cual como un campo más del perfil en Firestore — no hace falta ningún
// servicio de archivos aparte (ver el comentario en cuenta.html sobre
// por qué se eligió así).
//
// El tamaño de salida queda acotado por el ancho/alto del canvas (128px)
// sin importar lo grande que sea la foto original — una selfie de 20MB
// termina pesando lo mismo que una de 200KB, así que no hace falta
// validar el tamaño del archivo de entrada.
export function redimensionarImagenComoDataURI(archivo, lado = 128, calidad = 0.72) {
    return new Promise((resolve, reject) => {
        if (!archivo || !archivo.type || !archivo.type.startsWith('image/')) {
            reject(new Error('Elegí un archivo de imagen (JPG, PNG, etc.).'));
            return;
        }

        const lector = new FileReader();
        lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('No se pudo abrir esa imagen.'));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = lado;
                canvas.height = lado;
                const contexto = canvas.getContext('2d');

                // Recorte "cover": el cuadrado más grande posible,
                // centrado, ANTES de achicar — así la foto no queda
                // estirada ni deformada, solo recortada a los costados
                // (o arriba/abajo) como cualquier avatar redondo.
                const ladoOriginal = Math.min(img.width, img.height);
                const origenX = (img.width - ladoOriginal) / 2;
                const origenY = (img.height - ladoOriginal) / 2;
                contexto.drawImage(img, origenX, origenY, ladoOriginal, ladoOriginal, 0, 0, lado, lado);

                resolve(canvas.toDataURL('image/jpeg', calidad));
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
}
