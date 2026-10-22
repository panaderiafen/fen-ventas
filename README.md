# fën caja · v2.3.1

**Arreglo chico sobre la v2.3.0: vuelven los dos correos que te llegan al cerrar caja con descuadre y cuando una cajera pide anular una venta.** Todo lo demás es igual a la v2.3.0. · 22 de octubre de 2026

## v2.3.1: vuelven los correos de descuadre y de anulación
La v2.3.0 quitó todas las llamadas a Apps Script, y con ellas se fueron también dos correos que usas. En esta versión vuelven **solo esos dos**, igual que en la v2.2.0:

1. **Descuadre al cerrar caja:** si el cierre tiene diferencia, te llega el correo "Descuadre de caja" con la sucursal, la fecha de la caja, la cajera, la diferencia total, la diferencia en efectivo y la nota de la cajera (lo envía el script de ventas, `caja/webhook-ventas`).
2. **Solicitud de anulación:** cuando una cajera pide anular una venta, te llega el correo con la venta, el total, el medio de pago y el motivo (lo envía el script de caja, `caja/webhook-caja`).

- Los dos salen **sin esperar**: si el script tarda o no responde, el cierre y la solicitud siguen igual (los datos ya quedaron en Firestore y Sistema Fën → Hoy los muestra).
- Llevan, como antes, el token de la sesión de Firebase y la clave única, así que los scripts que ya tienes los aceptan y un envío repetido no llega dos veces.
- **Arreglo de paso:** la ventana para escribir la nota del descuadre quedaba **debajo** de la ventana del cierre (así venía desde la v2.1), y en algunos equipos no se podía tocar "Continuar y cerrar caja". Ahora queda encima.
- **Nada más vuelve:** ni la copia de los cierres o la merma a la planilla, ni la lista de recetas (CSV), ni las ventas mensuales.

### Instalación (2 minutos)
1. GitHub, repo **fen-ventas**, **raíz** → **Add file → Upload files** → `index.html` de este zip (reemplaza el de la v2.3.0) → **Commit changes**. Guarda este README en `respaldos/caja-v2.3.1/`.
2. Espera 1 o 2 minutos y recarga los equipos de caja (Ctrl+Shift+R en el PC; en la tablet, cerrar y abrir).

**Nada que cambiar en las reglas ni en Apps Script:** las reglas de Firestore siguen en v1.5.0 y los dos scripts (`webhook-caja` y `webhook-ventas`) siguen funcionando tal como están.

### Lista de verificación v2.3.1
- [ ] Productos → abajo dice **Caja v2.3.1**.
- [ ] Pide anular una venta de prueba → te llega el correo de la solicitud de anulación.
- [ ] Cierra una caja de prueba con una diferencia (por ejemplo, $100 menos en efectivo) y escribe la nota → te llega el correo "Descuadre de caja".
- [ ] Un cierre sin diferencia no manda correo.

### Si algo sale mal
Sube de nuevo el `index.html` de la v2.3.0 (`caja-v2.3.0.zip`): todo funciona igual, solo que sin esos dos correos.

---

# Lo que trae la v2.3.0 (sigue igual)

**Etapa 2b del plan de coherencia: el catálogo se administra solo en Sistema Fën.** Va con **Sistema Fën v0.75.0** y las **reglas de Firestore v1.5.0** de fen-ventas.

## Para qué
Tus decisiones: un dueño por cosa; unir por ID, nunca por nombre; se crea en un solo lugar y los demás piden; una sola lista de áreas (la de Sistema Fën); la venta guarda su foto; nada se borra. Desde esta versión **la caja solo vende lo que está habilitado** en Sistema Fën → Catálogo y, si falta algo, **lo pide**.

## Qué cambia
1. **Productos:** ninguna cuenta crea ni cambia productos en la caja (ni precios, ni área, ni receta, ni activar o desactivar). Se hace en **Sistema Fën → Catálogo → Productos**. La pestaña Productos de la caja ahora tiene:
   - **Pedir producto** (todas las cuentas) y **Tus pedidos** (con su estado: Pendiente, Aprobado o Rechazado, y la respuesta).
   - Los tipos de leche y los motivos de merma (igual que antes).
   - Solo la administración: la **lista de productos para mirar**, con el aviso de los productos **sin área**.
2. **Pedir producto** (también en la pantalla de venta, junto a "Vista general"): un diálogo en la página con el nombre, un precio sugerido (con IVA, opcional) y una nota. Se guarda en `solicitudes_producto` y aparece en Sistema Fën → Hoy y → Catálogo → Productos → Pedidos. Cuando lo resuelves, la cajera ve "Aprobado" (o "Rechazado" con el motivo) y el producto aparece en la caja al recargarla.
3. **Áreas (pestañas):** la lista fija de Sistema Fën: **Panadería, Bollería, Pastelería, Cafetería y Reventa**. La pestaña antigua **REV es la misma Reventa** (los productos con área REV o REVENTA salen juntos en "Reventa"). Un producto con un área que no está en la lista (o vacía) **ya no cae en Bollería**: sale en la pestaña **"Sin área"** y la lista de la administración lo avisa (corrígelo en el Catálogo). La caja ya no crea, cambia ni borra áreas.
4. **La venta guarda su foto:** cada línea de una venta lleva `catalogoId`, `tipo` (receta, reventa o cargo), `area`, `recetaId` o `reventaId` y `unidadesPorVenta` (si el producto las tiene), tal como estaba el producto al vender (un producto anterior al catálogo usa su ID de receta de siempre). El resumen de cada cierre (`resumenes_caja`) lleva también, por producto, `catalogoId`, `tipo`, `recetaId` y `reventaId`. Así Finanzas y el Plan de Panadería saben qué se vendió aunque el producto cambie después.
5. **Sin Apps Script ni planillas:** la caja ya no llama a ningún script ni lee la planilla. Se quitaron: la lista de recetas de Producción (CSV), "Recetas sin producto en B2C", vincular recetas, "Revisar sincronización", las áreas, la reconciliación de nombres históricos (equivalencias), "Ventas mensuales hacia fën-producción", **la copia de los cierres a la planilla** (y su aviso "no alcanzó a llegar a la planilla" y "Cierres sin pasar a planilla"), la copia de la merma a la planilla y (solo en la v2.3.0) los correos de anulación y descuadre, que vuelven en la v2.3.1. Todo queda en Firestore, donde lo lee Sistema Fën (Hoy muestra las anulaciones por aprobar y los descuadres).
6. **El cierre** guarda el resumen como siempre. Si no alcanzara a guardarse (por ejemplo, sin conexión), la caja queda marcada (`resumenPendiente`) y se reintenta sola al elegir la sucursal y a medianoche; en Sistema Fën → Ventas de caja aparece en "Cierres sin resumen" con "Generar resumen".
7. Sigue igual: vender, el stock por tarjeta y lotes, la merma (Stock → Merma; registrarla queda en el informe de merma), anulaciones, mesas, la impresión, los reportes, la evaluación de caja y los tiempos de pago.

## Lecturas y escrituras
- **Menos:** ya no se lee la lista de recetas (CSV) ni las áreas de Firestore, y ya no hay envíos al script.
- **Pedir producto:** 1 escritura por pedido; "Tus pedidos": 1 lectura por pedido de esa cuenta (los suyos), al abrir el diálogo o la pestaña Productos.
- **Lista de la administración:** los productos, una vez al abrir la lista.
- La venta y el cierre: las mismas lecturas y escrituras que la v2.2.0.

## Archivos
```
index.html      la caja v2.3.1   → GitHub, repo fen-ventas, raíz
README.md       este archivo     → GitHub, repo fen-ventas, respaldos/caja-v2.3.1/
```
`parche_v231.py` (solo para quien mantiene la caja) arma este `index.html` desde la v2.2.0: aplica `parche_v230.py` y le suma los dos correos.

## Instalación de la v2.3.0 (si vienes de la v2.2.0; unos 5 minutos, en este orden)
1. **Primero las reglas:** consola de Firebase → proyecto **fen-ventas** → Firestore → **Reglas** → pega `firestore.rules` (**v1.5.0**, viene en el zip de Sistema Fën v0.75.0) → **Publicar**. Sin ellas, "Pedir producto" dice que faltan las reglas; con ellas, la caja v2.2.0 ya no puede crear productos (por eso va primero y la caja justo después).
2. **La caja:** GitHub, repo **fen-ventas**, **raíz** → **Add file → Upload files** → `index.html` de este zip → **Commit changes**. Guarda este README en `respaldos/caja-v2.3.0/`.
3. Espera 1 o 2 minutos y recarga los equipos de caja (Ctrl+Shift+R en el PC; en la tablet, cerrar y abrir).

## Lista de verificación v2.3.0
- [ ] Productos → abajo dice **Caja v2.3.0**; no hay formulario de producto ni "Recetas sin producto"; está **Pedir producto**.
- [ ] Venta: las pestañas son Panadería, Bollería, Pastelería, Cafetería y **Reventa** (las que tienen productos); lo que antes estaba en REV sale en Reventa.
- [ ] Vende un pan y un producto de reventa: el cobro, el ticket y el stock se ven igual. En Firebase → `ventas`, la última venta: cada línea tiene `catalogoId`, `tipo`, `area` y `recetaId` o `reventaId`.
- [ ] **Pedir producto** con un nombre de prueba → en "Tus pedidos" dice Pendiente → en Sistema Fën → Hoy dice "1 producto pedido" → resuélvelo (o recházalo) en Catálogo → Productos → Pedidos → en la caja dice Aprobado (o Rechazado) con la respuesta.
- [ ] Cierra la caja: se cierra sin avisos de planilla; en `resumenes_caja/<id>` cada producto trae `catalogoId` y `tipo`.
- [ ] Con la cuenta de administración: Productos → Lista de productos (solo para mirar). Si hay productos "sin área", el aviso los nombra: corrígelos en el Catálogo.

## Si algo sale mal
Sube de nuevo el `index.html` de la v2.2.0 (`respaldos/caja-v2.2.0/` o `caja-v2.2.0.zip`). Ojo: con las reglas v1.5.0, la v2.2.0 ya no deja a las cajeras crear productos ni áreas (la administración sí); vender, cerrar y lo demás funciona igual. Lo vendido con la v2.3.0 queda bien (los campos nuevos simplemente no se usan).
