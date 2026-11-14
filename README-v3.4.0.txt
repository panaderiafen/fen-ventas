Caja Fën v3.4.0 · 13 nov 2026 · con CierreCaja.gs v1.0.0

Qué cambia: correo con el detalle de cada cierre de caja (boceto aprobado el 13 nov)
- Cada vez que se cierra una caja llega un correo a la administración con:
  · medios de pago: sistema, contado y diferencia (efectivo, débito, crédito, transferencia y total); la fila con
    descuadre en rojo;
  · si hay descuadre, un aviso arriba que dice en qué medio, con el motivo y la nota de la cajera; y el asunto parte con
    "Descuadre − $X";
  · efectivo del turno: fondo inicial, ventas en efectivo, ingresos y retiros, debería haber, contado, fondo que queda
    y retiro al sobre;
  · productos vendidos por área (Panadería, Bollería, Pastelería, Cafetería, Reventa), con cantidad, monto y el
    subtotal del área; en el café, cuántos con cada leche;
  · anulaciones pendientes.
- Reemplaza al aviso que llegaba solo con descuadre (ya no llegan dos).

Instalación (en este orden)
1. Apps Script de caja/merma/anulaciones (el proyecto cuya URL termina en ...fddv1A/exec):
   a. script.google.com → abra ese proyecto.
   b. Archivos → "+" → Secuencia de comandos → nómbrelo CierreCaja → borre lo que trae y pegue el contenido de
      apps-script/CierreCaja.gs → Guardar.
   c. Abra Code.gs, busque "function ejecutarAccionLegada(payload) {" y justo después de la línea "try {" agregue:
          if (payload.tipo === 'cierre_caja') return notificarCierreCaja(payload);
      → Guardar.
   d. Prueba: arriba elija la función testNotificarCierreCaja → Ejecutar. La primera vez pide autorizar el envío de
      correos: acepte. Le llega un correo de ejemplo "Descuadre − $5.000 · Cierre Barros Arana…" (datos ficticios).
   e. Implementar → Gestionar implementaciones → lápiz → Versión: "Nueva versión" → Implementar. (La URL no cambia.)
2. Caja: suba index.html y caja.js al repositorio fen-ventas (reemplazar) como siempre.
3. En las tablets de la caja, recargue: debe decir Caja v3.4.0.

Si se instala la caja antes del paso 1, el correo no llega (el cierre funciona igual).

Revisión rápida
[ ] Paso 1d: llegó el correo de ejemplo.
[ ] Al primer cierre real llega "Cierre <sucursal> · <fecha> · $<total>" con los productos.
