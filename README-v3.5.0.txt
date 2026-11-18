Caja Fën v3.5.0 · 18 nov 2026 · con CierreCaja.gs v1.1.0

Qué cambia: el correo del cierre de caja trae el stock (pedido de Emmanuel el 18 nov)
- Nueva sección "Stock que queda" (después de "Productos vendidos"): cada producto con stock en esa sucursal, cuántos
  quedan y su antigüedad. Ej.: "Pan amasado · 12 · 8 de hoy, 4 de ayer". Ordenado por área (Panadería, Bollería,
  Pastelería, Reventa, Otros).
- Debajo, una sola línea: "Sin stock (N): nombre, nombre, …" con los productos que están en 0.
- No incluye Cafetería, ni productos que no llevan control de stock, ni los que nunca se han cargado en esa sucursal
  (así no aparecen los que solo se venden en la otra). La merma no cuenta como stock.
- Si al cerrar no se alcanza a leer el stock, el correo sale igual, sin esa sección.

Instalación (en este orden)
1. Apps Script de caja/merma/anulaciones (el proyecto cuya URL termina en ...fddv1A/exec):
   a. script.google.com → abra ese proyecto → archivo CierreCaja.
   b. Borre todo su contenido y pegue el de apps-script/CierreCaja.gs (v1.1.0) → Guardar.
      (Code.gs no se toca: la línea de cierre_caja ya está desde la v3.4.0.)
   c. Prueba: elija testNotificarCierreCaja → Ejecutar. Llega el correo de ejemplo con "Stock que queda"
      (Pan de ejemplo, Queque de ejemplo) y "Sin stock (2)".
   d. Implementar → Gestionar implementaciones → lápiz → Versión: "Nueva versión" → Implementar. (La URL no cambia.)
2. Caja: suba index.html y caja.js al repositorio fen-ventas (reemplazar) como siempre.
3. En las tablets de la caja, recargue: debe decir Caja v3.5.0.

Si se instala la caja antes del paso 1, el correo llega como antes (sin el stock).

Revisión rápida
[ ] Paso 1c: el correo de ejemplo trae "Stock que queda" y "Sin stock".
[ ] Al primer cierre real, el correo trae el stock de esa sucursal.

Si algo sale mal: vuelva a subir la caja v3.4.0 (el cierre no depende del correo).

Pruebas: caja-v350 (stock con cantidad y antigüedad; sin stock sin Cafetería, sin "solo en la otra sucursal" ni
productos sin control de stock); caja-v340 sigue pasando.
