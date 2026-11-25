# Perspectiva — puntos de fuga con la cámara del móvil

Web app para la asignatura *Laboratorio de geometría y forma* (expresión gráfica arquitectónica). El alumno apunta el móvil a un edificio, una calle o un interior y ve sobre la imagen real:

- las **familias de líneas** paralelas, cada una con su color;
- sus **puntos de fuga**, o una flecha en el borde con la distancia en anchos de imagen cuando caen fuera;
- la **línea del horizonte** de la escena y, con sensores, el **horizonte esperado** según la inclinación del móvil;
- un aviso de si la cámara está inclinada y, por tanto, **las verticales convergen**.

No hay instalación, cuentas, servidor ni analítica. **Todo se procesa en el móvil: ninguna imagen sale del dispositivo.**

## Uso

| Botón | Qué hace |
|---|---|
| **Congelar** | Fija el fotograma y lo analiza con más calidad. Después se pueden **arrastrar los puntos de fuga y el horizonte** para explorar el encaje. |
| **Reanudar** / **Cámara** | Vuelve a la cámara en vivo. |
| **Foto** | Analiza una foto de la galería. Usa la focal EXIF si la foto la trae. |
| **Exportar** | Guarda un PNG con la superposición y un JSON con el registro, usando la hoja de compartir del móvil o una descarga. |
| **Ajustes** | Modo A/B, rejilla, líneas sueltas, análisis en vivo, focal y sensores. |

### Modos (las dos condiciones del estudio)

- **A · Solo muestra**: guías de perspectiva, sin cifras de error.
- **B · Muestra + desviación**: además, tocando una línea en la imagen congelada se ve su desviación en grados respecto a su punto de fuga, con un resumen de la desviación media por familia.

El profesor puede **fijar el modo por enlace**, y entonces el alumno no lo puede cambiar:

```
https://…/perspectiva/?modo=A
https://…/perspectiva/?modo=B
```

Cada exportación registra el modo activo.

## Desplegar en GitHub Pages

La cámara y los sensores **solo funcionan en HTTPS**. GitHub Pages lo da gratis.

1. En este repositorio: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save*.
2. En un minuto estará en **https://fernandoalonsop.github.io/Perspectiva/**. Ese es el enlace (o código QR) para los alumnos.
3. Al publicar una versión nueva, cambiar `CACHE` en `sw.js` y `VERSION` en `js/config.js`.

Todas las rutas son relativas, así que funciona en cualquier subcarpeta.

## Probar

**En el ordenador**, sin móvil:

```bash
python3 -m http.server 8000     # y abrir http://localhost:8000
```

`localhost` cuenta como seguro: funciona la webcam y el botón «Foto». No hay sensores de inclinación.

**En el móvil**: hace falta HTTPS (GitHub Pages). Un servidor local abierto por IP desde el móvil **no** permite usar la cámara.

**Pruebas automáticas** (requieren Node y Playwright):

```bash
node test/ejecutar.mjs   # banco de escenas sintéticas con geometría conocida → error en grados
node test/e2e.mjs        # recorre la app completa con una cámara falsa → capturas en test/salida/
```

### Resultado del banco (v0.1.0)

Hay 9 escenas sintéticas: cubo en 1 punto; cubo en 2 puntos a 26 mm y a 16 mm; pasillo; calle; fachada vista desde abajo; calle con teleobjetivo de 50 mm; edificio con vegetación delante; y vegetación sin arquitectura. Cada una se analiza en calidad vivo y alta, con y sin sensor: **34/34 superadas**.

- Criterio: al menos 2 direcciones con error < 2° y horizonte con error < 2°.
- Errores típicos: **0,02°–0,6°**.
- La escena sin arquitectura responde «No se detectan líneas fiables».
- La focal se estima de la escena (16,0 mm en el gran angular, sin decírselo).
- Tiempo en un ordenador: 15–65 ms en vivo y 60–115 ms en alta calidad.

**Las escenas sintéticas son más limpias que la realidad.** El criterio de éxito real (fotos de interior y calle, < 2 s en un móvil de gama media) está **pendiente de verificar con fotos reales y móviles reales**.

## Cómo funciona

```
cámara/foto → copia reducida en grises → [Web Worker]
   1. segmentos rectos         (js/vision/segmentos.js — tipo LSD)
   2. puntos de fuga (RANSAC)  (js/vision/fuga.js)
   3. focal, clasificación y horizonte (js/vision/manhattan.js)
→ suavizado entre fotogramas (js/seguimiento.js) → dibujo (js/overlay.js)
```

1. **Segmentos.** Se calcula en cada píxel hacia dónde cambia la luz (gradiente). Los píxeles vecinos con la misma orientación se agrupan, y si el grupo forma un rectángulo largo, estrecho y denso es un segmento. Es una versión simplificada de LSD (von Gioi et al., 2010).
2. **Puntos de fuga.** Se cortan dos segmentos al azar y se cuenta cuántos otros "apuntan" a ese corte, con un margen de 2°. Tras repetirlo cientos de veces gana el más votado (RANSAC; Fischler y Bolles, 1981). Se retiran sus segmentos y se busca el siguiente punto, hasta tres. El voto se mide en grados, no en píxeles, para que funcione con puntos lejanos o en el infinito (rectas paralelas).
3. **Estructura.** Si dos puntos de fuga corresponden a direcciones perpendiculares (mundo Manhattan; Coughlan y Yuille, 1999), su posición da la focal: `f² = −(v₁ − c)·(v₂ − c)`. Con la focal, cada punto es una dirección 3D y se puede decir cuál es vertical, cuáles horizontales y dónde cae el horizonte.

Todos los umbrales están en **`js/config.js`**, comentados. Cada JSON exportado guarda una copia de ellos.

### Registro exportado (JSON)

Contiene: fecha, versión, modo, origen (cámara o foto), tamaño de imagen, focal y su fuente, inclinación del móvil, puntos de fuga (posición, tipo, dirección 3D, número de líneas, desviación media, si se movieron a mano), horizonte, desviación de cada segmento y todos los parámetros. **No contiene la imagen ni datos personales.**

## Limitaciones conocidas

- **Focal en vivo.** El navegador no informa de la lente; el vídeo puede venir recortado respecto al sensor. Si la escena no tiene dos direcciones horizontales perpendiculares visibles, se usan 26 mm y el horizonte puede desviarse algo. Se puede fijar a mano en Ajustes.
- **Gran angular / distorsión.** Algunos Android abren la lente gran angular, que curva las rectas cerca de los bordes. No se corrige en v1.
- **Rendimiento.** Sin medir aún en móviles. El análisis vivo se hace a 640 px; si va lento, bajar `ladoAnalisisVivo` a 480 en `js/config.js`. El banco muestra que a 480 px se pierden familias débiles, como el gran angular o el teleobjetivo. Congelar siempre analiza a 1024 px.
- **Sensores.** En iPhone exigen permiso dentro de un toque; si se deniegan, la app funciona igual sin el horizonte del sensor. El cálculo del giro de pantalla (apaisado) está **sin verificar en dispositivo**.
- **Arquitectura no ortogonal** (cubiertas inclinadas, plantas oblicuas): sus líneas se detectan como familia "inclinada" (naranja), pero pueden confundir la estimación de la focal.
- **Detección de "sin estructura"**: la primera familia debe explicar ≥ 25 % de la longitud de todas las líneas rectas. Con mucha vegetación y poca arquitectura, puede no mostrar nada. Es preferible a inventar.
- Fuera de alcance en v1: revisión de bocetos en papel, 3D, realidad aumentada y gamificación.

## Estructura de archivos

```
index.html, css/app.css, manifest.webmanifest, sw.js, icono*.{svg,png}
js/config.js          parámetros
js/main.js            estado, interfaz, bucle de dibujo
js/camara.js          getUserMedia y errores
js/sensores.js        DeviceOrientation → "arriba" en coordenadas de cámara
js/overlay.js         dibujo de familias, puntos de fuga, horizonte y rejilla
js/interaccion.js     arrastrar puntos/horizonte, tocar líneas
js/edicion.js         recalcular desviaciones, guías manuales
js/seguimiento.js     suavizado en vivo
js/exportar.js        PNG + JSON
js/exif.js            focal EXIF de fotos JPEG
js/vision/*.js        análisis (sin dependencias del navegador salvo preparar.js)
test/                 escenas sintéticas, banco y prueba de la app completa
```

Son unas 2.200 líneas, sin dependencias externas ni paso de compilación. Pesa unos 150 KB en total. OpenCV.js pesaría unos 8–10 MB.

## Registro de decisiones técnicas

Este desarrollo forma parte de una investigación sobre co-autoría con agentes de IA. Se anotan las decisiones con su motivo y quién las tomó.

| Fecha | Decisión | Motivo | Quién |
|---|---|---|---|
| 2026-11-25 | Web app estática (HTML + JS), alojada en GitHub Pages | Sin instalación ni tiendas; HTTPS gratuito; un enlace o QR para la clase | Propuesta del agente, aceptada por el profesor |
| 2026-11-25 | Solo modo "escena real" en v1 | Es lo que necesita la asignatura; la revisión de bocetos es mucho más difícil y no llegaba a 2026 | Profesor |
| 2026-11-25 | Modos A (muestra) / B (muestra + desviación), con modo fijable por URL | La pregunta "¿corrige o muestra?" se convierte en variable experimental del estudio | Propuesta del agente; la decisión pedagógica sigue abierta |
| 2026-11-25 | Desarrollar en `app-perspectiva/` dentro del repositorio de investigación y mover después a este repositorio público | Rapidez; Pages exige un repositorio propio | Profesor |
| 2026-11-25 | Detector de segmentos propio (tipo LSD) en lugar de OpenCV.js | ~25 KB frente a ~8–10 MB; LSD no está garantizado en la build estándar de OpenCV.js; código legible para clase y artículo. Plan B: OpenCV.js solo al congelar | Agente (el profesor no objetó) |
| 2026-11-25 | Voto RANSAC en grados, no en píxeles | Puntos lejanos y en el infinito se tratan igual | Agente (indicado en el encargo) |
| 2026-11-25 | Criterio anti-invención: la 1.ª familia debe sumar ≥ 25 % de la longitud de las líneas | En la escena de vegetación, longitud y nº de rectas no separaban casos reales de casuales; la proporción sí (≥ 35 % frente a ≤ 13 %) | Agente, tras medirlo en el banco |
| 2026-11-25 | Análisis vivo a 640 px (no 480) | A 480 px fallaban 4/34 pruebas (familias débiles); a 640 px, 34/34, con el doble de coste. Revisar al medir en móviles | Agente, tras medirlo en el banco |
| 2026-11-25 | Imagen completa sin recortar (bandas negras) en lugar de pantalla completa recortada | Los puntos de fuga suelen caer fuera de la foto; recortar esconde aristas útiles | Agente |
| 2026-11-25 | Focal EXIF para fotos de galería | Es la focal real; mejora el horizonte cuando hay un solo punto de fuga | Agente |
| 2026-11-25 | Sin cámara simulada en móvil: queda pendiente probar en iPhone y Android reales | No se puede verificar desde el entorno de desarrollo | — |

## Referencias técnicas

Por verificar antes de citarlas en un artículo:

- von Gioi, R. G., Jakubowicz, J., Morel, J.-M., Randall, G. (2010). LSD: A Fast Line Segment Detector with a False Detection Control. *IEEE TPAMI*, 32(4).
- Fischler, M. A., Bolles, R. C. (1981). Random Sample Consensus. *Communications of the ACM*, 24(6).
- Coughlan, J. M., Yuille, A. L. (1999). Manhattan World. *ICCV*.
