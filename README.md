# Perspectiva — puntos de fuga con la cámara del móvil

**Universidad de Navarra · Laboratorio de Geometría y Forma**

© 2026 Carlos Naya y Fernando Alonso, profesores de la Universidad de Navarra. Todos los derechos reservados.
Desarrollada con la asistencia de Claude Opus 5.5 (Anthropic). El diseño docente, las decisiones y la revisión son de los autores.

Web app para la asignatura *Laboratorio de geometría y forma* (expresión gráfica arquitectónica). El alumno apunta el móvil a un edificio, una calle o un interior y ve sobre la imagen real:

- unas pocas **líneas de fuga** por familia (las más largas y bien repartidas), trazadas desde su punto de fuga hasta el borde de la imagen;
- sus **puntos de fuga**, o una flecha en el borde con la distancia en anchos de imagen cuando caen fuera;
- la **línea del horizonte** de la escena y, con sensores, el **horizonte esperado** según la inclinación del móvil;
- un aviso de si la cámara está inclinada y, por tanto, **las verticales convergen**.

No hay instalación, cuentas, servidor ni analítica. **Todo se procesa en el móvil: ninguna imagen sale del dispositivo.**

## Uso

| Botón | Qué hace |
|---|---|
| **Congelar** | Fija el fotograma y lo analiza con más calidad. Después se pueden **arrastrar los puntos de fuga y el horizonte** para explorar el encaje, **pellizcar para alejar** (o rueda del ratón) y arrastrar para mover la vista. |
| **Ver fugas** | Con la imagen congelada, encuadra la foto y sus puntos de fuga: se ve cómo las líneas continúan fuera de la foto hasta encontrarse. |
| **Reanudar** / **Cámara** | Vuelve a la cámara en vivo. |
| **Foto** | Analiza una foto de la galería. Usa la focal EXIF si la foto la trae. |
| **Exportar** | Guarda **una imagen con lo que se ve en pantalla** (con el zoom y el encuadre actuales) y la **foto original sin líneas**. Opcional, en Ajustes: el registro JSON. |
| **Ajustes** | Modo A/B, capas (todas las aristas, rejilla), análisis en vivo, focal y sensores. |

### Qué se dibuja (jerarquía visual)

1. **Horizonte** (amarillo), el calculado a partir de la imagen. El del sensor solo aparece si no hay horizonte en la imagen, o si se activa «Comparar con el horizonte del sensor».
2. **Puntos de fuga**: un círculo si caen en la pantalla y una flecha con la distancia si caen fuera.
3. **Líneas de fuga**: como máximo 5 por familia horizontal. Cada una sale del punto de fuga, pasa por una arista real (resaltada) y llega al borde de la imagen. Son **afiladas**: gruesas cerca del observador, finas y transparentes al llegar al punto de fuga. Se prefieren aristas largas y alejadas del punto de fuga, porque las cercanas apenas lo confirman.
4. **Verticales**: solo si convergen de forma visible (móvil inclinado). Con el móvil a plomo son paralelas y no se dibujan.
5. Opcional, en Ajustes → Capas: todas las aristas detectadas, la rejilla y la comparación con el sensor.

Las etiquetas se recolocan para no pisarse.

### Móvil en horizontal

Con el bloqueo de rotación del iPhone, la pantalla no gira. La app usa la **gravedad** para saber cómo sostienes el móvil:
- textos, etiquetas y guías se dibujan derechos;
- la foto congelada y la exportada se guardan con la escena derecha;
- los botones no giran, como en la app Cámara.

Se puede desactivar en Ajustes.

### Autocomprobación

En Ajustes, al final, cada análisis muestra dos controles independientes:
- el ángulo entre el horizonte de la imagen y el de la gravedad;
- cuánto se apartan de 90° la vertical y las horizontales detectadas.

Ninguno interviene en el cálculo. Por debajo de 2° el resultado se marca «coherente», hasta 5° «aceptable» y por encima «dudoso». En el banco sintético ambos valen 0,0–0,14°. También se guardan en el JSON.

### Modos (las dos condiciones del estudio)

- **A · Solo muestra**: guías de perspectiva, sin cifras de error.
- **B · Muestra + desviación**: además, tocando una línea en la imagen congelada se ve su desviación en grados respecto a su punto de fuga, con un resumen de la desviación media por familia.

El profesor puede **fijar el modo por enlace**, y entonces el alumno no lo puede cambiar:

```
https://…/perspectiva/?modo=A
https://…/perspectiva/?modo=B
```

Cada registro JSON guarda el modo activo. Para el estudio, añadir `registro=1` al enlace hace que cada exportación incluya el JSON sin que el alumno tenga que activarlo:

```
https://…/Perspectiva/?modo=A&registro=1
```

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
node test/e2e.mjs salon vertical   # lo mismo con otra escena y en vertical
```

### Resultado del banco (v0.4.0)

Hay 10 escenas sintéticas: cubo en 1 punto; cubo en 2 puntos a 26 mm y a 16 mm; pasillo; calle; fachada vista desde abajo; calle con teleobjetivo de 50 mm; edificio con vegetación delante; salón casi frontal de poco contraste; y vegetación sin arquitectura. Cada una se analiza en calidad vivo y alta, con y sin sensor: **38/38 superadas**.

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
3. **Tercera dirección guiada.** En arquitectura ortogonal, si se conocen la vertical (por las líneas o por el sensor) y una horizontal, la otra horizontal es perpendicular a ambas. Esa familia (en un interior, la de profundidad) suele tener pocas líneas. Se busca solo en un cono de 20° alrededor de la dirección prevista, y por eso basta con menos evidencia (3 líneas, 2 rectas distintas) sin riesgo de inventar.
4. **Estructura.** Si dos puntos de fuga corresponden a direcciones perpendiculares (mundo Manhattan; Coughlan y Yuille, 1999), su posición da la focal: `f² = −(v₁ − c)·(v₂ − c)`. Con la focal, cada punto es una dirección 3D y se puede decir cuál es vertical, cuáles horizontales y dónde cae el horizonte.

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

## Autoría y créditos

- **Autores:** Carlos Naya y Fernando Alonso, profesores de la Universidad de Navarra.
- **Contexto:** asignatura *Laboratorio de Geometría y Forma* (expresión gráfica arquitectónica).
- **Desarrollo asistido por IA:** el código se escribió con la asistencia de Claude Opus 5.5 (Anthropic), a partir de los encargos, las pruebas en el aula y las correcciones de los autores. El registro de decisiones de abajo documenta ese proceso.
- **Logotipo:** la pantalla de inicio muestra el logotipo oficial si existe `img/logo-unav.svg` (o `.png`); si no, el texto «Universidad de Navarra». Hay que usar el archivo oficial en negativo (blanco), según las normas de identidad corporativa (ver `img/LEEME.md`). En el resto de la app la marca aparece como texto: rótulo discreto, pie de las imágenes exportadas, «Acerca de» y JSON.

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
| 2026-11-25 | v0.2.0 · Jerarquía visual: por defecto solo horizonte, puntos de fuga y ≤ 5 líneas de fuga por familia, del punto de fuga al borde de la imagen; aristas y rejilla pasan a capas opcionales | Primera prueba real en iPhone: «no se ven las líneas de fuga, que es lo más importante; son muchas líneas y confunde» | Profesor (diagnóstico), agente (diseño) |
| 2026-11-25 | v0.2.0 · No dibujar verticales paralelas | Con el móvil a plomo no convergen; en la prueba real llenaban la imagen de rayas discontinuas | Agente, a partir de las capturas |
| 2026-11-25 | v0.2.0 · Búsqueda guiada de la tercera dirección | En la prueba real (interior frontal) no aparecía la familia de profundidad, la más didáctica. Sin las fotos originales no se ha podido confirmar que esta sea la causa | Agente |
| 2026-11-25 | v0.2.0 · Un solo horizonte si escena y sensor coinciden; un solo mensaje abajo | Dos líneas y dos etiquetas casi superpuestas; mensajes solapados | Agente, a partir de las capturas |
| 2026-11-25 | v0.3.0 · Líneas de fuga afiladas hacia el punto de fuga | Propuesta del profesor tras la 2.ª prueba real: refuerza la lectura de profundidad | Profesor |
| 2026-11-25 | v0.3.0 · Giro por gravedad (también con bloqueo de rotación) | Fotos en horizontal salían de lado; el profesor pidió «la app debería girar» | Profesor (petición), agente (solución) |
| 2026-11-25 | v0.3.0 · Aristas ambiguas a la familia con la que mejor encajan; las compatibles con la vertical del sensor salen de las horizontales | En una prueba real, una vertical que cruzaba el punto de fuga central se dibujaba como línea de fuga | Agente, a partir de las capturas |
| 2026-11-25 | v0.3.0 · Horizonte del sensor oculto por defecto | Discrepaba 30–50 px del de la imagen (depende de la focal) y dos horizontes confunden al alumno | Agente |
| 2026-11-25 | v0.3.0 · Autocomprobación geométrica y exportación de la foto original | El profesor no sabía «hasta qué punto está haciendo bien el análisis»; la foto limpia permite reanalizar y afinar | Agente |
| 2026-11-25 | v0.4.0 · Zoom y desplazamiento en la imagen congelada; botón «Ver fugas»; exportación de la vista ampliada | Petición del profesor tras la 3.ª prueba real: «ver la continuidad de las líneas hasta dónde van las fugas» | Profesor (petición), agente (solución) |
| 2026-11-25 | v0.4.0 · Marca institucional discreta y créditos (autores, Universidad de Navarra, asistencia de IA) | Petición de los autores; reconocer la asistencia de IA es coherente con la investigación sobre co-autoría | Profesor |
| 2026-11-25 | v0.4.1 · Exportar = exactamente lo que se ve en pantalla; por defecto un solo archivo (foto original y JSON, opcionales; JSON forzable con `?registro=1`) | El profesor exportó y obtuvo el encuadre automático «foto + fugas» y tres archivos en vez de lo que veía | Profesor (diagnóstico), agente (solución) |
| 2026-11-25 | v0.4.2 · La foto sin líneas vuelve a exportarse por defecto; hueco para el logotipo oficial en el inicio | Petición del profesor. El logotipo no se ha recreado ni descargado: debe ser el archivo oficial | Profesor |
| 2026-11-25 | Sin cámara simulada en móvil: queda pendiente probar en iPhone y Android reales | No se puede verificar desde el entorno de desarrollo | — |

## Referencias técnicas

Por verificar antes de citarlas en un artículo:

- von Gioi, R. G., Jakubowicz, J., Morel, J.-M., Randall, G. (2010). LSD: A Fast Line Segment Detector with a False Detection Control. *IEEE TPAMI*, 32(4).
- Fischler, M. A., Bolles, R. C. (1981). Random Sample Consensus. *Communications of the ACM*, 24(6).
- Coughlan, J. M., Yuille, A. L. (1999). Manhattan World. *ICCV*.
