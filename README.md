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
