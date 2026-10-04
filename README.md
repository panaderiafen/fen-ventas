# fën caja · v2.1.1

**Solo cambia la caja (index.html).** Scripts, reglas y planillas quedan igual que en la v2.1.0. · 4 de octubre de 2026

## Qué arregla
Al **aprobar una anulación**, el stock de la venta no volvía: la caja lo escribía en un campo del formato antiguo de stock, que el formato actual ya no usa.

Desde esta versión (decisión del 4-oct: el stock vuelve **al mismo lote del que salió**):
- Cada venta anota de qué lotes (fechas de ingreso) se descontó cada producto. Queda en la colección `stockMovimientos`, un documento por venta.
- Al aprobar la anulación, cada unidad vuelve a su lote original, en la **sucursal de la venta** (antes usaba la sucursal que tenía abierta quien aprobaba).
- Para ventas **anteriores a esta versión** o de **mesas**, no se sabe de qué lote salieron. En esos casos se devuelve solo lo seguro (productos permanentes y lotes elegidos a mano en "Última oferta") y la caja te avisa qué productos ajustar a mano en Stock.

## Archivos
```
index.html   la caja v2.1.1   → GitHub, raíz del repo fen-ventas (y prueba/index.html para probar)
README.md    este archivo     → GitHub, respaldos/caja-v2.1.1/
```

## Instalación
1. **Prueba:** sube la carpeta `prueba` de `prueba-caja-v2.1.1.zip` a `fen-ventas`. En `…/prueba/`: haz una venta chica de un producto con control de stock, mira su stock en la pestaña Stock, pide anularla (con cuenta de cajera) y apruébala como admin. El stock debe volver a la cantidad de antes, en el mismo lote.
   (i) Como siempre en la caja, la prueba usa los datos reales: esa venta queda registrada como anulada.
2. **Producción:** sube `index.html` a la raíz de `fen-ventas` y recarga los equipos de caja.

## Pruebas automáticas
3 nuevas (21 en total para la caja v2.1): los lotes descontados se anotan y vuelven a esos mismos lotes; se devuelve en la sucursal de la venta; en una venta antigua se devuelve lo seguro y se avisa el resto.
