# Caja v3.7.0 — Vuelto al pagar en efectivo

**Dónde va:** repo **fen-ventas** en GitHub (Add file → Upload files, los archivos del zip, Commit). Apps Script: sin cambios.

## Qué cambia
- Al elegir **Efectivo** (como único medio) aparece **"¿Con cuánto paga?"**:
  - Se escribe el monto, o se toca uno de los botones: **Justo** y los montos típicos con billetes (por ejemplo, para $11.000: $12.000, $15.000, $20.000).
  - Muestra el **Vuelto** en grande, o "Faltan $…" si no alcanza.
  - Sigue al total si se agregan o quitan productos.
- Con otro medio de pago, con pago dividido o al terminar la venta, se esconde y queda vacío.
- Es solo una ayuda: no se guarda en la venta ni cambia el cuadre.

## Revisar después de subir
- [ ] La pantalla de entrada dice **Caja v3.7.0**.
- [ ] Una venta en efectivo: tocar un billete y ver el vuelto.
