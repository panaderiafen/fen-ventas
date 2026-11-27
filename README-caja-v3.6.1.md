# Caja v3.6.1 — Impresión por Bluetooth más firme y "Sin stock" por área

**Dónde va:**
1. Este zip → repo **fen-ventas** en GitHub (Add file → Upload files, Commit).
2. El archivo aparte **CierreCaja.gs v1.2.0** → se pega en **Apps Script** (el proyecto del correo de cierre): reemplazar todo el código, Guardar, y **Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva → Implementar**.

## Qué cambia
- **Etiqueta del sobre (tablet de Ainavillo):** la impresora se usa con más cuidado:
  - Manda los datos con confirmación cuando la impresora la ofrece, para que no se pierda ningún trozo (si se perdía uno, la impresora quedaba trabada y había que apagarla).
  - Manda menos datos (sin las partes en blanco), así imprime más rápido.
  - **Suelta la impresora al terminar**, así logística (u otro equipo) se puede conectar después sin apagarla.
- **Correo del cierre:** "Sin stock" viene **agrupado por área** (Panadería, Bollería, Pastelería, Reventa).

## Revisar después de subir
- [ ] La pantalla de entrada dice **Caja v3.6.1**.
- [ ] Imprimir el sobre en la tablet de Ainavillo y después imprimir desde logística, sin apagar la impresora.
- [ ] En el próximo cierre, el correo trae "Sin stock" por área.
