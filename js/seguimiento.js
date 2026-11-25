// =============================================================================
// seguimiento.js — estabilidad en modo vivo.
//
// Cada análisis (≈ 5 por segundo) da puntos de fuga ligeramente distintos. Para
// que las guías no "tiemblen", emparejamos cada familia con la del análisis
// anterior (si su dirección 3D se parece) y promediamos con un filtro
// exponencial. Una familia nueva solo se dibuja tras verse varias veces, y una
// que desaparece se mantiene unos instantes antes de borrarse.
// =============================================================================

import { CONFIG } from './config.js';
import { normalizar, punto3, aImagen, anguloDirecciones, rectaDesdeNormal } from './vision/geometria.js';
import { imagenAEsfera } from './vision/manhattan.js';
import { recalcularResiduales } from './edicion.js';

function mezclar(viejo, nuevo, a) {
  const s = punto3(viejo, nuevo) < 0 ? -1 : 1;
  return normalizar([0, 1, 2].map((i) => (1 - a) * viejo[i] + a * s * nuevo[i]));
}

export class Seguidor {
  constructor(cfg = CONFIG) { this.cfg = cfg; this.reiniciar(); }

  reiniciar() {
    this.pistas = [];
    this.f = null;
    this.normalHorizonte = null;
    this.perdidoHorizonte = 0;
    this.tam = null;
    this.siguienteId = 1;
  }

  /** Recibe un resultado de análisis y devuelve un resultado suavizado para dibujar. */
  actualizar(r) {
    const cfg = this.cfg, a = cfg.suavizado;
    const tam = `${Math.round(r.ancho)}x${Math.round(r.alto)}`;
    if (tam !== this.tam) { this.reiniciar(); this.tam = tam; } // giro de pantalla, otra cámara…

    this.f = this.f == null ? r.cam.f : (1 - a) * this.f + a * r.cam.f;
    const cam = { f: this.f, cx: r.cam.cx, cy: r.cam.cy };

    // 1. Emparejar familias nuevas con pistas existentes
    const usadas = new Set();
    const asignacion = r.familias.map((fam) => {
      const v = imagenAEsfera(fam.punto, cam);
      let mejor = null, mejorAng = cfg.emparejamientoGrados;
      for (const p of this.pistas) {
        if (usadas.has(p)) continue;
        const ang = anguloDirecciones(p.v, v);
        if (ang < mejorAng) { mejorAng = ang; mejor = p; }
      }
      if (mejor) {
        usadas.add(mejor);
        mejor.v = mezclar(mejor.v, v, a);
        mejor.vistos++;
        mejor.perdidos = 0;
        mejor.tipo = fam.tipo;
        mejor.guiada = fam.guiada;
        mejor.pendiente = fam.pendiente;
        mejor.puntoPlanta = fam.puntoPlanta;
        return mejor;
      }
      const nueva = { id: this.siguienteId++, v, tipo: fam.tipo, guiada: fam.guiada, pendiente: fam.pendiente, puntoPlanta: fam.puntoPlanta, vistos: 1, perdidos: 0 };
      this.pistas.push(nueva);
      usadas.add(nueva);
      return nueva;
    });
    for (const p of this.pistas) if (!usadas.has(p)) p.perdidos++;
    this.pistas = this.pistas.filter((p) => p.perdidos <= cfg.fotogramasParaOlvidar);

    // 2. Pistas que se muestran
    const visibles = this.pistas.filter((p) => p.vistos >= cfg.fotogramasParaMostrar);
    const familias = visibles.map((p) => ({ id: p.id, v: p.v, punto: aImagen(p.v, cam), tipo: p.tipo, guiada: p.guiada, pendiente: p.pendiente, puntoPlanta: p.puntoPlanta, nSegmentos: 0, residualMedio: 0 }));
    const familiaSeg = new Int8Array(r.familiaSeg.length).fill(-1);
    for (let i = 0; i < r.familiaSeg.length; i++) {
      const k = r.familiaSeg[i];
      if (k < 0) continue;
      const idx = visibles.indexOf(asignacion[k]);
      if (idx >= 0) familiaSeg[i] = idx;
    }

    // 3. Horizonte suavizado
    let horizonte = null;
    if (r.horizonte) {
      const [la, lb, lc] = r.horizonte.linea;
      const N = normalizar([la * cam.f, lb * cam.f, la * cam.cx + lb * cam.cy + lc]);
      this.normalHorizonte = this.normalHorizonte ? mezclar(this.normalHorizonte, N, a) : N;
      this.perdidoHorizonte = 0;
      this.fuenteHorizonte = r.horizonte.fuente;
    } else if (this.normalHorizonte && ++this.perdidoHorizonte > cfg.fotogramasParaOlvidar) {
      this.normalHorizonte = null;
    }
    if (this.normalHorizonte && familias.length) {
      horizonte = { linea: rectaDesdeNormal(this.normalHorizonte, cam), normal: this.normalHorizonte, fuente: this.fuenteHorizonte };
    }

    const salida = {
      ...r,
      cam,
      familias,
      familiaSeg,
      residualSeg: new Float32Array(r.familiaSeg.length),
      horizonte,
      fiable: familias.length > 0,
      mensaje: familias.length ? r.mensaje : (r.fiable ? 'Buscando…' : r.mensaje),
    };
    recalcularResiduales(salida);
    return salida;
  }
}
