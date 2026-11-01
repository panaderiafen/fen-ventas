# fën caja · v3.1.1

**Corrección del cobro con el Point integrado** (incidente del 31 oct en Barros Arana: un débito de $5.500 pagado en el Point a las 19:07 que la caja no registró). Va junto con el **servidor de cobros fen-point 0.4.2** (lista de cobros recientes). Sistema Fën y reglas de Firestore: sin cambios. · 31 de octubre de 2026

## Qué pasaba
La caja envió el cobro, el servidor lo creó y la clienta pagó, pero la respuesta no llegó a la caja (corte breve de conexión).
La caja mostró "No se pudo cobrar en el Point" y **se olvidó de ese cobro**. Al tocar "Intentar de nuevo" creó un segundo cobro, que terminó cancelado. El primero quedó pagado y sin venta.

## Qué cambia
1. **El cobro se recuerda desde antes de enviarlo.** Si la respuesta no llega, "Intentar de nuevo" primero pregunta si ese cobro ya se pagó. Si se pagó, registra la venta con ese pago, sin un segundo cobro.
2. **La caja vigila 5 minutos todo cobro que quedó sin cerrar** (sin respuesta, vencido, cancelado o abandonado con "Cobrar sin integración"). Antes eran 2 minutos y solo en algunos casos.
   - Si aparece pagado y su venta sigue en pantalla: la registra sola y avisa "no cobre de nuevo".
   - Si la venta ya no está (se cobró a mano o se pasó a otra): aparece **"Pago recibido en el Point sin venta registrada"**, con el monto, la hora y qué hacer (no cobrar de nuevo; registrarla con Débito; si se cobró dos veces, avisar a administración para devolver uno).
3. **Textos más claros:**
   - Al no poder cancelar: "Si el cliente ya pasó la tarjeta, no cancele nada: espere, esta pantalla avanza sola".
   - En "No se pudo cobrar": "Si el cliente ya pagó en el Point, no cobre de nuevo: toque Intentar de nuevo".

**Límite:** si se recarga la página o se cierra la caja durante esos 5 minutos, la vigilancia se pierde. El control de respaldo es la lista "Cobros recientes" de Sistema Fën (un "Pagado" sin su venta).

## Dónde va (repo fen-ventas, raíz, los SEIS juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png`, `resumen-caja.js` y `efectivo-caja.js`. Este README a `Respaldo/`. Súbalo en un momento sin ventas. Cambian solo `index.html` y `caja.js`; los otros van para que todo quede en la misma versión.

## Checklist
- [ ] Al lado del correo dice "· v3.1.1".
- [ ] Una venta con tarjeta normal: se envía al Point, se paga y se registra sola, como siempre.
- [ ] (Opcional, con un monto chico) Enviar un cobro y tocar "Cobrar sin integración" sin pagar todavía. Pagarlo luego en el Point antes de que venza. En menos de 10 segundos la venta se registra sola, con el aviso "El cobro anterior sí se pagó: no cobre de nuevo". Después anule esa venta de prueba y devuelva el pago desde Mercado Pago.

## Pruebas (datos ficticios)
- `pruebas/caja30/caja-v311.test.js` (4, navegador con Firebase y servidor de cobros simulados):
  - corte de conexión e "Intentar de nuevo": registra con el cobro pagado, sin un segundo cobro;
  - corte sin tocar nada: la caja lo descubre sola;
  - venta registrada a mano y el cobro pagado después: aviso de pago sin venta, sin una segunda venta (390 px);
  - cobro normal: igual que antes.
- Con la v3.1.0, las tres primeras fallan (reproducen el incidente). Las pruebas de la v3.1.0 siguen pasando.

---

# fën caja · v3.1.0

**Ajustes pedidos por Emmanuel el 31 oct**, con la caja y la venta tranquilas. Va junto con **Sistema Fën v0.121.0**. Reglas de Firestore: sin cambios (fen-ventas v1.8.0). · 31 de octubre de 2026

## Qué cambia
1. **La caja se entera sola de las anulaciones.** Cuando la administración aprueba o rechaza en Sistema Fën una anulación pedida desde esta caja, aparece un aviso ("Anulación aprobada: venta de $X") y se actualizan las ventas del turno, sin recargar la página.
2. **El arqueo se mantiene al día solo** (también después de una anulación aprobada). "Actualizar arqueo" queda de respaldo. Cuesta una lectura por cada cambio de la caja.
3. **Siempre parte en Tarjeta.** Al abrir la caja y después de cada venta (también al cobrar una mesa) queda seleccionada Tarjeta, aunque la venta anterior haya sido en efectivo o transferencia.
4. **El medio de pago elegido se nota más:** borde grueso, fondo más fuerte y negrita.
5. **Texto para el sobre:** al confirmar un cierre con retiro, aparece el texto para el sobre (sucursal, fecha, monto y quién cerró) con **Copiar**, **Imprimir** (en la impresora de comandas, como la comanda) y **Listo**.

## Dónde va (repo fen-ventas, raíz, los SEIS juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png`, `resumen-caja.js` y `efectivo-caja.js`. Este README a `Respaldo/`. Súbalo con la caja cerrada o en un momento sin ventas.

## Checklist
- [ ] Al lado del correo dice "· v3.1.0".
- [ ] Al abrir la caja, Tarjeta está seleccionada y se ve marcada.
- [ ] Una venta en efectivo: después de registrarla, vuelve a Tarjeta.
- [ ] Pedir una anulación y aprobarla en Sistema Fën: en la caja aparece el aviso y la venta queda anulada sin recargar; el arqueo baja solo.
- [ ] Al cerrar con retiro, aparece el texto para el sobre; probar Imprimir.

## Pruebas (datos ficticios)
- `pruebas/caja30/caja-v310.test.js` (3, navegador con Firebase en memoria): Tarjeta por defecto y marcada; arqueo que cambia solo y aviso de anulación aprobada; texto para el sobre al cerrar (390 px, sin ventanas del navegador).
- Las pruebas de la v3.0.0 (retiro, ingreso, anular, cierre en tres pasos, falla sin nada a medias) siguen pasando.

---

# fën caja · v3.0.0

**Etapa 4 de la revisión de la caja B2C: efectivo del turno** (bocetos "Efectivo de la caja" aprobados por Emmanuel el 30 oct; mapa v15). Va junto con **Sistema Fën v0.119.0** y las **reglas fen-ventas v1.7.0**. · 31 de octubre de 2026

## Qué cambia
1. **Retiro de efectivo** con la caja abierta: pago a proveedor (proveedor y N° de boleta o factura), a la caja de administración u otro. Muestra cómo cambia lo que debería haber.
2. **Ingreso de efectivo** que no es venta: sencillo de la caja de administración, aporte del dueño u otro.
3. **El arqueo** ahora dice: fondo inicial, ventas en efectivo, ingresos, retiros y **efectivo que debería haber**. Al lado, los **movimientos del turno** con quién y a qué hora. Un movimiento equivocado se **anula** con su motivo (nada se borra).
4. **Cierre en tres pasos:**
   - **1 · Lo contado**, sin ver el sistema (como siempre; lo del Point integrado no se cuenta).
   - **2 · Cómo quedó:** debería haber, contado y si cuadra, falta o sobra. Si no cuadra, se elige qué cree que pasó (vuelto mal dado, retiro sin anotar, venta sin registrar, no sé u otro) y una nota (obligatoria solo en "Otro"). Si vuelve a contar, queda anotado cuántas veces.
   - **3 · Qué queda y qué se retira:** el fondo para el turno siguiente (sugerido $25.000) y el **retiro a la caja de administración = contado − fondo**, que se anota solo.
   - Se acabó la ventana del navegador "¿Confirmas el cierre?": el paso 2 es la confirmación.
5. **De una sola vez:** cada retiro o ingreso con los contadores de la caja; el cierre con su evaluación y el retiro. Si se corta internet, no queda nada a medias.
6. El retiro del cierre, los retiros "a la caja de administración" y el sencillo **llegan a Sistema Fën → Efectivo → Por recibir de las cajas**: ya no hay que anotarlos a mano.

## Dónde va (repo fen-ventas, raíz, los SEIS juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png`, `resumen-caja.js` y **`efectivo-caja.js` (nuevo)**. Este README a `Respaldo/`.
Ojo: es el repo **fen-ventas** (la caja), no sistema-fen. Si falta `efectivo-caja.js`, la caja no abre.

## Orden de la subida (importante)
1. **Primero las reglas fen-ventas v1.7.0** (vienen con Sistema Fën v0.119.0). Sin ellas, la caja no puede guardar retiros ni cerrar.
2. Sistema Fën v0.119.0, a su repo.
3. Esta caja, a fen-ventas.
Hágalo **con la caja cerrada** o antes de abrir el turno.

## Checklist
- [ ] Reglas fen-ventas v1.7.0 publicadas.
- [ ] Los seis archivos en la raíz de **fen-ventas**; recargar la caja. Al lado del correo dice "· v3.0.0".
- [ ] Abrir caja: sugiere el saldo del turno anterior.
- [ ] Caja → "Retiro de efectivo" de prueba ($1.000, Otro, "prueba") y anularlo: el arqueo vuelve a como estaba.
- [ ] Al cierre: contar, ver "Cómo quedó", dejar el fondo y confirmar.
- [ ] Sistema Fën → Efectivo: aparece el retiro en "Por recibir de las cajas"; presionar **Recibir** cuando la plata esté en la caja de administración.

## Pruebas (datos ficticios)
- `pruebas/caja30/modelo.test.mjs` (9): debería haber, cierre con los números del boceto (falta $1.500, retiro $76.400), fondo, motivos y lo que llega a Sistema Fën.
- `pruebas/caja30/caja-v300.test.js` (5, navegador con Firebase en memoria): retiro, ingreso, anular y cierre en tres pasos; cierre que cuadra y volver a contar; falla de conexión sin nada a medias; Sistema Fën recibe el retiro y confirma el sencillo; versiones y sin ventanas del navegador. Sin desborde a 390 y 768 px; capturas a 390 y 1440 px.
- Las reglas v1.7.0 se revisaron a mano (el emulador de Firebase no se pudo descargar en esta sesión).

---

# fën caja · v2.9.0

**Cierre de la Etapa 3 de la revisión de la caja B2C** (pedido por Emmanuel el 29 oct, para pilotear el Point el 30 oct en la mañana). Va junto con **Sistema Fën v0.117.0**. Para la vendedora solo cambia que ya no hay emojis. · 30 de octubre de 2026

## Qué cambia
1. **El resumen del cierre se arma con `resumen-caja.js`**, el mismo archivo (idéntico) que usa Sistema Fën v0.117.0. Antes estaba escrito dos veces y había que cambiarlo en los dos lados. El resumen que se guarda es el mismo de la v2.8.0 (lo revisan las pruebas).
2. **De una sola vez** (lote de escrituras, como las ventas desde la v2.6.0):
   - **Cambiar el medio de pago** de una venta: la venta y los totales de la caja juntos. Si se corta internet, no queda la venta con un medio y la caja con otro.
   - **Pedir una anulación:** la solicitud y la marca "pendiente" de la venta juntas.
   - Las anulaciones se **aprueban** en Sistema Fën v0.117.0, que ahora devuelve el stock y descuenta la caja (también lo cobrado con el Point integrado) en una sola transacción.
3. **Sin emojis** dentro de las secciones (títulos, botones, avisos). Quedan ✓ y ✕, y las flechas.

## Dónde va (repo fen-ventas, raíz, los CINCO juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png` y **`resumen-caja.js` (nuevo)**. Este README a `respaldos/caja-v2.9.0/`.
Ojo: es el repo **fen-ventas** (la caja), no sistema-fen. Si falta `resumen-caja.js`, la caja no abre.
Sistema Fën v0.117.0 va aparte, a su repo. Reglas de Firestore, Apps Script y servidor de cobros: sin cambios.

## Checklist
- [ ] Los cinco archivos en la raíz de **fen-ventas**, en una sola subida; recargar la caja.
- [ ] Al lado del correo dice "· v2.9.0".
- [ ] Una venta, y en "Ventas del turno" cambiar su medio de pago: cambia en la venta y en el arqueo.
- [ ] Al cierre del día, el cierre y su resumen como siempre (Sistema Fën → Ventas de caja → Reportes lo muestra al otro día).

## Pruebas
- `pruebas/caja29/caja-v290.test.js` (36): las 32 de la v2.8.0 contra la v2.9.0 y 4 nuevas (resumen-caja.js igual al de Sistema Fën y la caja lo usa; sin emojis; el cierre guarda el mismo resumen que la v2.8.0; cambiar el medio es un lote y si falla no cambia nada; pedir una anulación es un lote).
- `pruebas/caja29/caja-v290-azar.test.js`: 150 ventas al azar dejan los mismos datos que la v2.8.0.

---

# fën caja · v2.8.0

**Etapa 3 (segunda parte) de la revisión de la caja B2C: el aspecto nuevo, opción A elegida por Emmanuel el 29 oct** (lienzo "Boceto · Aspecto de la caja"). Nada cambia en lo que hace la caja. · 29 de octubre de 2026

## Qué cambia
- **Barra lateral como Sistema Fën** (computador y tablet): logo completo, la tienda, Venta, Stock, Caja y Productos con íconos, el correo con la versión y "Salir".
- **Se colapsa con la flecha de abajo:** queda una franja angosta con los íconos, "fën", la tienda corta (BA o AI) y la versión, y los productos ganan espacio. La misma flecha la vuelve a abrir. **Cada equipo recuerda cómo la dejó.** Si nunca se tocó, en pantallas de menos de 1024 px parte colapsada.
- **En el celular** (760 px o menos): arriba el logo, la tienda, el correo con la versión y "Salir"; las cuatro secciones en una barra abajo, como en Sistema Fën.
- **Azules pastel** (fondo, barra, bordes y marcado, y el marino del logo para títulos y botones). Las áreas conservan su color, "Registrar pago" sigue en verde y las tarjetas de frescura siguen con sus colores.
- **El logo ahora se ve** (es oscuro y antes estaba sobre azul oscuro), también en el ingreso y al elegir la sucursal. Barra e ingreso sin emojis.
- Lo de adentro de cada sección (botones, ventanas, cierre) se ve como antes, con los colores nuevos; los emojis de adentro quedan para otra vuelta.

## Dónde va (repo fen-ventas, raíz, los cuatro juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png`. Este README a `respaldos/caja-v2.8.0/`. Reglas de Firestore, Apps Script, servidor de cobros y Sistema Fën: sin cambios.
**Cuándo:** después del piloto del Point en Barros Arana (para no cambiar dos cosas el mismo día).

## Checklist
- [ ] Los cuatro archivos en la raíz de fen-ventas, en una sola subida; recargar la caja en cada equipo.
- [ ] En el ingreso y al elegir sucursal se ve el logo sobre azul claro.
- [ ] En el computador o la tablet: la barra a la izquierda con el logo; abajo dice "· v2.8.0" al lado del correo.
- [ ] La flecha de abajo colapsa la barra y la vuelve a abrir; al recargar, queda como se dejó.
- [ ] En un celular: las cuatro secciones abajo y "Salir" arriba.
- [ ] Una venta y, al final del día, el cierre, como siempre.

## Pruebas
- `pruebas/caja28/caja-v280.test.js` (32): las 27 de la v2.7.0 contra la v2.8.0 y 5 nuevas (sin el azul de antes y fuera de la barra el código es el de la v2.7.0; barra abierta, colapsada y recordada; tablet de 800 px parte colapsada y 1024 px abierta; celular con la barra abajo; sin desborde a 390, 768, 1024 y 1440 px en las cuatro secciones). Capturas en `pruebas/capturas/caja28/`.
- `pruebas/caja28/caja-v280-azar.test.js`: 150 ventas al azar dejan los mismos datos que la v2.7.0.

---

# fën caja · v2.7.0

**Etapa 3 (primera parte) de la revisión de la caja B2C, aprobada por Emmanuel el 29 oct: la caja queda solo con lo del mostrador, y el cierre anota las ventas por tipo de leche.** · 29 de octubre de 2026

## Qué cambia
1. **Se retiran de la caja** (todo ya está en Sistema Fën, revisado con Emmanuel el 29 oct):
   | Antes en la caja | Ahora en Sistema Fën |
   |---|---|
   | Reportes › Ventas, Valor stock, Merma | Ventas de caja › Reportes y Merma y stock |
   | Reportes › Eval. caja (arqueos, cajas sin cerrar, resúmenes faltantes) | Ventas de caja › Cierres |
   | Reportes › Solicitudes de anulación | Ventas de caja › Anulaciones |
   | Configuración › Tiempos de pago | Configuración (la caja ya no vuelve a dejar Barros Arana en 0) |
   | Productos › Tipos de leche, Motivos de merma | Configuración |
   | Productos › Lista de productos | Catálogo |
   | Configuración › Exportar precios por área | Se retira (no se usa) |
2. **Queda en la caja** lo del mostrador: Venta (y Mesas), Stock, Caja (apertura y cierre), Productos con "Pedir producto", la impresora de cada equipo y el aviso de una caja anterior sin cerrar. La caja sigue usando los tipos de leche y los motivos de merma que se configuran en Sistema Fën.
3. **El cierre guarda las ventas por tipo de leche** (en `resumenes_caja`: `porLeche` en total y en cada producto). Sistema Fën v0.116.0 lo muestra en Ventas de caja › Reportes › Por tipo de leche; más adelante lo usa el control de stock de materias primas.
4. **Más liviana:** el código baja de 5.114 a 3.778 líneas y ya no carga Chart.js ni html2canvas. Con cuenta de administración, entrar a Productos ya no lee todos los productos.
- Para la vendedora, nada cambia.

## Dónde va (repo fen-ventas, raíz, los cuatro juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png`. Este README a `respaldos/caja-v2.7.0/`. Reglas de Firestore, Apps Script y servidor de cobros (fen-point 0.4.1): sin cambios.
**Cuándo:** después del piloto del Point en Barros Arana (para no cambiar dos cosas el mismo día). Junto con Sistema Fën v0.116.0, que muestra el reporte de leche.

## Checklist
- [ ] Los cuatro archivos en la raíz de fen-ventas, en una sola subida.
- [ ] Al abrir la caja dice "v2.7.0" al lado del correo.
- [ ] Con la cuenta de administración, arriba solo aparecen Venta, Stock, Caja y Productos.
- [ ] Una venta de café con tipo de leche (en la nota) y el cierre del día como siempre; al otro día, Sistema Fën → Ventas de caja → Reportes → "Por tipo de leche" la muestra.

## Pruebas
- `pruebas/caja27/caja-v270.test.js` (27): las 22 de la v2.6.1 contra la v2.7.0 y 5 nuevas (lo retirado ya no está y lo del mostrador sigue; con cuenta de administración solo las cuatro pestañas y sin leer todos los productos; los tipos de leche y motivos de Sistema Fën se usan; el cierre guarda `porLeche`; sin desborde a 390, 768 y 1440 px).
- `pruebas/caja27/caja-v270-azar.test.js`: 150 ventas al azar dejan los mismos datos que la v2.6.1.

---

# fën caja · v2.6.1

**Dos arreglos pedidos por Emmanuel el 29 oct, sobre la v2.6.0.** · 29 de octubre de 2026

1. **El stock en pantalla baja al instante después de vender.** Antes seguía mostrando lo que había al abrir la pestaña, y en la misma pantalla se podía volver a vender lo que ya no estaba (por ejemplo, las mismas 3 ciabattas). Ahora, al registrar la venta, la caja descuenta en pantalla lo vendido (con lo que leyó justo antes de guardar: sin lecturas extra).
   - **Si otra caja vendió mientras tanto:** al cobrar, la caja lee el stock real; si no alcanza, avisa "No alcanza el stock: Ciabatta: pidió 3, quedan 1", **no registra**, deja el pedido para ajustarlo y actualiza la pantalla. Con el Point integrado, lo revisa **antes** de mandar el cobro al Point.
2. **El día bajo cada tarjeta de frescura:** Hoy (jue 29), Ayer (mié 28), Ant. (mar 27), 4to (lun 26), Últ. (≤ dom 25: lo de ese día o antes, y lo pasado a mano a última oferta). Se calcula solo con la fecha de hoy; sirve igual en Mesas.

Dónde va: igual que la v2.6.0 (los cuatro archivos juntos a la raíz de fen-ventas; este README a `respaldos/caja-v2.6.1/`).

Pruebas: `pruebas/caja261/caja-v261.test.js` (las de la v2.6.0 contra la v2.6.1 y 4 nuevas) y `caja-v261-azar.test.js` (150 ventas al azar con stock de sobra: los mismos datos que la v2.6.0; con poco stock la v2.6.0 dejaba vender lo que ya no había, que es lo que se corrige).

---

# fën caja · v2.6.0

**Etapa 2 de la revisión de la caja B2C: cada venta se guarda de una sola vez.** La venta, la marca de los productos vendidos, los totales de la caja, el descuento de stock y su movimiento van juntos en un lote de escrituras: o queda todo o no queda nada. Igual al cobrar una mesa (venta, totales y cierre de la mesa). Además, **la versión se ve** en la pantalla de ingreso y en el encabezado, al lado del correo. · 29 de octubre de 2026

## Qué cambia
- **Sin ventas a medias:** si se corta internet al registrar, la caja avisa "Error al registrar" y el pedido sigue abierto para reintentar; no queda una venta sin sumar a la caja ni stock sin descontar. Es la causa más probable de los cierres que no cuadraban.
- **El stock se descuenta restando** lo que sale (antes se escribía el número nuevo): si dos equipos venden el mismo pan a la vez, los dos descuentos cuentan. Si se vende más de lo que había, el lote puede quedar en negativo (antes quedaba en 0 y la diferencia se perdía).
- **Para la vendedora, nada cambia** salvo la versión a la vista.
- Si la caja no puede leer el stock antes de vender (sin conexión), sigue el camino de siempre, como antes.

## Dónde va (repo fen-ventas, raíz, los cuatro juntos en una sola subida)
`index.html`, `caja.js`, `caja.css`, `logo-fen.png` (el logo no cambia, pero se sube igual). Este README a `respaldos/caja-v2.6.0/`. Reglas de Firestore, Apps Script y servidor de cobros: sin cambios.

## Checklist
- [ ] Los cuatro archivos en la raíz de fen-ventas, en una sola subida.
- [ ] Al abrir la caja dice "Caja v2.6.0" debajo de Entrar y "· v2.6.0" al lado del correo.
- [ ] Una venta en efectivo, una con tarjeta y una de un pan con stock: se registran como siempre y el stock baja.

## Pruebas
- `pruebas/caja26/caja-v260.test.js` (18): las de la v2.5.0 contra la v2.6.0; versión a la vista; una venta = un lote; si el lote falla no queda nada y el pedido sigue.
- `pruebas/caja26/caja-v260-azar.test.js`: **150 ventas al azar** (con y sin control de stock, permanentes, lotes de hoy, ayer y antes de ayer, los cuatro medios y pago dividido) dejan exactamente los mismos datos en la v2.6.0 que en la v2.5.0: ventas, totales, stock por lote, movimientos y productos marcados; un lote por venta.

---

# fën caja · v2.5.0

**Etapa 1 de la revisión de la caja B2C: el archivo pasa de 4,9 MB a unos 380 KB.** El logo, que estaba incrustado dos veces (2,3 MB cada una), queda como imagen aparte de 53 KB; los estilos y el código, en sus propios archivos. **Nada más cambia:** la caja hace exactamente lo mismo que la v2.4.1 (se comprueba juntando los archivos de nuevo). · 29 de octubre de 2026

## Dónde va (repo fen-ventas, raíz, los cuatro juntos en una sola subida)
| Archivo | Qué es |
|---|---|
| `index.html` | la página (42 KB; antes 4,9 MB) |
| `caja.js` | el código (antes dentro de index.html) |
| `caja.css` | los estilos (antes dentro de index.html) |
| `logo-fen.png` | el logo, 360 × 360 px |
| `README.md` | a `respaldos/caja-v2.5.0/` |

Súbalos **los cuatro en la misma subida** (Add file → Upload files, arrastrando los cuatro): si se sube solo el `index.html`, la caja queda sin código. Reglas de Firestore, Apps Script y servidor de cobros: sin cambios (sigue fen-point 0.4.1).

## Checklist
- [ ] Los cuatro archivos en la raíz de fen-ventas, en una sola subida.
- [ ] Abrir la caja (recargar si estaba abierta): se ve igual; en Productos, abajo, dice "Caja v2.5.0".
- [ ] Una venta en efectivo y, con el Point integrado, una con Tarjeta, como siempre.

## Pruebas
`pruebas/caja25/caja-v250.test.js` (16): `construir_v250.py` reproduce los cuatro archivos; juntarlos de nuevo da la v2.4.1 (salvo el logo y la versión); las 14 pruebas de la v2.4.1 contra la v2.5.0; el logo se carga.

Nota: el logo del encabezado ya no se veía bien antes (es oscuro sobre el fondo azul); se corrige con el nuevo aspecto de la etapa 3.

---

# fën caja · v2.4.1

**Arreglo sobre la v2.4.0, después de la prueba del 29 oct en Ainavillo: la venta pagada con el Point se registra en unos segundos (antes 30 a 40) y, si un cobro "no completado" igual termina pagado, se registra ese pago en vez de cobrar otra vez.** Todo lo demás es igual a la v2.4.0. · 29 de octubre de 2026

## v2.4.1
- Mientras espera el pago, la caja pide al servidor de cobros que confirme con Mercado Pago (necesita **fen-point 0.4.1**).
- Un cobro vencido o cancelado se sigue mirando 2 minutos; antes de "Volver a cobrar" se revisa el intento anterior. (En la prueba, Mercado Pago no dejó pagar un cobro vencido o cancelado: es un resguardo.)
- Si la venta se cobra de otra forma (por ejemplo, en efectivo), el intento anterior deja de mirarse.
- Dónde va: igual que la v2.4.0 (`index.html` a la raíz de fen-ventas; este README a `respaldos/caja-v2.4.1/`). Primero el Worker 0.4.1.
- Pruebas: `pruebas/caja241/caja-v241.test.js` (15: las 11 de la v2.4.0 contra la v2.4.1 y 4 nuevas).

---

# fën caja · v2.4.0

**Cobro con el Point de Mercado Pago integrado.** Cuando el Point de la tienda está en modo integrado (PDV), el botón "Tarjeta" manda el cobro al Point y la venta se registra sola cuando Mercado Pago confirma el pago. Cuando el Point está en modo normal, la caja funciona exactamente como antes. · 29 de octubre de 2026

## Dónde va
| Archivo | Dónde |
|---|---|
| `index.html` | GitHub, repo **fen-ventas**, **raíz** (Upload files; reemplaza al de la v2.3.1) |
| `README.md` | repo fen-ventas, carpeta `respaldos/caja-v2.4.0/` |

**Antes:** publicar el servidor de cobros **fen-point 0.4.0** en Cloudflare (la caja le pregunta el modo del Point). Reglas de Firestore y Apps Script: **nada que cambiar**.

## Qué cambia para la vendedora
- **El modo lo manda el Point.** La caja pregunta el modo del Point de su tienda al entrar y cada 3 minutos.
  - **Point en modo integrado:** en "Medio de pago" aparece "Point integrado"; Débito y Crédito se juntan en **"Tarjeta"** (el Point sabe cuál es).
  - **Point en modo normal, o sin respuesta del servidor:** la caja es la de siempre (Efectivo, Débito, Crédito, Transferencia).
- **Cobrar con tarjeta (integrado):** al tocar "Registrar pago", el monto aparece solo en el Point. La pantalla "El cliente paga en el Point" muestra cuánto falta para que venza (3 minutos) y los botones **Cancelar cobro** y **Cobrar sin integración**.
  - **Pagado:** la venta se registra sola con el tipo real (débito o crédito; prepago y dinero en cuenta se suman a débito) y el número de la orden de Mercado Pago.
  - **Rechazado, cancelado o vencido:** no se registra nada; el pedido sigue abierto para volver a cobrar o cambiar el medio de pago.
  - **Cancelar:** si el cobro ya llegó al Point, se cancela en el mismo Point (salir de la pantalla de cobro y confirmar); la caja lo avisa y avanza sola.
- **Pago dividido:** la parte con tarjeta (casilla "Tarjeta") es la única que va al Point.
- **Efectivo y transferencia:** no tocan el Point.
- **Plan B (sin conexión con el Point):** la caja muestra los pasos: cancelar en el Point si el cobro alcanzó a llegar, pasar el Point a modo normal (**Más opciones › Ajustes › Modo de vinculación**), digitar el monto y registrar con Débito o Crédito. Esa venta queda marcada (`pagoSinIntegracion`) para cuadrarla con el reporte de Mercado Pago. La venta siguiente vuelve sola al cobro integrado.
- **Si el pago se confirmó pero la venta no alcanzó a registrarse** (por ejemplo, se cortó internet): la caja lo dice y "Registrar venta" la registra con el pago ya confirmado, sin volver a cobrar.
- **Cierre de caja:** lo cobrado con el Point integrado aparece arriba de Débito y Crédito ("confirmado por Mercado Pago, no se cuenta"); abajo se escribe solo lo cobrado sin integración. El arqueo lo suma solo.
- **Una venta cobrada con el Point integrado no cambia de medio de pago** desde "Últimas ventas" (lo confirmó Mercado Pago).
- **Cada equipo recuerda su tienda:** la primera vez queda anotada; si después se elige la otra, pregunta "Este equipo suele trabajar en …, ¿seguro que quiere entrar como …?". No bloquea.

## Qué guarda
- `ventas/{id}.pagoPoint`: `{ referencia, ordenId, pagoId, tipoPago, medio, monto }` en las ventas cobradas con el Point integrado; `pagoSinIntegracion: true` en las cobradas a mano con el Point integrado (plan B).
- `cajas/{id}.totalesPoint`: `{ debito, credito }`, en la misma escritura de los totales (sin escrituras nuevas).
- En el equipo: `fen_caja_tienda_equipo` (la tienda del equipo).
- Lo demás, igual que la v2.3.1. Sistema Fën lee las ventas y los cierres como siempre.

## Costo
Firestore: las mismas lecturas y escrituras por venta; al abrir el cierre, una lectura de la caja. El servidor de cobros (Cloudflare, gratis) recibe: el modo del Point cada 3 minutos por equipo, el cobro y una pregunta cada 2 segundos mientras se espera el pago.

## Límites conocidos
- Si se anula una venta cobrada con el Point integrado, el cierre todavía la cuenta como cobrada con tarjeta (el dinero se cobró; la devolución se hace en Mercado Pago).
- Las mesas usan el mismo cobro integrado al "Cobrar y cerrar mesa".

## Pruebas
`pruebas/caja24/caja-v240.test.js` (12): el parche reproduce el archivo; sin secretos; Point en modo normal = caja de siempre; cobro integrado pagado con crédito; efectivo sin Point y prepago como débito; pago dividido; vencido y volver a cobrar; cancelar en el Point; plan B; cierre que cuadra; el equipo recuerda su tienda; no se cambia el medio de una venta del Point. Capturas en `pruebas/capturas/caja240/`.

## Checklist
- [ ] Servidor de cobros en 0.4.0 (su dirección lo dice).
- [ ] Subir `index.html` a la raíz de fen-ventas; abajo en Productos dice "Caja v2.4.0".
- [ ] Con el Point de Barros Arana en **modo normal**: la caja se ve y cobra como siempre.
- [ ] Piloto en horario tranquilo: Sistema Fën → Ventas de caja → Point → Barros Arana "Pasar a integrado" y reiniciar el Point; en la caja aparece "Point integrado" (o al volver a entrar); una venta chica con "Tarjeta"; revisar que quede registrada y en "Cobros recientes".
- [ ] Probar una vez el plan B en el Point (Más opciones › Ajustes › Modo de vinculación).
