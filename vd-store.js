/*
 * vd-store.js · Estado de la demo local del mockup STRACON (validación documental con IA).
 * Expone window.VD. JavaScript ES2017, sin dependencias. Cargar después de vd-datos.js y vd-escenarios.js.
 * Contrato: docs/arquitectura-demo.md (secciones 4 y 5).
 *
 * Reglas que garantiza:
 * - La decisión final es siempre humana: los agentes y el sistema nunca dejan un caso en ok, rej ni clar; solo trabajan y notifican.
 * - Los conteos salen siempre de los view-models (nada fijo).
 * - Ningún expediente queda listo ni recibe conformidad con un documento sin contraste del Agente 2 ni validación manual.
 * - Cada acción avanza el reloj simulado 2 a 6 minutos; las decisiones (ok, reject, clar) avanzan la revisión activa
 *   (3 a 8 min) y fijan los minutos [Agente 1, Agente 2, espera, activa] de modo que decisión = ingreso + suma.
 *   El reloj parte en VD_BASE.hoy (14 oct 2026 10:30).
 * - Las simulaciones guardan su inicio en ms reales: el avance se recalcula con Date.now(), así que sobreviven a recargas.
 * - Todo acceso a localStorage va en try/catch; si falla, la demo funciona en memoria.
 */
(function () {
  'use strict';

  const BASE = window.VD_BASE;
  const ESC = window.VD_ESCENARIOS || {};
  if (!BASE) { try { console.error('vd-store.js: falta vd-datos.js (window.VD_BASE)'); } catch (e) {} return; }

  // ---------------------------------------------------------------- constantes
  const VERSION = 'demo-v1';
  const CLAVE = 'vd-demo-v1';
  const CASOS_ESC = ESC.casos || {};
  const PATRONES = (ESC.patronesEvaluacion && ESC.patronesEvaluacion.length) ? ESC.patronesEvaluacion : ['ready'];
  const GENERICAS = ESC['señalesGenericas'] || {};
  const DOCS = BASE.documentos;
  const EMISORES = BASE.emisores;
  const SITIOS = BASE.sitios;
  const ARCHIVOS = BASE.archivos;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Duraciones reales de las simulaciones (ms) y minutos simulados que representan
  const MS = { a2: 1500, a1Reval: 1500, a1Eval: 500, a2Eval: 750, escalon: 800, tic: 500 };
  const MIN = { a1Doc: [2, 2, 2, 1], a2Doc: 3 };
  const NO_HUMANOS = ['Sistema', 'Agente 1', 'Agente 2'];
  // Estados de documento que indican que el Agente 2 ya lo contrastó
  const A2_HECHO = ['Coincide', 'Discrepancia', 'Validado manualmente'];

  const POR_ID = {};
  BASE.expedientes.forEach((x) => { POR_ID[x.id] = x; });
  const PROC = {};
  BASE.procesos.forEach((p) => { PROC[p.id] = p; });

  let nowFn = () => Date.now();

  // ---------------------------------------------------------------- utilidades
  /** Copia profunda de datos planos (JSON). */
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  /** Dos dígitos. */
  const pad = (n) => (n < 10 ? '0' : '') + n;
  /** Número o null a partir de un valor del CSV ('' → null). */
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  /** Texto sin tildes y en minúsculas, para buscar. */
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /** Convierte 'yyyy-MM-dd[ HH:mm]', 'yyyy-MM-ddTHH:mm' o '14 oct 08:02' en Date (hora local). */
  function parseFecha(s) {
    if (s instanceof Date) return s;
    if (s == null) return null;
    s = String(s);
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    m = /^(\d{1,2}) ([a-z]{3}),? (\d{1,2}):(\d{2})/.exec(s);
    if (m && MESES.indexOf(m[2]) >= 0) return new Date(2026, MESES.indexOf(m[2]), +m[1], +m[3], +m[4]);
    return null;
  }
  const BASE_MS = parseFecha(BASE.hoy).getTime();
  /** Minutos desde el reloj base (hoy 10:30) hasta una fecha; negativos = antes. */
  function aMin(f) { const d = parseFecha(f); return d ? Math.round((d.getTime() - BASE_MS) / 60000) : 0; }
  /** Date a partir de minutos relativos al reloj base. */
  const deMin = (t) => new Date(BASE_MS + t * 60000);
  /** 'yyyy-MM-dd HH:mm' a partir de minutos relativos (formato de VD_BASE). */
  function iso(t) { const d = deMin(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /** Normaliza el argumento de VD.hora / VD.fecha (Date, texto, ms o vacío = ahora). */
  function comoDate(f) {
    if (f == null || f === '') return deMin(S.reloj);
    if (f instanceof Date) return f;
    if (typeof f === 'number') return new Date(f);
    return parseFecha(f) || deMin(S.reloj);
  }
  /** 'HH:MM' de una fecha (o del reloj simulado). */
  function hora(f) { const d = comoDate(f); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /** '14 oct 10:42' de una fecha (o del reloj simulado). */
  function fecha(f) { const d = comoDate(f); return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + hora(d); }
  /** '17 oct' de una fecha. */
  function dia(f) { const d = comoDate(f); return d.getDate() + ' ' + MESES[d.getMonth()]; }
  /** '7 min', '17 h 47 min' o '—'. */
  function fmtMin(m) {
    if (m == null || isNaN(m)) return '—';
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  /** Lista legible: 'A', 'A y B', 'A, B y C'. */
  function lista(xs) { return xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }
  /** Texto con punto final si no termina en puntuación ('' si está vacío). */
  function conPunto(s) {
    const t = String(s == null ? '' : s).trim();
    return !t || /[.!?…]$/.test(t) ? t : t + '.';
  }
  /**
   * Primera letra en minúscula para continuar una frase tras dos puntos ("Documento: el sitio…").
   * Respeta siglas (MINEDUC, CEIM, N°) y nombres propios de emisores y documentos (Registro Civil, Certificado…).
   */
  function minuscula(s) {
    const t = String(s == null ? '' : s).trim();
    if (!t || /^(?:[A-ZÁÉÍÓÚÑ]{2,}|N°|Registro Civil|Certificado|Hoja de vida|Licencia de enseñanza|Sitio (?:MINEDUC|CEIM|Registro)|J\. |Revisor )/.test(t)) return t;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }
  /** 'Documento: detalle' sin mayúscula tras los dos puntos. doc = índice 0..3 o nombre; sin detalle devuelve solo el nombre. */
  function frase(doc, detalle) {
    const nombre = typeof doc === 'number' ? (DOCS[doc] || '') : String(doc == null ? '' : doc).trim();
    const d = minuscula(detalle);
    if (!d) return nombre;
    return nombre ? nombre + ': ' + d : d;
  }
  /** Nota de un documento no solicitado cuyo original (versión 1 vigente) contrastó el Agente 2. */
  const notaNoSolicitado = (doc) => 'Versión 1 vigente coincide con ' + EMISORES[doc] + '; llegó una versión 2 que no se pidió y no se revalida';
  /** Nota de un documento aprobado o validado por el revisor cuando el Agente 2 ya lo contrastó. */
  function notaContrastada(nota, doc) {
    const base = String(nota || '').replace('; pendiente de contraste', '');
    return /coincide con /i.test(base) ? base : base + '; coincide con ' + EMISORES[doc];
  }

  // ---------------------------------------------------------------- persistencia
  /** Huella de los datos base: si se regeneran, el estado guardado se descarta. */
  const huella = () => BASE.expedientes.length + '|' + BASE.hoy + '|' + BASE.expedientes.map((x) => x.id + x.estado).join(',').length;
  /** Estado vacío de la demo (reloj en 0 = hoy 10:30). */
  const vacio = () => ({ v: VERSION, huella: huella(), reloj: 0, acciones: 0, casos: {}, simulaciones: [], lote: null });
  /** Indica si un estado guardado difiere del estado inicial (reloj movido, casos tocados, simulaciones o lote). */
  const conCambios = (o) => !!(o && ((o.reloj || 0) !== 0 || (o.acciones || 0) > 0 || Object.keys(o.casos || {}).length || (o.simulaciones || []).length || o.lote));
  /** Lee el estado de localStorage; si no hay o no es compatible, parte vacío. */
  function cargar() {
    try {
      const raw = localStorage.getItem(CLAVE);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.v === VERSION && o.huella === huella() && o.casos && Array.isArray(o.simulaciones)) return o;
      }
    } catch (e) { /* sin almacenamiento: en memoria */ }
    return vacio();
  }
  /** Guarda el estado en localStorage (si se puede). */
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(S)); } catch (e) { /* en memoria */ } }
  /**
   * true si localStorage['vd-demo-v1'] guarda algo distinto del estado inicial (para mostrar "Reiniciar demo").
   * Un estado guardado incompatible (otra versión o datos regenerados) se descarta al cargar: no cuenta.
   * Sin almacenamiento disponible, mira el estado en memoria.
   */
  function hayCambios() {
    let raw = null;
    try { raw = localStorage.getItem(CLAVE); } catch (e) { return conCambios(S); }
    if (!raw) return false;
    try {
      const o = JSON.parse(raw);
      if (!o || o.v !== VERSION || o.huella !== huella()) return false;
      return conCambios(o);
    } catch (e) { return false; }
  }

  let S = cargar();

  // ---------------------------------------------------------------- reloj y usuario
  /**
   * Suma minutos al reloj simulado y devuelve el nuevo valor en minutos.
   * Sin argumento: 2 a 6 min (determinista). Con minutos: avanza exactamente eso (decisiones: la revisión activa).
   */
  function avanzarReloj(minutos) {
    S.acciones += 1;
    S.reloj += minutos != null ? minutos : 2 + ((S.acciones * 7 + 3) % 5);
    return S.reloj;
  }
  /** Minutos de revisión activa (simulado, determinista) de la próxima decisión: 3 a 8. */
  const proximaActiva = () => 3 + ((S.acciones * 5 + 2) % 6);
  /**
   * Fija los tiempos del expediente al decidir (ok, reject o clar), en el minuto t del reloj:
   * revisión activa = la de esta decisión (sumada a la de decisiones anteriores, p. ej. la aclaración) y
   * espera = el resto, de modo que fecha de decisión = ingreso + Agente 1 + Agente 2 + espera + revisión activa.
   */
  function fijarTiempos(st, id, t, activa) {
    const b = POR_ID[id];
    const a1 = num(st.min[0]) || 0, a2 = num(st.min[1]) || 0;
    let act = (num(st.min[3]) || 0) + activa;
    let espera = t - aMin(b.ingreso) - a1 - a2 - act;
    if (espera < 0) { act = Math.max(0, act + espera); espera = 0; }
    st.min[2] = espera;
    st.min[3] = act;
  }
  /** Valor crudo de localStorage['vd-user'] ('' si no hay o no se puede leer). */
  function usuarioCrudo() {
    try { return String(localStorage.getItem('vd-user') || '').trim(); } catch (e) { return ''; }
  }
  /** Usuario conectado formateado ('alejandro.salinas' → 'Alejandro Salinas'); 'Revisor' si no hay. */
  function usuario() {
    const parts = usuarioCrudo().split(/[._\s-]+/).filter(Boolean);
    return parts.length ? parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') : 'Revisor';
  }
  /**
   * Actor humano para una acción: el indicado o el usuario conectado (nunca un agente ni Sistema).
   * Si se indica el usuario en crudo ('alejandro.salinas'), devuelve el nombre formateado.
   */
  function humano(por) {
    const p = String(por || '').trim();
    if (!p || NO_HUMANOS.indexOf(p) >= 0) return usuario();
    const crudo = usuarioCrudo();
    return crudo && p.toLowerCase() === crudo.toLowerCase() ? usuario() : p;
  }

  // ---------------------------------------------------------------- estado por expediente
  const INIT = {};
  /** Estado inicial (solo lectura, en caché) de un expediente, a partir de VD_BASE y su escenario. */
  function inicial(id) { if (!INIT[id]) INIT[id] = estadoInicial(id); return INIT[id]; }
  /** Estado actual de un expediente (solo lectura). */
  function caso(id) { return S.casos[id] || inicial(id); }
  /** Estado del expediente listo para modificar (lo copia al estado de la demo la primera vez). */
  function mut(id) { if (!S.casos[id]) S.casos[id] = clone(inicial(id)); return S.casos[id]; }
  /** Reemplaza campos de un documento del expediente. */
  function marcarDoc(st, i, cambios) { st.docs[i] = Object.assign({}, st.docs[i], cambios); }
  /** Agrega un evento a la línea de tiempo (t en minutos relativos; actor: usuario, 'Agente 1', 'Agente 2' o 'Sistema'). */
  function evento(st, t, actor, ev, detalle) { st.eventos.push({ t: t, actor: actor, evento: ev, detalle: detalle || '' }); }

  /** Construye el estado inicial de un expediente. */
  function estadoInicial(id) {
    const b = POR_ID[id];
    const e = CASOS_ESC[id] || {};
    const items = clone(e.items || []);
    const st = {
      estado: b.estado,
      fase: b.estado === 'rev' ? b.fase : null,
      stopAt: e.stopAt != null ? e.stopAt : null,
      items: items,
      evidencia: clone(e.evidencia || []),
      fuenteCaida: false,
      reintento: null,
      docs: docsIniciales(b, e),
      a2hecho: b.docs.map((d) => A2_HECHO.indexOf(d) >= 0),
      senalesA1: items.filter((it) => it.level === 'Alta' || it.level === 'Media').length || (b.observacion === 'Señal Agente 1' ? 1 : 0),
      senalesAprobadas: false,
      aclaracion: null,
      ciclo: 1,
      decision: clone(b.decision),
      eventos: [],
      entradaRev: b.estado === 'rev' ? -Math.round((b.esperaH || 0) * 60) : null,
      min: b.minutos.slice(),
      resultadoAgente2: clone(e.resultadoAgente2 || null),
      resultadoUsado: false,
      respuestaFuente: clone(e.respuestaFuente != null ? e.respuestaFuente : 'coincide'),
      revalidacion: clone(e.revalidacion || null)
    };
    st.senalesAprobadas = st.senalesA1 > 0 && (b.estado === 'ok' || b.docs.indexOf('Aprobado por revisor') >= 0);
    if (st.fase === 'a2stop') {
      if (st.stopAt == null) st.stopAt = b.docs.findIndex((d) => d === 'Discrepancia' || d === 'Fuente no disponible');
      st.fuenteCaida = (items[0] && items[0].level === 'No disponible') || b.docs[st.stopAt] === 'Fuente no disponible';
    }
    if (b.estado === 'clar') st.aclaracion = aclaracionInicial(b, e, st);
    return st;
  }

  /** Estado y nota iniciales de los 4 documentos (notasDocs del escenario o derivados del CSV). */
  function docsIniciales(b, e) {
    return b.docs.map((d, i) => {
      const n = e.notasDocs && e.notasDocs[i];
      if (n) return { estado: n[0], nota: n[1], version: 1, noSolicitado: false };
      return { estado: d, nota: notaDoc(b, e, d, i), version: 1, noSolicitado: false };
    });
  }

  /** Nota por defecto de un documento según su estado en el CSV. */
  function notaDoc(b, e, d, i) {
    const it = (e.items || []).find((x) => x.doc === i);
    switch (d) {
      case 'Coincide': return 'Coincide con ' + EMISORES[i];
      case 'Sin señales': return 'Pendiente de contraste';
      case 'Señal media': case 'Señal alta': return it ? it.detail : 'Señal del Agente 1';
      case 'Discrepancia': return it ? it.detail : 'No coincide con ' + EMISORES[i];
      case 'Fuente no disponible': return 'Sitio sin respuesta; no es una inconsistencia del documento';
      case 'Pendiente': return 'El Agente 2 se detuvo antes';
      case 'Validando': return 'El Agente 2 está contrastando este documento';
      case 'Validado manualmente': return 'Validado por el revisor con QR o código de verificación';
      case 'Aprobado por revisor': return 'Señal aprobada por el revisor';
      case 'Rechazado': return b.decision ? b.decision.motivo : 'Rechazado por el revisor';
      case 'No evaluado': return 'No se contrastó: el proceso terminó antes';
      case 'Aclaración pedida': return it ? it.detail : 'Se pidió una nueva versión';
      case 'Sin evaluar': return 'Pendiente de evaluación automática';
      default: return '';
    }
  }

  /** Aclaración inicial de un expediente en clar (del escenario o derivada del CSV). */
  function aclaracionInicial(b, e, st) {
    const a = e.aclaracion ? clone(e.aclaracion) : {
      docs: b.docs.map((d, i) => (d === 'Aclaración pedida' ? i : -1)).filter((i) => i >= 0),
      origen: {}, motivo: b.decision ? b.decision.motivo : '', solicitada: b.decision ? b.decision.fecha : null,
      por: b.decision ? b.decision.por : '', plazo: null, recibida: null
    };
    a.origen = a.origen || {};
    a.docs.forEach((i) => { if (!a.origen[i]) a.origen[i] = 'a1'; });
    a.envios = []; a.detectados = []; a.historial = []; a.revalidada = null;
    const rec = a.recibida;
    a.recibida = null;
    if (rec) aplicarRecepcion(st, a, rec, aMin(rec.fecha), false);
    return a;
  }

  /**
   * Registra la recepción de una aclaración: versión 2 de los documentos, detección automática por el agente
   * según el origen (a1 → Agente 1, a2 → Agente 2) y los no solicitados al historial mínimo (no se revalidan).
   */
  function aplicarRecepcion(st, a, rec, t, conEventos) {
    a.recibida = { fecha: rec.fecha, docs: rec.docs.map((x) => ({ doc: x.doc, solicitado: !!x.solicitado })) };
    a.envios.push(clone(a.recibida));
    if (conEventos) {
      const nombres = rec.docs.map((x) => DOCS[x.doc] + ' (versión 2' + (x.solicitado ? '' : ', no solicitado') + ')');
      evento(st, t, 'Sistema', 'Aclaración recibida', 'El postulante envió ' + rec.docs.length + (rec.docs.length === 1 ? ' documento: ' : ' documentos: ') + lista(nombres));
    }
    rec.docs.forEach((x) => {
      if (x.solicitado) {
        const ag = a.origen[x.doc] === 'a2' ? 'Agente 2' : 'Agente 1';
        marcarDoc(st, x.doc, { estado: 'Aclaración recibida', nota: 'Versión 2 recibida; pendiente de revalidación', version: 2, noSolicitado: false });
        a.detectados.push({ doc: x.doc, agente: ag, fecha: rec.fecha });
        if (conEventos) evento(st, t, ag, 'Detectó nueva versión de ' + DOCS[x.doc], 'Versión 2 solicitada en la aclaración; queda lista para revalidar');
      } else {
        marcarDoc(st, x.doc, { estado: 'Cambio no solicitado · revisar', nota: 'Llegó una versión 2 que no se pidió; no se revalida', version: 2, noSolicitado: true });
        a.historial.push({ fecha: rec.fecha, doc: x.doc, version: 2, nota: 'Documento no solicitado recibido; no se revalida' });
        if (conEventos) evento(st, t, 'Sistema', 'Documento no solicitado recibido', DOCS[x.doc] + ' (versión 2): no se revalida; queda en el historial del caso');
      }
    });
  }

  // ---------------------------------------------------------------- simulaciones
  /** Simulación activa de un expediente, o null. */
  const simDe = (id) => S.simulaciones.find((x) => x.caso === id) || null;
  /** Duración total (ms reales) de una simulación. */
  const duracion = (sim) => sim.pasos.reduce((a, p) => a + p.ms, 0);

  /** Avance de una simulación según Date.now() (o el reloj inyectado): paso actual y progreso 0..1. */
  function progreso(sim) {
    const total = duracion(sim);
    const el = nowFn() - sim.inicio;
    if (el < 0) return { k: 0, enCola: true, global: 0 };
    let acc = 0;
    for (let k = 0; k < sim.pasos.length; k++) {
      if (el < acc + sim.pasos[k].ms) return { k: k, enCola: false, global: total ? el / total : 1 };
      acc += sim.pasos[k].ms;
    }
    return { k: sim.pasos.length - 1, enCola: false, global: 1 };
  }

  /** Registra una simulación (o la completa al tiro si no tiene pasos). */
  function lanzar(sim) {
    if (!sim.pasos.length) completar(sim);
    else S.simulaciones.push(sim);
  }

  /** Completa las simulaciones vencidas (en orden de término). Devuelve true si cambió algo. */
  function avanzar() {
    const now = nowFn();
    const fin = (x) => x.inicio + duracion(x);
    const listas = S.simulaciones.filter((x) => now >= fin(x)).sort((a, b) => fin(a) - fin(b));
    if (listas.length) {
      S.simulaciones = S.simulaciones.filter((x) => listas.indexOf(x) < 0);
      listas.forEach(completar);
    }
    const lote = cerrarLote();
    if (!listas.length && !lote) return false;
    guardar();
    return true;
  }

  /** Aplica el resultado de una simulación terminada. Nunca deja el caso en ok, rej ni clar. */
  function completar(sim) {
    if (sim.tipo === 'eval') completarEval(sim);
    else completarAgentes(sim);
  }

  /**
   * Documentos que el Agente 2 debe contrastar: todos los que aún no contrastó.
   * Un documento no solicitado que nunca se contrastó entra con su versión 1 vigente (la versión 2 no se revalida
   * y sigue marcada "Cambio no solicitado · revisar"): así ningún expediente queda listo sin contraste.
   */
  function docsPorContrastar(st) {
    return [0, 1, 2, 3].filter((i) => !st.a2hecho[i]);
  }
  /** Documentos sin contraste del Agente 2 ni validación manual (impiden la conformidad). */
  function docsSinContraste(st) {
    return [0, 1, 2, 3].filter((i) => !st.a2hecho[i] && st.docs[i].estado !== 'Validado manualmente');
  }

  /** Pasos del Agente 2 sobre una lista de documentos; si hay resultado con detención, corta en ese documento. */
  function pasosA2(docs, res, ms) {
    const out = [];
    for (const d of docs) {
      out.push({ agente: 'Agente 2', doc: d, ms: ms || MS.a2, min: MIN.a2Doc, vivo: 'Coincide' });
      if (res && d === res.stopAt) break;
    }
    return out;
  }

  /** Inicia el contraste del Agente 2 (send, resume o respuesta de la fuente) → fase a2run. */
  function iniciarA2(st, id, tipo, t, resultadoForzado) {
    const docs = docsPorContrastar(st);
    let res = resultadoForzado || null;
    if (!res && !st.resultadoUsado && st.resultadoAgente2 && docs.indexOf(st.resultadoAgente2.stopAt) >= 0) {
      res = clone(st.resultadoAgente2);
      st.resultadoUsado = true;
    }
    if (res && docs.indexOf(res.stopAt) < 0) res = null;
    st.fase = 'a2run';
    lanzar({ caso: id, tipo: tipo, inicio: nowFn(), relojInicio: t, pasos: pasosA2(docs, res), resultado: res });
  }

  /** Cierre de una corrida de agentes (a2run o reval): pasa a rev/ready o rev/a2stop y notifica. */
  function completarAgentes(sim) {
    const st = mut(sim.caso);
    let t = sim.relojInicio;
    const res = sim.resultado;
    // Agente 1 (solo en revalidación: versión 2 de los documentos pedidos con origen a1)
    const a1 = sim.pasos.filter((p) => p.agente === 'Agente 1');
    a1.forEach((p) => {
      t += p.min;
      marcarDoc(st, p.doc, { estado: 'Sin señales', nota: 'Versión 2 sin señales de adulteración; pendiente de contraste' });
      evento(st, t, 'Agente 1', 'Revalidó ' + DOCS[p.doc] + ' (versión 2)', 'Sin señales de adulteración');
    });
    if (a1.length) st.min[0] = (num(st.min[0]) || 0) + a1.reduce((s, p) => s + p.min, 0);
    // Agente 2
    const a2 = sim.pasos.filter((p) => p.agente === 'Agente 2');
    let mA2 = 0;
    const v1 = [];   // no solicitados contrastados en su versión 1 vigente
    a2.forEach((p) => {
      mA2 += p.min;
      st.a2hecho[p.doc] = true;
      if (res && p.doc === res.stopAt) return;
      const prev = st.docs[p.doc];
      if (prev.noSolicitado) {
        // Sigue marcado "Cambio no solicitado · revisar" para el revisor; solo se registra el contraste de la versión 1
        marcarDoc(st, p.doc, { nota: notaNoSolicitado(p.doc) });
        v1.push(p.doc);
        return;
      }
      const conservar = prev.estado === 'Aprobado por revisor' || prev.estado === 'Validado manualmente';
      marcarDoc(st, p.doc, { estado: conservar ? prev.estado : 'Coincide', nota: conservar ? notaContrastada(prev.nota, p.doc) : 'Coincide con ' + EMISORES[p.doc] });
    });
    t += mA2;
    if (a2.length) st.min[1] = (num(st.min[1]) || 0) + mA2;
    if (v1.length) {
      evento(st, t, 'Agente 2', 'Contrastó la versión 1 vigente de ' + lista(v1.map((d) => DOCS[d])),
        'No se había contrastado y coincide con ' + lista(v1.map((d) => EMISORES[d]).filter((x, i, a) => a.indexOf(x) === i)) + '. La versión 2 no solicitada no se revalida: la revisa el revisor');
    }
    if (res) {
      const off = res.level === 'No disponible';
      if (off) st.a2hecho[res.stopAt] = false;   // el sitio no respondió: el documento sigue sin contrastar
      st.fase = 'a2stop'; st.stopAt = res.stopAt; st.fuenteCaida = off; st.reintento = null;
      st.items = [{ doc: res.stopAt, level: res.level || 'Discrepancia', detail: res.detail, conf: null }];
      st.evidencia = [clone(res.ev || { key: '', caption: res.detail })];
      marcarDoc(st, res.stopAt, { estado: off ? 'Fuente no disponible' : 'Discrepancia', nota: res.detail });
      for (let i = res.stopAt + 1; i < 4; i++) {
        if (!st.a2hecho[i] && !st.docs[i].noSolicitado) marcarDoc(st, i, { estado: 'Pendiente', nota: 'El Agente 2 se detuvo antes' });
      }
      evento(st, t, 'Agente 2', (off ? 'Sitio sin respuesta en documento ' : 'Discrepancia en documento ') + (res.stopAt + 1) + ' de 4', frase(res.stopAt, res.detail));
    } else {
      st.fase = 'ready'; st.stopAt = null; st.fuenteCaida = false; st.reintento = null; st.items = []; st.evidencia = [];
      const n = a2.length;
      evento(st, t, 'Agente 2', 'Contraste con sitios web',
        (n === 4 ? 'Los 4 documentos coinciden' : n === 0 ? 'Sin documentos pendientes de contraste' : (n === 1 ? 'El documento contrastado coincide' : 'Los ' + n + ' documentos contrastados coinciden')) + '; vuelve a revisión para la conformidad final');
    }
    st.estado = 'rev';
    if (sim.tipo === 'reval') {
      st.ciclo += 1;
      st.decision = null;
      st.entradaRev = t;
      const nos = st.docs.map((d, i) => (d.noSolicitado ? DOCS[i] : null)).filter(Boolean);
      if (nos.length) evento(st, t, 'Sistema', 'Cambio no solicitado sin revalidar', lista(nos) + ': revisar la versión 2 antes de decidir');
    }
    evento(st, t, 'Sistema', 'Notificación al revisor', st.fase === 'ready'
      ? 'Listo para conformidad: la decisión final la toma el revisor'
      : 'El Agente 2 está en pausa y requiere la decisión del revisor');
    S.reloj = Math.max(S.reloj, t);
  }

  /** Cierre de la evaluación automática de un expediente (none → ag → rev) según su patrón. */
  function completarEval(sim) {
    const st = mut(sim.caso);
    const pat = sim.patron;
    const g = pat === 'ready' ? null : (GENERICAS[pat] || null);
    let t = sim.relojInicio;
    const a1 = sim.pasos.filter((p) => p.agente === 'Agente 1');
    const mA1 = a1.reduce((s, p) => s + p.min, 0);
    t += mA1;
    st.min = [mA1, '', '', ''];
    st.docs = [0, 1, 2, 3].map(() => ({ estado: 'Sin señales', nota: 'Pendiente de contraste', version: 1, noSolicitado: false }));
    st.a2hecho = [false, false, false, false];
    if (g && /^a1/.test(pat)) {
      st.items = clone(g.items); st.evidencia = clone(g.evidencia || []);
      st.items.forEach((it) => marcarDoc(st, it.doc, { estado: 'Señal ' + it.level.toLowerCase(), nota: it.detail }));
      st.senalesA1 = st.items.length;
      evento(st, t, 'Agente 1', 'Señal detectada', st.items.map((it) => frase(it.doc, String(it.detail).replace(/\.$/, '')) + ' (confianza ' + it.conf + '%)').join(' | '));
      st.fase = 'a1';
    } else {
      evento(st, t, 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración');
      const a2 = sim.pasos.filter((p) => p.agente === 'Agente 2');
      const stop = g ? g.stopAt : null;
      a2.forEach((p) => {
        st.a2hecho[p.doc] = true;
        if (p.doc !== stop) marcarDoc(st, p.doc, { estado: 'Coincide', nota: 'Coincide con ' + EMISORES[p.doc] });
      });
      const mA2 = a2.reduce((s, p) => s + p.min, 0);
      t += mA2;
      st.min[1] = mA2;
      if (g) {
        const off = g.items[0].level === 'No disponible';
        if (off) st.a2hecho[stop] = false;   // el sitio no respondió: el documento sigue sin contrastar
        st.fase = 'a2stop'; st.stopAt = stop; st.fuenteCaida = off;
        st.items = clone(g.items); st.evidencia = clone(g.evidencia || []);
        if (off && st.evidencia[0] && st.evidencia[0].tries === '3 intentos') st.evidencia[0].tries = '3 intentos · último ' + fecha(deMin(t));
        st.respuestaFuente = clone(g.respuestaFuente != null ? g.respuestaFuente : 'coincide');
        st.resultadoAgente2 = clone(g.resultadoAgente2 || null);
        marcarDoc(st, stop, { estado: off ? 'Fuente no disponible' : 'Discrepancia', nota: g.items[0].detail });
        for (let i = stop + 1; i < 4; i++) marcarDoc(st, i, { estado: 'Pendiente', nota: 'El Agente 2 se detuvo antes' });
        evento(st, t, 'Agente 2', (off ? 'Sitio sin respuesta en documento ' : 'Discrepancia en documento ') + (stop + 1) + ' de 4', frase(stop, g.items[0].detail));
      } else {
        st.fase = 'ready'; st.items = []; st.evidencia = [];
        evento(st, t, 'Agente 2', 'Contraste con sitios web', 'Los 4 documentos coinciden; pasa a revisión para la conformidad');
      }
    }
    st.estado = 'rev';
    st.entradaRev = t;
    evento(st, t, 'Sistema', 'Notificación al revisor', st.fase === 'ready'
      ? 'Listo para conformidad: la decisión final la toma el revisor'
      : st.fase === 'a1' ? 'Señales del Agente 1: el Agente 2 no inicia hasta que el revisor decida' : 'El Agente 2 está en pausa y requiere la decisión del revisor');
    S.reloj = Math.max(S.reloj, t);
    // Fase con la que terminó el expediente dentro del último lote de evaluación (para el aviso de la Consola)
    if (S.lote && S.lote.ids.indexOf(sim.caso) >= 0) S.lote.fases[sim.caso] = st.fase === 'a2stop' ? (st.fuenteCaida ? 'fuenteCaida' : 'discrepancia') : st.fase;
  }

  // ---------------------------------------------------------------- último lote de evaluación
  /** Cierra el último lote cuando ya no queda ninguna simulación suya: fija fin y resumen de fases. */
  function cerrarLote() {
    const L = S.lote;
    if (!L || L.resumen || L.ids.some((id) => simDe(id))) return false;
    const r = { total: L.ids.length, ready: 0, a1: 0, a2stop: 0, discrepancia: 0, fuenteCaida: 0 };
    L.ids.forEach((id) => {
      const f = L.fases[id];
      if (f === 'ready') r.ready++;
      else if (f === 'a1') r.a1++;
      else if (f === 'discrepancia' || f === 'fuenteCaida') { r.a2stop++; r[f]++; }
    });
    L.fin = Math.min(L.fin, nowFn());
    L.relojFin = S.reloj;
    L.resumen = r;
    return true;
  }

  /**
   * Último lote de "Iniciar evaluación" (persistido; sobrevive a recargas) o null:
   * { proc, procesoNombre, ids, cantidad, inicio, fin (ms reales), terminado, enCurso, por,
   *   relojInicioTxt, relojFinTxt, resumen: { total, ready, a1, a2stop, discrepancia, fuenteCaida } | null }.
   */
  function ultimoLote() {
    avanzar();
    const L = S.lote;
    if (!L) return null;
    const terminado = !!L.resumen;
    return {
      proc: L.proc,
      procesoNombre: PROC[L.proc] ? PROC[L.proc].nombre : '',
      ids: L.ids.slice(),
      cantidad: L.ids.length,
      inicio: L.inicio,
      fin: L.fin,
      terminado: terminado,
      enCurso: !terminado,
      por: L.por,
      relojInicioTxt: fecha(deMin(L.relojInicio)),
      relojFinTxt: terminado ? fecha(deMin(L.relojFin)) : '',
      resumen: terminado ? Object.assign({}, L.resumen) : null
    };
  }

  /** Descarta el aviso del último lote (la Consola ya lo mostró y el usuario lo cerró). */
  function descartarLote() {
    if (!S.lote) return { ok: false, error: 'No hay un lote de evaluación que descartar' };
    S.lote = null;
    cambio();
    return { ok: true };
  }

  // ---------------------------------------------------------------- view-models
  /** Línea de tiempo genérica (relleno y pendientes sin relato): ingreso, Agente 1, Agente 2 y decisión. */
  function timelineGenerica(b, st) {
    const out = [];
    const t0 = aMin(b.ingreso);
    out.push({ t: t0, actor: 'Sistema', evento: 'Ingreso de carpeta', detalle: '4 documentos identificados' });
    if (b.estado === 'none') return out;
    const m1 = num(b.minutos[0]), m2 = num(b.minutos[1]);
    const conf = b.confianza ? ' (confianza ' + b.confianza.split(' | ').join('% y ') + '%)' : '';
    if (m1 != null) {
      if (b.observacion === 'Señal Agente 1') out.push({ t: t0 + m1, actor: 'Agente 1', evento: 'Señal detectada', detalle: (b.detalle || 'Señal de posible adulteración') + conf });
      else out.push({ t: t0 + m1, actor: 'Agente 1', evento: 'Evaluación documental', detalle: 'Sin señales de adulteración' });
    }
    if (b.estado === 'ag') {
      const k = b.docs.indexOf('Validando');
      out.push({ t: t0 + (m1 || 0), actor: 'Agente 2', evento: 'Contraste en curso', detalle: 'Validando ' + (k >= 0 ? 'documento ' + (k + 1) + ' de 4' : 'los documentos') });
    } else if (m2 != null) {
      const tA2 = t0 + (m1 || 0) + m2;
      const kd = b.docs.indexOf('Discrepancia') >= 0 ? b.docs.indexOf('Discrepancia') : (b.observacion === 'Discrepancia' ? b.docs.indexOf('Rechazado') : -1);
      const kf = b.docs.indexOf('Fuente no disponible') >= 0 ? b.docs.indexOf('Fuente no disponible') : (b.observacion === 'Fuente no disponible' ? b.docs.indexOf('Validado manualmente') : -1);
      if (kd >= 0) out.push({ t: tA2, actor: 'Agente 2', evento: 'Discrepancia en documento ' + (kd + 1) + ' de 4', detalle: b.detalle || DOCS[kd] + ': no coincide con ' + EMISORES[kd] });
      else if (kf >= 0) out.push({ t: tA2, actor: 'Agente 2', evento: 'Sitio sin respuesta en documento ' + (kf + 1) + ' de 4', detalle: b.detalle || DOCS[kf] + ': el sitio no respondió tras 3 intentos' });
      else out.push({ t: tA2, actor: 'Agente 2', evento: 'Contraste con sitios web', detalle: 'Los 4 documentos coinciden; pasa a revisión para la conformidad' });
    }
    if (b.decision) {
      const td = aMin(b.decision.fecha);
      out.push({ t: td, actor: b.decision.por, evento: 'Resultado: ' + b.decision.resultado, detalle: b.decision.motivo });
      if (b.decision.resultado === 'Rechazado') out.push({ t: td, actor: 'Sistema', evento: 'Notificación enviada', detalle: 'Se informa la decisión del revisor al equipo de Reclutamiento' });
      if (b.decision.resultado === 'Aclaración solicitada') out.push({ t: td + 1, actor: 'Sistema', evento: 'Correo enviado al postulante', detalle: 'Al recibir los documentos, los agentes los detectan y un revisor pide la revalidación' });
    }
    return out;
  }

  /** Resumen del Agente 2 para las etapas ('4 de 4 coinciden', '… y 1 validado manualmente'). */
  function resumenA2(docs, a2hecho) {
    const manual = docs.filter((d) => d.estado === 'Validado manualmente').length;
    // un no solicitado cuya versión 1 vigente ya contrastó el Agente 2 también coincide
    const ok = docs.filter((d, i) => /^(Coincide|Validado|Aprobado por revisor)$/.test(d.estado) || (d.noSolicitado && a2hecho && a2hecho[i])).length;
    const nos = docs.filter((d) => d.noSolicitado).length;
    const txt = manual ? (ok - manual) + ' coinciden y ' + manual + ' validado' + (manual === 1 ? '' : 's') + ' manualmente' : ok + ' de 4 coinciden';
    return txt + (nos ? ' · ' + nos + (nos === 1 ? ' cambio no solicitado' : ' cambios no solicitados') : '');
  }

  /** Etapas [[tipo, texto] x4] (Agente 1, Agente 2, Revisión humana, Resultado) calculadas del estado. */
  function pasosGenericos(st, b, sim, prog) {
    const corriendo = sim && !prog.enCola ? sim.pasos[prog.k] : null;
    const n = st.senalesA1;
    const sig = n + (n === 1 ? ' señal' : ' señales');
    let p1, p2, p3, p4;
    // Agente 1
    if (st.estado === 'none') p1 = ['todo', 'Sin evaluar'];
    else if (sim && sim.tipo === 'eval' && (!corriendo || corriendo.agente === 'Agente 1')) p1 = ['run', 'Evaluando documentos'];
    else if (corriendo && corriendo.agente === 'Agente 1') p1 = ['run', 'Revalidando versión 2'];
    else if (st.ciclo > 1 && n > 0) p1 = ['ok', 'Versión 2 sin señales'];
    else if (st.fase === 'a1') p1 = ['warn', sig];
    else if (n > 0 && st.senalesAprobadas) p1 = ['ok', n === 1 ? 'Señal aprobada' : 'Señales aprobadas'];
    else if (n > 0) p1 = ['warn', sig];
    else p1 = ['ok', 'Sin señales'];
    // Agente 2
    const stopTxt = (off, k) => (off ? 'Sitio sin respuesta en documento ' : 'Discrepancia en documento ') + (k + 1) + ' de 4';
    if (corriendo && corriendo.agente === 'Agente 2') p2 = ['run', 'Validando documento ' + (corriendo.doc + 1) + ' de 4'];
    else if (sim) p2 = ['todo', 'En espera del Agente 1'];
    else if (st.estado === 'none') p2 = ['todo', 'Pendiente'];
    else if (st.estado === 'ag') p2 = ['run', 'Validando documentos'];
    else if (st.fase === 'ready' || st.estado === 'ok') p2 = ['ok', resumenA2(st.docs, st.a2hecho)];
    else if (st.fase === 'a2stop') p2 = ['warn', stopTxt(st.fuenteCaida, st.stopAt)];
    else if (st.fase === 'a1') p2 = ['todo', 'No inicia hasta resolver señales'];
    else if (st.stopAt != null && st.a2hecho.some(Boolean)) p2 = ['warn', stopTxt(false, st.stopAt)];
    else if (st.a2hecho.some(Boolean)) p2 = ['ok', resumenA2(st.docs, st.a2hecho)];
    else p2 = ['skip', st.estado === 'rej' ? 'No ejecutado' : 'No iniciado'];
    // Revisión humana
    const recibida = !!(st.aclaracion && st.aclaracion.recibida);
    if (st.estado === 'ok') p3 = ['done', 'Dio conformidad'];
    else if (st.estado === 'rej') p3 = ['done', 'Rechazó'];
    else if (st.estado === 'clar') p3 = ['done', recibida ? 'Aclaración recibida' : 'Pidió aclaración'];
    else if (st.estado === 'rev' && !sim) p3 = ['current', 'Etapa actual'];
    else p3 = ['todo', 'Pendiente'];
    // Resultado
    if (st.estado === 'ok') p4 = ['res', 'Conforme'];
    else if (st.estado === 'rej') p4 = ['rej', 'Rechazado'];
    else if (st.estado === 'clar') p4 = ['clar', recibida ? 'Aclaración recibida · revalidar' : 'Observado'];
    else p4 = ['todo', 'Lo confirma el revisor'];
    return [p1, p2, p3, p4];
  }

  /** Tiempos por etapa ['7 min', '12 min', '13 min', 'Total 32 min'] calculados del estado. */
  function tiemposGenericos(st, b) {
    const a1 = num(st.min[0]), a2 = num(st.min[1]);
    let rh = null;
    if (st.decision && st.decision.fecha) rh = aMin(st.decision.fecha) - aMin(b.ingreso) - (a1 || 0) - (a2 || 0);
    else if (num(st.min[2]) != null && st.estado !== 'rev') rh = num(st.min[2]) + (num(st.min[3]) || 0);
    else if (st.estado === 'rev' && st.ciclo > 1) rh = S.reloj - aMin(b.ingreso) - (a1 || 0) - (a2 || 0);   // incluye la espera de la aclaración
    else if (st.estado === 'rev' && st.entradaRev != null) rh = S.reloj - st.entradaRev;
    const total = (a1 || 0) + (a2 || 0) + (rh || 0);
    return [fmtMin(a1), fmtMin(a2), fmtMin(rh), 'Total ' + fmtMin(total)];
  }

  /** Razón del resultado para la ficha. */
  function razonGenerica(st) {
    const d = st.decision;
    if (!d) return '';
    const m = conPunto(d.motivo);
    if (d.resultado === 'Conforme') {
      // Un solo "conformidad final": si el motivo ya empieza así, se continúa la frase ("… final tras revisar …").
      const resto = m.replace(/^conformidad final(?: del revisor)?/i, '');
      if (resto !== m) return 'El revisor dio la conformidad final' + (resto && resto !== '.' ? resto : '.');
      return ('El revisor dio la conformidad final. ' + m).trim();
    }
    if (d.resultado === 'Rechazado') return m ? 'Rechazado por el revisor. Motivo: ' + m : 'Rechazado por el revisor.';
    if (d.resultado === 'Aclaración solicitada') return (m ? frase('Se pidió aclaración al postulante', m) : 'Se pidió aclaración al postulante.') + (st.aclaracion && st.aclaracion.plazo ? ' Plazo: ' + dia(st.aclaracion.plazo) + '.' : '');
    return m;
  }

  /** Criticidad para la bandeja: Alta (señal alta o discrepancia), Media (solo señales medias), Baja (listo o fuente no disponible). */
  function criticidadDe(st) {
    if (st.estado !== 'rev') return '';
    if (st.fase === 'ready' || st.fuenteCaida || st.fase === 'a2run' || st.fase === 'reval') return 'Baja';
    if (st.items.some((it) => it.level === 'Alta' || it.level === 'Discrepancia')) return 'Alta';
    if (st.items.some((it) => it.level === 'Media')) return 'Media';
    return 'Baja';
  }

  /** View-model completo de un expediente (ver contrato, sección 4). */
  function vm(id) {
    const b = POR_ID[id];
    if (!b) return null;
    const e = CASOS_ESC[id] || {};
    const st = caso(id);
    const sim = simDe(id);
    const prog = sim ? progreso(sim) : null;
    // contrastado: el Agente 2 ya contrastó el documento con el sitio del emisor (también en pasos ya terminados de una simulación)
    const docs = st.docs.map((d, i) => Object.assign({}, d, { contrastado: !!st.a2hecho[i] }));
    let enEjecucion = null;
    if (sim) {
      const paso = sim.pasos[prog.k];
      enEjecucion = { agente: paso.agente, doc: paso.doc, documento: DOCS[paso.doc], progreso: Math.round(prog.global * 100) / 100, tipo: sim.tipo, enCola: prog.enCola };
      sim.pasos.forEach((p, j) => {
        if (prog.enCola) return;
        if (j < prog.k) {
          const a2 = p.agente === 'Agente 2';
          const prev = docs[p.doc];
          if (a2 && prev.noSolicitado) {
            docs[p.doc] = Object.assign({}, prev, { estado: st.docs[p.doc].estado, nota: notaNoSolicitado(p.doc), contrastado: true });
            return;
          }
          const conservar = p.vivo === 'Coincide' && (prev.estado === 'Aprobado por revisor' || prev.estado === 'Validado manualmente');
          docs[p.doc] = Object.assign({}, prev, conservar
            ? { nota: notaContrastada(prev.nota, p.doc) }
            : { estado: p.vivo, nota: p.vivo === 'Coincide' ? 'Coincide con ' + EMISORES[p.doc] : p.agente + ' terminó este documento' },
            a2 ? { contrastado: true } : {});
        } else if (j === prog.k) {
          const nota = p.agente === 'Agente 2' && docs[p.doc].noSolicitado ? 'Agente 2 contrastando la versión 1 vigente (la versión 2 no se pidió)' : p.agente + ' trabajando en este documento';
          docs[p.doc] = Object.assign({}, docs[p.doc], { estado: p.agente === 'Agente 2' ? 'Validando' : 'Evaluando', nota: nota, contrastado: false });
        }
      });
    }
    // Línea de tiempo: relato del escenario (o genérico) + eventos de la demo, ordenados por fecha
    const base = e.timeline ? e.timeline.map((x) => ({ t: aMin(x[0]), actor: x[1], evento: x[2], detalle: x[3] })) : timelineGenerica(b, st);
    const timeline = base.concat(st.eventos)
      .map((x, i) => ({ x: x, i: i }))
      .sort((p, q) => (p.x.t - q.x.t) || (p.i - q.i))
      .map((o) => ({ fecha: fecha(deMin(o.x.t)), hora: hora(deMin(o.x.t)), t: o.x.t, actor: o.x.actor, evento: o.x.evento, detalle: o.x.detalle }));
    const sinCambios = !st.eventos.length;
    const pasos = sinCambios && e.pasos ? clone(e.pasos) : pasosGenericos(st, b, sim, prog);
    const tiempos = sinCambios && e.tiempos ? e.tiempos.slice() : tiemposGenericos(st, b);
    const razon = sinCambios && e.razon ? e.razon : razonGenerica(st);
    const esperaH = st.estado === 'rev' && st.entradaRev != null ? Math.round((S.reloj - st.entradaRev) / 6) / 10 : null;
    const decision = st.decision ? Object.assign({}, st.decision, { fechaTxt: fecha(st.decision.fecha) }) : null;
    const acl = st.aclaracion ? clone(st.aclaracion) : null;
    return Object.assign({}, b, {
      procesoNombre: PROC[b.proc] ? PROC[b.proc].nombre : '',
      ingresoTxt: fecha(b.ingreso),
      estado: st.estado,
      fase: st.estado === 'rev' ? st.fase : null,
      enEjecucion: enEjecucion,
      items: clone(st.items),
      evidencia: clone(st.evidencia),
      stopAt: st.stopAt,
      fuenteCaida: !!st.fuenteCaida,
      reintento: st.reintento ? Object.assign({}, st.reintento, { fechaTxt: fecha(st.reintento.fecha), proximoTxt: hora(st.reintento.proximo) }) : null,
      docsEstado: docs,
      aclaracion: acl,
      aclaracionRecibida: !!(acl && acl.recibida),
      ciclo: st.ciclo,
      timeline: timeline,
      decision: decision,
      minutos: st.min.slice(),
      pasos: pasos,
      tiempos: tiempos,
      razon: razon,
      nota: sinCambios && e.nota ? e.nota : (decision ? decision.motivo : ''),
      esperaH: esperaH,
      criticidad: criticidadDe(st)
    });
  }

  // ---------------------------------------------------------------- consultas
  /** Expedientes como view-models, filtrados por proceso, estado (texto o lista) y búsqueda por nombre o RUT. */
  function expedientes(filtro) {
    avanzar();
    const f = filtro || {};
    const estados = f.estado == null ? null : [].concat(f.estado);
    const q = norm(f.buscar).trim();
    const qRut = q.replace(/[.\-\s]/g, '');
    return BASE.expedientes
      .filter((x) => !f.proc || x.proc === f.proc)
      .map((x) => vm(x.id))
      .filter((v) => !estados || estados.indexOf(v.estado) >= 0)
      .filter((v) => !q || norm(v.nombre).indexOf(q) >= 0 || (qRut && v.rut.replace(/[.\-]/g, '').toLowerCase().indexOf(qRut) >= 0));
  }

  /** Un expediente como view-model (null si no existe). */
  function expediente(id) { avanzar(); return vm(id); }

  /**
   * Texto veraz para el aviso "Listo para conformidad", calculado de docsEstado. '' si el expediente no está en rev/ready.
   * Ejemplos: 'Los agentes no encontraron señales y el Agente 2 confirmó los 4 documentos con los emisores.'
   *           '2 señales aprobadas por el revisor; el Agente 2 confirmó los 4 documentos con los emisores.'
   *           '1 documento validado manualmente (sitio sin respuesta); 3 coinciden con los emisores.'
   * En ciclo 2 empieza con 'Revalidación terminada (ciclo 2): '. Un documento no solicitado contrastado en su versión 1 se
   * menciona; el aviso "revisa el cambio no solicitado" sigue a cargo de la pantalla (docsEstado[i].noSolicitado).
   */
  function textoListo(id) {
    avanzar();
    const x = vm(id);
    if (!x || x.estado !== 'rev' || x.fase !== 'ready') return '';
    const ds = x.docsEstado;
    const pl = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
    const sin = [0, 1, 2, 3].filter((i) => !ds[i].contrastado && ds[i].estado !== 'Validado manualmente');
    if (sin.length) return 'Falta contrastar ' + lista(sin.map((i) => DOCS[i])) + ': aún no se puede dar conformidad.';
    const manual = ds.filter((d) => d.estado === 'Validado manualmente').length;
    const aprob = ds.filter((d) => d.estado === 'Aprobado por revisor');
    const obsA2 = aprob.filter((d) => /^Observación del Agente 2/.test(d.nota)).length;
    const senales = aprob.length - obsA2;
    const coinciden = 4 - manual - obsA2;
    const v1 = [0, 1, 2, 3].filter((i) => ds[i].noSolicitado).map((i) => DOCS[i]);
    const partes = [];
    if (senales) partes.push(pl(senales, 'señal aprobada por el revisor', 'señales aprobadas por el revisor'));
    if (obsA2) partes.push(pl(obsA2, 'observación del Agente 2 aprobada por el revisor', 'observaciones del Agente 2 aprobadas por el revisor'));
    if (manual) partes.push(pl(manual, 'documento validado manualmente (sitio sin respuesta)', 'documentos validados manualmente (sitio sin respuesta)'));
    const a2 = coinciden === 4 ? 'el Agente 2 confirmó los 4 documentos con los emisores'
      : (coinciden === 1 ? '1 coincide con su emisor' : coinciden + ' coinciden con los emisores');
    let txt;
    if (!partes.length && x.ciclo > 1) txt = a2;
    else if (!partes.length) txt = 'Los agentes no encontraron señales y ' + a2;
    else txt = partes.join(', ') + '; ' + a2;
    if (v1.length) txt += ' (' + lista(v1) + ' en su versión 1 vigente)';
    txt = conPunto(txt);
    if (x.ciclo > 1) return 'Revalidación terminada (ciclo ' + x.ciclo + '): ' + minuscula(txt);
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  const RANGO = { Alta: 0, Media: 1, Baja: 2, '': 3 };
  /**
   * Ordena una lista de view-models: 'prio' (más de 24 h, luego criticidad, luego espera), 'age' (espera),
   * 'crit' (criticidad, luego espera) o 'decision' (fecha de decisión más reciente primero).
   */
  function ordenar(lst, criterio) {
    const w = (x) => x.esperaH || 0;
    const c = (x) => RANGO[x.criticidad || ''];
    const td = (x) => (x.decision && x.decision.fecha ? aMin(x.decision.fecha) : -1e9);
    const fns = {
      prio: (a, b) => ((w(b) > 24) - (w(a) > 24)) || (c(a) - c(b)) || (w(b) - w(a)),
      age: (a, b) => w(b) - w(a),
      crit: (a, b) => (c(a) - c(b)) || (w(b) - w(a)),
      decision: (a, b) => td(b) - td(a)
    };
    return lst.slice().sort(fns[criterio] || fns.prio);
  }

  /** Conteos vacíos de un grupo. */
  const ceros = () => ({ total: 0, none: 0, ag: 0, rev: 0, clar: 0, ok: 0, rej: 0, porRevisar: 0, enEjecucion: 0, revEnEjecucion: 0, agTrabajando: 0, listos: 0, mas24: 0,
    fuenteCaida: 0, discrepancias: 0, senalesA1: 0, aclaracionRecibida: 0, evaluados: 0, conformidad: null, grafico: null });

  /**
   * Suma un view-model a un grupo de conteos. revEnEjecucion = en rev con agentes trabajando (a2run o reval).
   * agTrabajando = con agentes trabajando: estado ag + revEnEjecucion (para gráficos, separado de porRevisar).
   */
  function sumar(c, v) {
    c.total++;
    c[v.estado]++;
    if (v.enEjecucion) c.enEjecucion++;
    if (v.estado === 'ag') c.agTrabajando++;
    if (v.estado === 'rev') {
      const espera = v.fase !== 'a2run' && v.fase !== 'reval';
      if (espera) c.porRevisar++;
      else { c.revEnEjecucion++; c.agTrabajando++; }
      if (v.fase === 'ready') c.listos++;
      if (espera && v.esperaH > 24) c.mas24++;
      if (v.fuenteCaida) c.fuenteCaida++;
      if (v.fase === 'a2stop' && !v.fuenteCaida) c.discrepancias++;
      if (v.fase === 'a1') c.senalesA1++;
    }
    if (v.estado === 'clar' && v.aclaracionRecibida) c.aclaracionRecibida++;
  }
  /**
   * Cierra un grupo: evaluados (ok + rev + clar + rej), tasa de conformidad ok / (ok + rej) en % y el reparto para
   * gráficos `grafico` = { ok, rev: porRevisar, ag: agTrabajando, clar, rej, none } (mismas claves de estado; suma = total).
   */
  function cerrar(c) {
    c.evaluados = c.ok + c.rev + c.clar + c.rej;
    c.conformidad = c.ok + c.rej ? Math.round((c.ok * 100) / (c.ok + c.rej)) : null;
    c.grafico = { ok: c.ok, rev: c.porRevisar, ag: c.agTrabajando, clar: c.clar, rej: c.rej, none: c.none };
    return c;
  }

  /**
   * Conteos de la demo, siempre calculados desde los view-models:
   * { porProceso: { p1: {...} }, total, abiertos, cerrados, antiguedad: { menos4, de4a24, mas24 },
   *   antiguedadAbiertos: { menos4, de4a24, mas24 } (solo procesos abiertos), enEjecucion,
   *   minutosPromedio: { a1, a2, espera, activa }, porDocumento: [{ senales, discrepancias, noDisponible }] x4, reloj }
   * Cada grupo trae además revEnEjecucion (en rev con agentes trabajando: a2run o reval), agTrabajando (ag + revEnEjecucion)
   * y grafico { ok, rev: porRevisar, ag: agTrabajando, clar, rej, none } para dona, barras y lista de estados.
   * Invariantes: rev = porRevisar + revEnEjecucion; total = suma de grafico; antiguedad suma porRevisar.
   */
  function conteos() {
    avanzar();
    const todos = BASE.expedientes.map((x) => vm(x.id));
    const porProceso = {};
    BASE.procesos.forEach((p) => { porProceso[p.id] = ceros(); });
    const total = ceros(), abiertos = ceros(), cerrados = ceros();
    const antiguedad = { menos4: 0, de4a24: 0, mas24: 0 };
    const antiguedadAbiertos = { menos4: 0, de4a24: 0, mas24: 0 };
    const sumas = [0, 0, 0, 0], cuentas = [0, 0, 0, 0];
    const porDocumento = [0, 1, 2, 3].map(() => ({ senales: 0, discrepancias: 0, noDisponible: 0 }));
    const tramo = (a, h) => { if (h > 24) a.mas24++; else if (h >= 4) a.de4a24++; else a.menos4++; };
    todos.forEach((v) => {
      const abierto = PROC[v.proc].estado === 'Abierto';
      sumar(porProceso[v.proc], v);
      sumar(total, v);
      sumar(abierto ? abiertos : cerrados, v);
      if (v.estado === 'rev' && v.fase !== 'a2run' && v.fase !== 'reval') {
        tramo(antiguedad, v.esperaH);
        if (abierto) tramo(antiguedadAbiertos, v.esperaH);
      }
      if (v.estado === 'ok' || v.estado === 'rej') {
        v.minutos.forEach((m, i) => { const n = num(m); if (n != null) { sumas[i] += n; cuentas[i]++; } });
      }
      v.docsEstado.forEach((d, i) => {
        if (/^Señal/.test(d.estado)) porDocumento[i].senales++;
        if (d.estado === 'Discrepancia') porDocumento[i].discrepancias++;
        if (d.estado === 'Fuente no disponible') porDocumento[i].noDisponible++;
      });
    });
    Object.keys(porProceso).forEach((k) => cerrar(porProceso[k]));
    const prom = (i) => (cuentas[i] ? Math.round(sumas[i] / cuentas[i]) : null);
    return {
      porProceso: porProceso,
      total: cerrar(total),
      abiertos: cerrar(abiertos),
      cerrados: cerrar(cerrados),
      antiguedad: antiguedad,
      antiguedadAbiertos: antiguedadAbiertos,
      enEjecucion: S.simulaciones.length > 0,
      minutosPromedio: { a1: prom(0), a2: prom(1), espera: prom(2), activa: prom(3) },
      porDocumento: porDocumento,
      reloj: fecha()
    };
  }

  /** Procesos de VD_BASE con sus conteos ({ id, nombre, estado, clase, area, conteos }). */
  function procesos() {
    const c = conteos();
    return BASE.procesos.map((p) => Object.assign({}, p, { conteos: c.porProceso[p.id] }));
  }

  /** Ruta relativa del PDF de un documento (versión 2 si llegó por aclaración): 'expedientes/<rut>/<archivo>[-v2].pdf'. */
  function rutaDocumento(id, doc, version) {
    const b = POR_ID[id];
    if (!b) return '';
    const v = version || caso(id).docs[doc].version;
    return 'expedientes/' + b.rut.replace(/\./g, '') + '/' + ARCHIVOS[doc] + (v === 2 ? '-v2' : '') + '.pdf';
  }

  // ---------------------------------------------------------------- suscripciones
  const subs = [];
  let timer = null;
  /** Llama a todos los suscriptores (errores aislados). */
  function emitir() { subs.slice().forEach((fn) => { try { fn(); } catch (e) { try { console.error(e); } catch (x) {} } }); }
  /** Mantiene el tic de 500 ms solo mientras hay suscriptores y simulaciones. */
  function asegurarTic() {
    const hace = subs.length > 0 && S.simulaciones.length > 0;
    if (hace && !timer) {
      timer = setInterval(() => {
        avanzar();
        emitir();
        if (!S.simulaciones.length) { clearInterval(timer); timer = null; }
      }, MS.tic);
    } else if (!hace && timer) { clearInterval(timer); timer = null; }
  }
  /** Tras una acción: persiste, notifica y ajusta el tic. */
  function cambio() { guardar(); emitir(); asegurarTic(); }
  /** Suscribe fn a cambios propios, de otra pestaña y al tic de simulaciones. Devuelve la función para desuscribir. */
  function suscribir(fn) {
    if (typeof fn !== 'function') return () => {};
    subs.push(fn);
    asegurarTic();
    return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); asegurarTic(); };
  }
  try {
    window.addEventListener('storage', (ev) => {
      if (ev.key === CLAVE || ev.key === null) { S = cargar(); emitir(); asegurarTic(); }
      else if (ev.key === 'vd-user') emitir();
    });
  } catch (e) { /* sin window events */ }

  // ---------------------------------------------------------------- acciones del revisor
  /** Respuesta de error uniforme. */
  const fallo = (error) => ({ ok: false, error: error });
  /** Respuesta de éxito con el view-model actualizado. */
  const exito = (id, extra) => Object.assign({ ok: true, expediente: vm(id) }, extra || {});
  /** Valida que el expediente exista, esté en rev y sin agentes trabajando. */
  function validarRev(id) {
    if (!POR_ID[id]) return 'Expediente inexistente: ' + id;
    const cur = caso(id);
    if (cur.estado !== 'rev') return 'Solo se decide sobre expedientes en revisión humana (estado actual: ' + cur.estado + ')';
    if (simDe(id)) return 'Los agentes están trabajando en este expediente; espera a que terminen';
    return null;
  }

  /**
   * Decisión del revisor sobre un expediente en rev. op = { tipo, por, motivo, comentario, docsAclaracion, docState }.
   * - send: fase a1 → a2run (todas las señales aprobadas; docState opcional { i0: 'ok', ... }).
   * - resume: fase a2stop → a2run sobre los documentos restantes (con fuente caída = validado manualmente).
   * - ok: solo desde ready → ok (decision con usuario y fecha del reloj).
   * - reject: motivo obligatorio por documento rechazado (motivo texto, u objeto { i0: '...' } / { 1: '...' }) → rej.
   * - clar: comentario obligatorio y docsAclaracion con al menos 1 documento (0..3) → clar, con origen a1/a2 por documento.
   * Devuelve { ok: true, expediente } o { ok: false, error }.
   */
  function decidir(id, op) {
    avanzar();
    op = op || {};
    const err = validarRev(id);
    if (err) return fallo(err);
    const cur = caso(id);
    const por = humano(op.por);
    let r;
    if (op.tipo === 'send') r = accionSend(id, cur, por, op);
    else if (op.tipo === 'resume') r = accionResume(id, cur, por, op);
    else if (op.tipo === 'ok') r = accionOk(id, cur, por, op);
    else if (op.tipo === 'reject') r = accionReject(id, cur, por, op);
    else if (op.tipo === 'clar') r = accionClar(id, cur, por, op);
    else return fallo('Tipo de decisión desconocido: ' + op.tipo);
    if (r) return fallo(r);
    cambio();
    return exito(id);
  }

  /** send: el revisor aprueba las señales del Agente 1 y el expediente pasa al Agente 2. */
  function accionSend(id, cur, por, op) {
    if (cur.fase !== 'a1') return 'Enviar al Agente 2 solo aplica con señales del Agente 1 (fase a1)';
    const ds = op.docState || null;
    if (ds && cur.items.some((it, i) => ds['i' + i] !== 'ok')) return 'Aprueba todas las señales antes de enviar al Agente 2';
    const t = avanzarReloj();
    const st = mut(id);
    st.items.forEach((it) => marcarDoc(st, it.doc, { estado: 'Aprobado por revisor', nota: 'Señal aprobada por ' + por + '; pendiente de contraste' }));
    st.senalesAprobadas = true;
    const nombres = st.items.map((it) => DOCS[it.doc]);
    evento(st, t, por, st.items.length === 1 ? 'Aprobó la señal del Agente 1' : 'Aprobó las señales del Agente 1', lista(nombres) + (op.comentario ? '. ' + op.comentario : '') + '. El expediente pasa al Agente 2');
    st.items = []; st.evidencia = [];
    iniciarA2(st, id, 'send', t, null);
    return null;
  }

  /** resume: el revisor aprueba (o valida manualmente) el documento observado y el Agente 2 continúa. */
  function accionResume(id, cur, por, op) {
    if (cur.fase !== 'a2stop') return 'Reanudar el Agente 2 solo aplica con el Agente 2 detenido (fase a2stop)';
    const s = cur.stopAt;
    const t = avanzarReloj();
    const st = mut(id);
    const manual = st.fuenteCaida;
    marcarDoc(st, s, manual
      ? { estado: 'Validado manualmente', nota: 'Validado por ' + por + ' con QR o código de verificación' }
      : { estado: 'Aprobado por revisor', nota: 'Observación del Agente 2 aprobada por ' + por });
    st.a2hecho[s] = true;
    evento(st, t, por, manual ? 'Validó manualmente el documento' : 'Aprobó el documento observado', String(frase(s, op.comentario)).replace(/\.$/, '') + '. El Agente 2 continúa con los documentos restantes');
    st.items = []; st.evidencia = []; st.fuenteCaida = false; st.reintento = null;
    iniciarA2(st, id, 'resume', t, null);
    return null;
  }

  /**
   * ok: conformidad final del revisor (solo desde listo para conformidad y con los 4 documentos contrastados por
   * el Agente 2 o validados manualmente).
   */
  function accionOk(id, cur, por, op) {
    if (cur.fase !== 'ready') return 'La conformidad solo se da con el expediente listo para conformidad';
    const sin = docsSinContraste(cur);
    if (sin.length) {
      return 'No se puede dar conformidad: ' + lista(sin.map((d) => DOCS[d])) + (sin.length === 1
        ? ' no está contrastado por el Agente 2 ni validado manualmente'
        : ' no están contrastados por el Agente 2 ni validados manualmente');
    }
    const act = proximaActiva();
    const t = avanzarReloj(act);
    const st = mut(id);
    const motivo = (op.motivo || op.comentario || '').trim() || 'Conformidad final tras revisar el resumen de los agentes';
    fijarTiempos(st, id, t, act);
    st.estado = 'ok'; st.fase = null; st.entradaRev = null;
    st.decision = { resultado: 'Conforme', por: por, fecha: iso(t), motivo: motivo };
    evento(st, t, por, 'Resultado: Conforme', motivo);
    evento(st, t, 'Sistema', 'Notificación enviada', 'Se informa la decisión del revisor al equipo de Reclutamiento');
    return null;
  }

  /** reject: rechazo con motivo por documento rechazado. */
  function accionReject(id, cur, por, op) {
    const fuente = op.motivos || op.motivo;
    const motivoDe = (k, d) => {
      if (typeof fuente === 'string') return fuente.trim();
      if (fuente && typeof fuente === 'object') return String(fuente[k] || fuente[d] || '').trim();
      return '';
    };
    let rech = [];
    if (op.docState) {
      Object.keys(op.docState).forEach((k) => {
        if (op.docState[k] !== 'no') return;
        const it = cur.items[+k.slice(1)];
        if (it) rech.push({ doc: it.doc, motivo: motivoDe(k, it.doc) });
      });
    }
    (op.docsRechazados || []).forEach((d) => { if (d >= 0 && d < 4 && !rech.some((x) => x.doc === d)) rech.push({ doc: d, motivo: motivoDe('d' + d, d) }); });
    if (!rech.length) {
      if (cur.fase === 'a2stop') rech = [{ doc: cur.stopAt, motivo: motivoDe('i0', cur.stopAt) }];
      else if (cur.items.length) rech = [{ doc: cur.items[0].doc, motivo: motivoDe('i0', cur.items[0].doc) }];
    }
    // "Fuente no disponible" no es una inconsistencia del documento: no puede ser motivo de rechazo
    const caido = (d) => cur.docs[d].estado === 'Fuente no disponible' || cur.items.some((it) => it.doc === d && it.level === 'No disponible');
    if (rech.some((x) => caido(x.doc))) return 'Un sitio sin respuesta no es motivo de rechazo: valida manualmente, reintenta o solicita aclaración';
    if (!rech.length && !motivoDe('', -1)) return 'Indica el motivo del rechazo';
    if (rech.some((x) => !x.motivo)) return 'Indica el motivo de cada documento rechazado';
    const act = proximaActiva();
    const t = avanzarReloj(act);
    const st = mut(id);
    fijarTiempos(st, id, t, act);
    rech.forEach((x) => marcarDoc(st, x.doc, { estado: 'Rechazado', nota: x.motivo }));
    if (op.docState) {
      Object.keys(op.docState).forEach((k) => {
        const it = cur.items[+k.slice(1)];
        if (it && op.docState[k] === 'ok') marcarDoc(st, it.doc, { estado: 'Aprobado por revisor', nota: 'Señal aprobada por ' + por });
      });
    }
    const abiertos = ['Sin señales', 'Pendiente', 'Validando', 'Señal media', 'Señal alta', 'Aclaración recibida'];
    st.docs.forEach((d, i) => { if (abiertos.indexOf(d.estado) >= 0) marcarDoc(st, i, { estado: 'No evaluado', nota: 'No se contrastó: el proceso terminó con el rechazo' }); });
    const motivoTxt = rech.length ? rech.map((x) => frase(x.doc, x.motivo)).join(' | ') : motivoDe('', -1);
    st.estado = 'rej'; st.fase = null; st.entradaRev = null;
    st.decision = { resultado: 'Rechazado', por: por, fecha: iso(t), motivo: motivoTxt, documentos: rech };
    evento(st, t, por, 'Resultado: Rechazado', (rech.length ? 'Rechazó ' + lista(rech.map((x) => DOCS[x.doc])) + '. ' : '') + 'Motivo: ' + (rech.length ? rech.map((x) => x.motivo).join('; ') : motivoTxt));
    evento(st, t, 'Sistema', 'Notificación enviada', 'Se informa la decisión del revisor al equipo de Reclutamiento');
    return null;
  }

  /** clar: solicitud de aclaración con comentario y documentos; cada documento guarda su origen (a1 o a2). */
  function accionClar(id, cur, por, op) {
    const com = String(op.comentario || op.motivo || '').trim();
    if (!com) return 'El comentario de la aclaración es obligatorio';
    const ds = [];
    (op.docsAclaracion || []).forEach((d) => { d = +d; if (d >= 0 && d < 4 && ds.indexOf(d) < 0) ds.push(d); });
    ds.sort();
    if (!ds.length) return 'Elige al menos un documento para la aclaración';
    const act = proximaActiva();
    const t = avanzarReloj(act);
    const st = mut(id);
    fijarTiempos(st, id, t, act);
    const origen = {};
    ds.forEach((d) => {
      const it = cur.items.find((x) => x.doc === d);
      const a2 = (it && (it.level === 'Discrepancia' || it.level === 'No disponible')) || ['Discrepancia', 'Fuente no disponible'].indexOf(cur.docs[d].estado) >= 0;
      origen[d] = a2 ? 'a2' : 'a1';
    });
    const prev = st.aclaracion;
    st.aclaracion = {
      docs: ds, origen: origen, motivo: com, solicitada: iso(t), por: por, plazo: iso(t + 3 * 1440).slice(0, 10),
      recibida: null, envios: [], detectados: [], historial: prev ? prev.historial : [], revalidada: null
    };
    ds.forEach((d) => marcarDoc(st, d, { estado: 'Aclaración pedida', nota: com }));
    st.estado = 'clar'; st.fase = null; st.entradaRev = null; st.reintento = null;
    st.decision = { resultado: 'Aclaración solicitada', por: por, fecha: iso(t), motivo: com };
    evento(st, t, por, 'Resultado: Aclaración solicitada', frase('Pidió nueva versión de ' + lista(ds.map((d) => DOCS[d])), com));
    evento(st, t, 'Sistema', 'Correo enviado al postulante', 'Plazo: ' + dia(st.aclaracion.plazo) + '. Al recibir los documentos, los agentes los detectan y un revisor pide la revalidación');
    return null;
  }

  /** El revisor programa un reintento de la consulta al sitio que no respondió (rev/a2stop con fuente caída). */
  function reintentarFuente(id, por) {
    avanzar();
    const err = validarRev(id);
    if (err) return fallo(err);
    const cur = caso(id);
    if (cur.fase !== 'a2stop' || !cur.fuenteCaida) return fallo('El reintento solo aplica cuando el sitio del emisor no respondió');
    const quien = humano(por);
    const t = avanzarReloj();
    const st = mut(id);
    st.reintento = { fecha: iso(t), por: quien, proximo: iso(t + 15) };
    evento(st, t, quien, 'Programó un reintento', SITIOS[st.stopAt] + ': el Agente 2 volverá a consultar a las ' + hora(deMin(t + 15)) + '. Si responde, continúa sin intervención');
    cambio();
    return exito(id);
  }

  /** El revisor pide revalidar una aclaración recibida: clar → rev/reval (Agente 1 y luego Agente 2). */
  function revalidar(id, por) {
    avanzar();
    if (!POR_ID[id]) return fallo('Expediente inexistente: ' + id);
    const cur = caso(id);
    if (cur.estado !== 'clar') return fallo('Solo se revalida un expediente esperando aclaración');
    if (!cur.aclaracion || !cur.aclaracion.recibida) return fallo('La aclaración todavía no se recibe');
    const quien = humano(por);
    const t = avanzarReloj();
    const st = mut(id);
    const a = st.aclaracion;
    const pedidos = a.recibida.docs.filter((x) => x.solicitado).map((x) => x.doc).sort();
    pedidos.forEach((d) => { st.a2hecho[d] = false; });
    const pasosA1 = pedidos.filter((d) => a.origen[d] !== 'a2').map((d) => ({ agente: 'Agente 1', doc: d, ms: MS.a1Reval, min: MIN.a1Doc[0], vivo: 'Sin señales' }));
    const rv = st.revalidacion || { resultado: 'ready' };
    const res = rv.resultado === 'a2stop' ? { stopAt: rv.stopAt, level: rv.level || 'Discrepancia', detail: rv.detail, ev: rv.ev } : null;
    const docsA2 = docsPorContrastar(st);
    a.revalidada = { fecha: iso(t), por: quien };
    st.estado = 'rev'; st.fase = 'reval'; st.entradaRev = t; st.items = []; st.evidencia = []; st.fuenteCaida = false;
    const nos = st.docs.map((d, i) => (d.noSolicitado ? DOCS[i] : null)).filter(Boolean);
    const nosV1 = docsA2.filter((d) => st.docs[d].noSolicitado).map((d) => DOCS[d]);
    evento(st, t, quien, 'Pidió revalidar', 'Versión 2 de ' + lista(pedidos.map((d) => DOCS[d])) +
      (nos.length ? '. No se revalida (no solicitado): ' + lista(nos) : '') +
      (nosV1.length ? '. El Agente 2 contrasta la versión 1 vigente de ' + lista(nosV1) + ', que aún no se contrastaba' : ''));
    lanzar({ caso: id, tipo: 'reval', inicio: nowFn(), relojInicio: t, pasos: pasosA1.concat(pasosA2(docsA2, res && docsA2.indexOf(res.stopAt) >= 0 ? res : null)), resultado: res && docsA2.indexOf(res.stopAt) >= 0 ? res : null });
    cambio();
    return exito(id);
  }

  /** Inicia la evaluación automática de los expedientes sin evaluar de un proceso (none → ag, escalonados). */
  function iniciarEvaluacion(proc, por) {
    avanzar();
    if (!PROC[proc]) return fallo('Proceso inexistente: ' + proc);
    const ids = BASE.expedientes.filter((x) => x.proc === proc && caso(x.id).estado === 'none').map((x) => x.id);
    if (!ids.length) return fallo('No hay postulantes sin evaluar en ' + PROC[proc].nombre);
    const quien = humano(por);
    const t = avanzarReloj();
    const now = nowFn();
    const lote = { proc: proc, ids: ids.slice(), por: quien, inicio: now, fin: now, relojInicio: t, relojFin: null, fases: {}, resumen: null };
    ids.forEach((id, k) => {
      const st = mut(id);
      const pat = PATRONES[k % PATRONES.length];
      const g = pat === 'ready' ? null : GENERICAS[pat];
      st.estado = 'ag'; st.fase = null;
      evento(st, t, quien, 'Inició la evaluación automática', 'Proceso ' + PROC[proc].nombre + ': Agente 1 y luego Agente 2');
      const pasos = [0, 1, 2, 3].map((d) => ({ agente: 'Agente 1', doc: d, ms: MS.a1Eval, min: MIN.a1Doc[d], vivo: 'Evaluado' }));
      if (!(g && /^a1/.test(pat))) {
        const stop = g ? g.stopAt : 3;
        for (let d = 0; d <= stop; d++) pasos.push({ agente: 'Agente 2', doc: d, ms: MS.a2Eval, min: MIN.a2Doc, vivo: 'Coincide' });
      }
      const sim = { caso: id, tipo: 'eval', inicio: now + k * MS.escalon, relojInicio: t + k, pasos: pasos, patron: pat, resultado: null };
      lote.fin = Math.max(lote.fin, sim.inicio + duracion(sim));
      S.simulaciones.push(sim);
    });
    S.lote = lote;   // último lote: lo lee VD.ultimoLote() (también tras recargar) hasta VD.descartarLote()
    cambio();
    return { ok: true, ids: ids, cantidad: ids.length };
  }

  // ---------------------------------------------------------------- panel de demo
  /** Simula que el postulante responde la aclaración (versión 2 de lo pedido y, si se indica, un documento no solicitado). */
  function simularAclaracion(id, opciones) {
    avanzar();
    const o = opciones || {};
    if (!POR_ID[id]) return fallo('Expediente inexistente: ' + id);
    const cur = caso(id);
    if (cur.estado !== 'clar' || !cur.aclaracion) return fallo('El expediente no está esperando aclaración');
    if (cur.aclaracion.recibida) return fallo('La aclaración ya fue recibida');
    const t = avanzarReloj();
    const st = mut(id);
    const a = st.aclaracion;
    const docs = a.docs.map((d) => ({ doc: d, solicitado: true }));
    if (o.noSolicitado) {
      let libre = o.docNoSolicitado != null ? +o.docNoSolicitado : [2, 0, 1, 3].find((i) => a.docs.indexOf(i) < 0);
      if (libre != null && libre >= 0 && libre < 4 && a.docs.indexOf(libre) < 0) docs.push({ doc: libre, solicitado: false });
    }
    aplicarRecepcion(st, a, { fecha: iso(t), docs: docs }, t, true);
    cambio();
    return exito(id);
  }

  /** Simula que el sitio que no respondía vuelve a responder: el Agente 2 sigue (a2run) según respuestaFuente. */
  function responderFuente(id) {
    avanzar();
    const err = validarRev(id);
    if (err) return fallo(err);
    const cur = caso(id);
    if (cur.fase !== 'a2stop' || !cur.fuenteCaida) return fallo('El expediente no está detenido por una fuente no disponible');
    const t = avanzarReloj();
    const st = mut(id);
    const s = st.stopAt;
    const resp = st.respuestaFuente;
    evento(st, t, 'Agente 2', 'Sitio respondió', SITIOS[s] + ' volvió a responder; el Agente 2 retoma ' + DOCS[s]);
    st.fuenteCaida = false; st.reintento = null; st.items = []; st.evidencia = [];
    st.a2hecho[s] = false;
    const forzado = resp && typeof resp === 'object' ? { stopAt: s, level: resp.level || 'Discrepancia', detail: resp.detail, ev: resp.ev } : null;
    marcarDoc(st, s, { estado: 'Pendiente', nota: 'El Agente 2 vuelve a consultar el sitio' });
    iniciarA2(st, id, 'fuente', t, forzado);
    cambio();
    return exito(id);
  }

  /** Termina de inmediato a los agentes: adelanta las simulaciones y deja los registros base en ag como rev/ready. */
  function completarTodo() {
    avanzar();
    const pend = S.simulaciones.slice().sort((a, b) => (a.inicio + duracion(a)) - (b.inicio + duracion(b)));
    S.simulaciones = [];
    pend.forEach(completar);
    cerrarLote();
    const ags =BASE.expedientes.filter((x) => caso(x.id).estado === 'ag').map((x) => x.id);
    if (ags.length) {
      const t = avanzarReloj();
      ags.forEach((id) => {
        const b = POR_ID[id];
        const st = mut(id);
        const desde = aMin(b.ingreso) + (num(st.min[0]) || 0);
        st.min[1] = Math.max(1, t - desde);
        [0, 1, 2, 3].forEach((i) => { st.a2hecho[i] = true; marcarDoc(st, i, { estado: 'Coincide', nota: 'Coincide con ' + EMISORES[i] }); });
        st.estado = 'rev'; st.fase = 'ready'; st.items = []; st.evidencia = []; st.stopAt = null; st.entradaRev = t;
        evento(st, t, 'Agente 2', 'Contraste con sitios web', 'Los 4 documentos coinciden; pasa a revisión para la conformidad');
        evento(st, t, 'Sistema', 'Notificación al revisor', 'Listo para conformidad: la decisión final la toma el revisor');
      });
    }
    cambio();
    return { ok: true, completados: pend.length + ags.length };
  }

  /** Vuelve la demo al estado inicial (borra lo guardado en localStorage). */
  function reiniciar() {
    S = vacio();
    try { localStorage.removeItem(CLAVE); } catch (e) { /* en memoria */ }
    emitir();
    asegurarTic();
    return { ok: true };
  }

  // ---------------------------------------------------------------- API pública
  window.VD = {
    version: VERSION,
    /** Date del reloj simulado = hoy base + minutos acumulados. */
    ahora: () => deMin(S.reloj),
    hora: hora,
    fecha: fecha,
    /** '17 oct' de una fecha (o del reloj simulado); para plazos. */
    dia: dia,
    usuario: usuario,
    procesos: procesos,
    expedientes: expedientes,
    expediente: expediente,
    /** Texto del aviso "Listo para conformidad" según docsEstado ('' si no está en rev/ready). */
    textoListo: textoListo,
    /** 'Documento: detalle' sin mayúscula tras los dos puntos (doc = índice 0..3 o nombre). */
    frase: frase,
    conteos: conteos,
    ordenar: ordenar,
    rutaDocumento: rutaDocumento,
    suscribir: suscribir,
    decidir: decidir,
    reintentarFuente: reintentarFuente,
    revalidar: revalidar,
    iniciarEvaluacion: iniciarEvaluacion,
    ultimoLote: ultimoLote,
    descartarLote: descartarLote,
    hayCambios: hayCambios,
    documentos: DOCS.slice(),
    emisores: EMISORES.slice(),
    sitios: SITIOS.slice(),
    plantillas: clone(ESC.plantillas || []),
    demo: {
      simularAclaracion: simularAclaracion,
      responderFuente: responderFuente,
      completarAgentes: completarTodo,
      reiniciar: reiniciar
    },
    /** Solo pruebas: inyecta el reloj real (fn que devuelve ms). Sin argumento vuelve a Date.now. */
    _setNow: (fn) => { nowFn = typeof fn === 'function' ? fn : () => Date.now(); },
    /** Solo depuración: copia del estado interno. */
    _estado: () => clone(S)
  };
})();
