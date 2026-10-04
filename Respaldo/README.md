# fën caja · v2.1.0

**Caja (index.html):** v2.1.0 · **Apps Script caja/merma:** v2.1.0 · **Apps Script ventas mensuales:** sin cambios (v2.0.0) · **Reglas de Firestore:** v1.1.0 · 4 de octubre de 2026

Esta versión arregla tres cosas que aparecieron en el uso diario y prepara la caja para Sistema Fën.

## Qué cambia

| Antes (v2.0) | Ahora (v2.1) |
| --- | --- |
| Si el cierre no llegaba a la planilla, salía un aviso y solo se reintentaba a medianoche si la caja seguía abierta ese día | La caja reintenta 3 veces al cerrar. Si igual falla, el cierre queda **pendiente** y se reenvía solo la próxima vez que alguien abra la caja |
| No había forma de reenviar un cierre | **Reportes → 💵 Eval. caja → 📤 Cierres sin pasar a planilla**, con botón **Reenviar** (o **Reenviar todas**). Muestra los últimos 60 días, también los que fallaron antes de esta versión |
| Reenviar podía duplicar filas, y un error del script quedaba "recordado" 6 horas | El script revisa el ID de la caja en "Cajas" (y las ventas ya escritas): si el cierre ya está, no escribe nada. Solo recuerda los envíos exitosos, así un reintento después de un error sí se ejecuta |
| Una caja de ayer sin cerrar desaparecía de la pantalla de venta después de medianoche | En la pantalla de caja aparece **⚠️ Caja anterior sin cerrar**, con el botón para cerrarla con arqueo |
| El correo de descuadre decía la fecha de hoy | Dice la fecha de la caja |
| Merma, evaluaciones y solicitudes traían toda la historia en cada consulta | Traen los últimos 60 días (las solicitudes pendientes, siempre), con un aviso de desde qué fecha. Abajo hay un botón **Ver historial completo** |
| — | Cada cierre guarda un **resumen** por producto, área y medio de pago (colección `resumenes_caja`). Es lo que después leerán Sistema Fën y los informes, sin exportar a mano |

(i) Si se anula una venta de una caja ya cerrada, su resumen se rehace solo.

## Archivos y dónde va cada uno

```
firestore.rules           reglas v1.1.0 (agrega resumenes_caja)  → consola de Firebase → Firestore Database → Reglas
webhook-caja/Code.gs      script caja/merma v2.1.0               → Apps Script del proyecto …fddv1A (reemplaza el archivo principal, el que pegaste en la v2.0)
webhook-caja/Seguridad.gs v2.1.0 (solo recuerda envíos exitosos)  → mismo proyecto, reemplaza el archivo Seguridad
index.html                la caja v2.1.0                          → GitHub, raíz del repo fen-ventas
README.md                 este archivo                            → GitHub (respaldo)
```

El script de ventas mensuales (`…WsukrNQ`) **no cambia**: no hay que tocarlo.

## Instalación (en este orden)

### 1. Reglas de Firestore (2 minutos, sin riesgo)
1. Consola de Firebase → **fen-ventas** → **Firestore Database** → pestaña **Reglas**.
2. Borra todo y pega el contenido de `firestore.rules` → **Publicar**.
3. (i) Es lo mismo que ya tenías más un bloque nuevo para `resumenes_caja`. Si la caja v2.1 se instalara sin este paso, todo funcionaría igual, pero los resúmenes no se guardarían.

### 2. Script caja/merma
1. En el proyecto de caja/merma (`…fddv1A`), reemplaza el contenido del archivo principal por `webhook-caja/Code.gs`, y el de `Seguridad` por `webhook-caja/Seguridad.gs`. Guarda.
2. **Prueba:** Implementar → Gestionar implementaciones → la implementación **de prueba** (la que creaste el 3-oct, `…kOZsp2yCA`) → ✏️ → Nueva versión → Implementar.
3. Abre la URL de prueba con `?action=ping`: debe decir `"version":"2.1.0"`.

### 3. Caja de prueba
1. Sube la carpeta `prueba` del zip `prueba-caja-v2.1.zip` al repo `fen-ventas` (reemplaza la anterior). Ya trae tus URLs de prueba.
2. Abre `…/fen-ventas/prueba/` con tu cuenta admin y revisa la lista de verificación. Recuerda: la caja de prueba escribe en las planillas reales; no hagas cierres ni merma ahí.

### 4. Producción
1. Implementar → Gestionar implementaciones → la de **siempre** (`…fddv1A`) → ✏️ → Nueva versión → Implementar. Ping: `"version":"2.1.0"`.
2. Sube `index.html` a la raíz del repo `fen-ventas`. Recarga los equipos de caja (en Fully Kiosk, borra el caché si sigue la versión anterior).
3. Al cierre del día, revisa que el cierre llegue a "Barros Arana" y "Cajas" como siempre.

## Lista de verificación (en la caja de prueba)
- [ ] **Reportes → 💵 Eval. caja**: carga como siempre. Si hay cierres de los últimos 60 días que no llegaron a la planilla, aparece la tarjeta roja **📤 Cierres sin pasar a planilla**. Si aparece, toca **Reenviar** en uno y revisa que llegue a "Cajas" una sola vez.
- [ ] **🧾 Resúmenes de caja**: elige septiembre 2026 → **Generar resúmenes faltantes**. Debe terminar con "Listo: N resúmenes nuevos". (Lee las ventas de septiembre una vez; no hace falta repetirlo.)
- [ ] **Merma**, **Eval. caja** y **Solicitudes** muestran los últimos 60 días, y el botón **Ver historial completo** trae todo.
- [ ] En la consola de Firebase → Firestore → Datos aparece la colección `resumenes_caja`.

## Si algo sale mal
- **El cierre no llega o la caja muestra error:** en Gestionar implementaciones vuelve la de siempre a la versión anterior, y en GitHub restaura el `index.html` anterior desde el historial. Los cierres quedan guardados en Firestore y se pueden reenviar después.
- **"Missing or insufficient permissions" al generar resúmenes:** falta publicar las reglas v1.1.0 (paso 1).

## Pruebas automáticas
- **Script (9 pruebas):** las 5 de la v2.0, más: un cierre ya escrito no se repite aunque lo reenvíe otra persona (otra caja sí se escribe); si un intento falla, el reintento con la misma clave se vuelve a ejecutar; si las ventas alcanzaron a escribirse pero no la fila de "Cajas", el reintento no las duplica; el ping informa 2.1.0.
- **Caja (9 pruebas, Firestore simulado):** el resumen sale sin ventas anuladas y con pago dividido bien repartido; 3 reintentos y queda pendiente si todo falla; al segundo intento funciona; sin sesión no insiste; "ya existía" cuenta como enviado; una caja sin ventas no queda pendiente; al abrir se reenvían solo cajas cerradas pendientes; historial de 60 días por sucursal; fecha del aviso de descuadre.

**Lo que no pude probar aquí:** la caja real con Firebase de verdad. Por eso el paso 3 con la caja de prueba.

## Pendiente para más adelante (etapa 4 / Sistema Fën)
- Que los informes del mes lean los resúmenes en vez de cada venta (hoy siguen igual; los resúmenes ya quedan guardados).
- Escuchar cambios de stock en vez de releerlo completo, y memoria local de Firestore (venta sin internet).
- Al anular una venta, el stock se devuelve a un campo del formato antiguo de stock: revisar cómo debe volver al lote correcto.
