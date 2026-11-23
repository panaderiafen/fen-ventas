Caja Fën v3.5.1 · 20 nov 2026 · ARREGLO URGENTE: la caja se quedaba cargando

Qué pasó: la conexión "por streaming" de Firestore se quedaba colgada (respondía 503); la misma consulta por "long polling"
(consulta larga) responde normal. La caja ahora usa consulta larga. Nada más cambia.

Instalación: subir index.html y caja.js al repositorio fen-ventas (reemplazar). En cada tablet, recargar: dice Caja v3.5.1.
Si algo sale mal: volver a subir la v3.5.0.
