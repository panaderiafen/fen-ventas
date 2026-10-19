# fën caja · v2.2.0

**Solo cambia la caja (index.html).** Scripts, reglas de Firestore (v1.3.0) y planillas quedan igual. · 19 de octubre de 2026

## Para qué
Para medir bien la sobreproducción de pan. Hasta la v2.1.1 la caja no guardaba en qué tarjeta (hoy, ayer, antes de ayer, 4° día, última oferta) se vendió cada pan, ni a qué hora se agotó el pan del día. Ahora sí (opción A, aprobada el 19-oct).

## Qué cambia
Nada en la pantalla ni en cómo se vende: mismos precios, mismo carrito, mismo descuento de stock, misma impresión. Solo se anota lo que ya pasa:

1. **Cada venta guarda, por producto con stock:**
   - `tarjeta`: `hoy`, `ayer`, `antesayer`, `cuartoDia` o `ultimaOferta` (los nombres que ya usa la caja);
   - `lotes`: de qué lotes (fecha de ingreso) salió, por ejemplo `{ "20261019": 2 }`, tal como lo descuenta el stock (FIFO dentro de la tarjeta, o el lote elegido en Última oferta).
   - Con **excepción horaria**, la tarjeta es la que eligió la cajera (por ejemplo, Ayer cobrado a precio de hoy antes de las 15:00 queda como `ayer`).
   - Los productos sin control de stock y los permanentes quedan igual que antes.
2. **Agotado:** cuando una venta deja en 0 el pan que entró **hoy**, se anota la hora (`agotado`) en el mismo cambio que descuenta el stock. Si se vuelve a ingresar pan ese día y se vende todo otra vez, se mantiene la primera hora y se anota la nueva como `reagotado`. La merma no cuenta.
3. **Resumen de cada cierre** (`resumenes_caja`): por producto se agregan `porTarjeta` (cantidad y monto de cada tarjeta), `agotadoHoy` y `reagotadoHoy`. Los totales de siempre quedan idénticos. Lo vendido sin tarjeta anotada (ventas de antes de esta versión en la misma caja) queda como `sinDato`, así que `porTarjeta` siempre suma lo mismo que el total.
4. **Anular:** sigue devolviendo el stock al mismo lote (como en la v2.1.1). Además, si faltara el movimiento de stock de la venta, usa los lotes guardados en la línea.
5. **Mesas:** al cobrar, cada línea guarda su tarjeta (el stock ya se descontó al agregar, sin lotes ni hora de agotado).

Sistema Fën v0.70.1 ya lee estos datos (para el Plan de Panadería) y en Caja → Reportes de un día muestra "agotado 11:40" junto al producto.

## Lecturas y escrituras
- **Lecturas:** las mismas o menos. Antes de guardar la venta se leen los mismos documentos de stock que ya se leían para descontar (uno por producto; si hay dos líneas del mismo producto, uno solo).
- **Escrituras:** las mismas, en los mismos documentos (venta, caja, stock, movimiento de stock y resumen). La hora de agotado va dentro del mismo cambio de stock.

## Sin conexión
Si al cobrar no se puede leer el stock (por ejemplo, se cayó internet), la venta sigue **exactamente como en la v2.1.1**: se guarda con su tarjeta, pero sin los lotes ni la hora de agotado. El stock se descuenta igual que siempre.

## Archivos
```
index.html   la caja v2.2.0   → GitHub, repo fen-ventas, raíz (y prueba/index.html para probar)
README.md    este archivo     → GitHub, repo fen-ventas, respaldos/caja-v2.2.0/
```

## Instalación (unos 5 minutos)
**No hay que cambiar reglas de Firestore ni scripts.** Las reglas v1.3.0 ya permiten guardar estos campos.

1. **Prueba:** sube la carpeta `prueba` de `prueba-caja-v2.2.0.zip` a `fen-ventas` (Add file → Upload files → Commit changes). En `…/prueba/`, con la caja abierta, haz las primeras ventas de la lista de verificación de abajo.
   (i) Como siempre en la caja, la prueba usa los datos reales: lo que vendas queda registrado. Anula después lo que sea de prueba.
2. **Producción:** sube `index.html` a la **raíz** de `fen-ventas` (Add file → Upload files → Commit changes), espera 1 o 2 minutos y recarga los equipos de caja (Ctrl+Shift+R en el PC; en la tablet, cerrar y abrir).
3. Sube Sistema Fën v0.70.1 (zip aparte) cuando quieras; no depende del orden.

## Lista de verificación v2.2.0
- [ ] Vende 1 pan desde **Hoy** y 1 desde **Ayer** (prueba o producción). El cobro, el ticket y el stock se ven igual que antes.
- [ ] En Firebase → Firestore → `ventas`, la última venta: cada línea de pan tiene `tarjeta` (`hoy` / `ayer`) y `lotes` con la fecha de ingreso. Una bebida o un producto sin control de stock no los tiene.
- [ ] Un producto con **excepción horaria** vendido desde Ayer antes de las 15:00: precio de hoy y `tarjeta: "ayer"`.
- [ ] Vende el último pan de hoy de un producto: en `stock/<sucursal>_<producto>` aparece `agotado: { "AAAAMMDD": "HH:MM" }`.
- [ ] Pide anular una venta de prueba y apruébala: el stock vuelve al mismo lote.
- [ ] Al cerrar la caja, en `resumenes_caja/<id de la caja>` cada pan tiene `porTarjeta` y, si se agotó, `agotadoHoy`. El total del cierre y la planilla quedan como siempre.
- [ ] Las dos sucursales funcionan igual (Barros Arana; Ainavillo cuando registre ventas).

## Si algo sale mal
Sube de nuevo el `index.html` de la v2.1.1 (`respaldos/caja-v2.1.1/` o `caja-v2.1.1.zip`). Lo vendido con la v2.2.0 queda bien: los campos nuevos simplemente no se usan, y las anulaciones siguen funcionando con los movimientos de stock.

## Pruebas automáticas
15 nuevas (`caja-v220.test.js`): venta desde Hoy y desde Ayer, una línea que gasta dos lotes, Última oferta con lote elegido, productos sin stock y permanentes, anulación (por movimiento y por los lotes de la línea), resumen por tarjeta igual a los totales de la v2.1.1, agotado una vez y reagotado, agotado que no se anota con lotes viejos ni con merma, excepción horaria, sin conexión igual que la v2.1.1, mesas, Ainavillo, 300 ventas al azar comparadas con la v2.1.1 (mismo stock, movimientos, caja y escrituras) y que el archivo solo cambia donde corresponde. Las 21 de la v2.1 siguen pasando.
