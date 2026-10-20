// vd-escenarios.js · Detalle narrativo por caso de la demo (a mano).
// Formato: docs/arquitectura-demo.md, sección 3. Extraído de Main.dc.html (data().cases, data().resolvedCases,
// TPL y EV de renderVals) y ampliado con los escenarios de aclaración, revalidación y evaluación.
// Los datos del postulante (nombre, RUT, fechas, estado inicial) viven en vd-datos.js: aquí solo va el relato.
//
// Convenciones:
// - items[i] y evidencia[i] van alineados (mismo orden). level: 'Alta' | 'Media' (Agente 1), 'Discrepancia' | 'No disponible' (Agente 2).
// - evidencia: key = clave del campo en plantillas[doc].fields ('folio', 'codigo', 'egreso', 'clase', 'num', ...) o 'timbre' / 'meta';
//   ov = valores alterados que muestra el documento; site = lo que responde el sitio del emisor; tries = intentos (fuente no disponible).
// - detail es una oración completa (mayúscula inicial y punto final) para mostrarse sola. Para anteponer el documento
//   ("Documento: …") se usa VD.frase(doc, detail), que pone la primera letra en minúscula (respeta MINEDUC, CEIM, N°…).
// - aclaracion.motivo va dirigido al postulante ("Envíe …"): es el texto del correo y del motivo de la solicitud.
// - resultadoAgente2: null = al enviar o reanudar, los documentos restantes coinciden; u { stopAt, level, detail, ev }.
// - respuestaFuente (fuente no disponible): 'coincide' o { level, detail, ev } cuando el sitio vuelve a responder.
// - Resueltos con relato propio: razon, pasos [[tipo, texto]] (tipos ok | warn | skip | done | res | rej | clar),
//   tiempos [Agente 1, Agente 2, revisión humana, 'Total …'], notasDocs [[estado, nota]] x4, timeline [[fecha, actor, evento, detalle]].
// - aclaracion: docs pedidos, origen por documento ('a1' señal del Agente 1, 'a2' observación del Agente 2), recibida null | { fecha, docs }.
// - revalidacion: qué devuelven los agentes al revalidar: { resultado: 'ready' } | { resultado: 'a2stop', stopAt, level, detail, ev }.
window.VD_ESCENARIOS = {
  // = TPL de Main.dc.html (campos y valores base de los 4 documentos)
  plantillas: [
    { issuerLine: 'República de Chile · Ministerio de Educación', title: 'Licencia de Enseñanza Media', signer: 'M. Fuentes', fields: [['folio', 'Folio', 'N° 0047731'], ['egreso', 'Año de egreso', '2012'], ['est', 'Establecimiento', 'Liceo Técnico B-12'], ['mod', 'Modalidad', 'Técnico Profesional']] },
    { issuerLine: 'Servicio de Registro Civil e Identificación', title: 'Certificado de Antecedentes', signer: 'Of. Calama', fields: [['folio', 'Folio', '500-128-4471'], ['codigo', 'Código de verificación', '8F3A-21C9-77B0'], ['emision', 'Fecha de emisión', '02 oct 2026'], ['res', 'Resultado', 'Sin antecedentes']] },
    { issuerLine: 'Servicio de Registro Civil e Identificación', title: 'Hoja de Vida del Conductor', signer: 'Of. Calama', fields: [['clase', 'Clase de licencia', 'D'], ['muni', 'Municipalidad', 'Calama'], ['control', 'Próximo control', '15 mar 2029'], ['anot', 'Anotaciones', 'Sin anotaciones']] },
    { issuerLine: 'CEIM', title: 'Certificado CEIM', signer: 'J. Valdés', fields: [['num', 'N° de certificado', 'CEIM-2026-11873'], ['emision', 'Fecha de emisión', '20 sep 2026'], ['vig', 'Vigencia', '20 sep 2028'], ['area', 'Área', 'Operación de equipos']] }
  ],

  casos: {
    // ---------- Pendientes de revisión humana (= cases + EV de Main) ----------
    c1: {
      stopAt: null,
      items: [
        { doc: 1, level: 'Media', detail: 'El código de verificación no sigue el formato estándar del emisor.', conf: 68 },
        { doc: 3, level: 'Alta', detail: 'La firma y el timbre tienen una resolución distinta al resto del documento.', conf: 81 }
      ],
      evidencia: [
        { key: 'codigo', ov: { codigo: 'A7-99X-2K' }, caption: 'Código con formato distinto al estándar del Registro Civil' },
        { key: 'timbre', caption: 'Firma y timbre con resolución distinta al resto del documento' }
      ],
      resultadoAgente2: null
    },
    c4: {
      stopAt: null,
      items: [ { doc: 0, level: 'Alta', detail: 'Un dígito del folio tiene una tipografía distinta al resto.', conf: 74 } ],
      evidencia: [ { key: 'folio', ov: { folio: 'N° 0048731' }, caption: 'Dígito del folio con tipografía distinta' } ],
      resultadoAgente2: null
    },
    c5: {
      stopAt: 1,
      items: [ { doc: 1, level: 'Discrepancia', detail: 'El folio del certificado no existe en el sitio del Registro Civil.', conf: null } ],
      evidencia: [ { key: 'folio', ov: { folio: '500-128-9902' }, site: 'Folio no encontrado', caption: 'Folio inexistente en el sitio del Registro Civil' } ],
      resultadoAgente2: null          // al reanudar: Hoja de vida y CEIM coinciden → listo para conformidad
    },
    c6: {
      stopAt: 2,
      items: [ { doc: 2, level: 'Discrepancia', detail: 'El Registro Civil muestra licencia clase B; el documento indica clase D.', conf: null } ],
      evidencia: [ { key: 'clase', ov: { clase: 'D' }, site: 'Clase B', caption: 'La clase no coincide con el Registro Civil' } ],
      resultadoAgente2: null          // al reanudar: CEIM coincide
    },
    c2: {
      stopAt: 3,
      items: [ { doc: 3, level: 'No disponible', detail: 'El sitio de CEIM no respondió tras 3 intentos. No es una inconsistencia del documento.', conf: null } ],
      evidencia: [ { key: 'num', site: 'Sin respuesta (tiempo de espera agotado)', tries: '3 intentos · último 13 oct 16:28', caption: 'Dato que no se pudo contrastar' } ],
      resultadoAgente2: null,
      respuestaFuente: 'coincide'     // el sitio de CEIM vuelve a responder y el certificado coincide
    },
    c7: {
      stopAt: null,
      items: [
        { doc: 0, level: 'Alta', detail: 'La fecha de egreso fue editada: hay restos de texto bajo el número.', conf: 86 },
        { doc: 2, level: 'Media', detail: 'Los metadatos del PDF indican que fue creado con un editor de imágenes.', conf: 63 }
      ],
      evidencia: [
        { key: 'egreso', ov: { egreso: '2015' }, caption: 'Año de egreso con restos de texto debajo' },
        { key: 'meta', meta: 'Metadatos del PDF · Creado con: editor de imágenes · Modificado: 11 oct 2026', caption: 'El PDF fue generado con un editor de imágenes' }
      ],
      resultadoAgente2: null
    },
    c8: {
      stopAt: 0,
      items: [ { doc: 0, level: 'Discrepancia', detail: 'MINEDUC registra egreso en 2006; el certificado indica 2004.', conf: null } ],
      evidencia: [ { key: 'egreso', ov: { egreso: '2004' }, site: '2006', caption: 'Año de egreso distinto al registrado en MINEDUC' } ],
      resultadoAgente2: null          // al reanudar: los 3 documentos restantes coinciden
    },
    c9: {
      stopAt: null,
      items: [],
      evidencia: [],
      resultadoAgente2: null
    },
    c10: {
      stopAt: 1,
      items: [ { doc: 1, level: 'No disponible', detail: 'El sitio del Registro Civil no respondió tras 3 intentos. No es una inconsistencia del documento.', conf: null } ],
      evidencia: [ { key: 'folio', site: 'Sin respuesta (tiempo de espera agotado)', tries: '3 intentos · último 14 oct 05:11', caption: 'Dato que no se pudo contrastar' } ],
      resultadoAgente2: null,
      // Cuando el sitio responde, el Agente 2 encuentra una discrepancia real y vuelve a detenerse (decide el revisor)
      respuestaFuente: {
        level: 'Discrepancia',
        detail: 'El código de verificación no corresponde al folio registrado en el sitio del Registro Civil.',
        ev: { key: 'codigo', ov: { codigo: '8F3A-21C9-77B1' }, site: '8F3A-21C9-77B0', caption: 'El código no corresponde al registrado por el Registro Civil' }
      }
    },

    // ---------- Resueltos hoy con relato propio (= resolvedCases de Main, ahora por id) ----------
    r01: {   // Benjamín Silva Araya
      nota: '4 de 4 validados · conformidad del revisor',
      razon: 'El Agente 1 no detectó señales y el Agente 2 confirmó los 4 documentos en los sitios de los emisores. El revisor verificó el resumen y dio la conformidad.',
      pasos: [['ok', 'Sin señales'], ['ok', '4 de 4 coinciden'], ['done', 'Dio conformidad'], ['res', 'Conforme']],
      tiempos: ['7 min', '12 min', '13 min', 'Total 32 min'],
      notasDocs: [['Validado', 'Coincide con MINEDUC'], ['Validado', 'Coincide con Registro Civil'], ['Validado', 'Coincide con Registro Civil'], ['Validado', 'Coincide con CEIM']],
      timeline: [
        ['14 oct 08:02', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['14 oct 08:09', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['14 oct 08:21', 'Agente 2', 'Contraste con sitios web', 'Los 4 documentos coinciden; pasa a revisión para la conformidad'],
        ['14 oct 08:34', 'J. Salinas', 'Resultado: Conforme', 'Revisó el resumen de los agentes y dio la conformidad final']
      ]
    },
    r02: {   // Valentina Pérez Contreras
      nota: 'Certificado CEIM: timbre no corresponde al emisor',
      items: [ { doc: 3, level: 'Alta', detail: 'El timbre tiene una resolución distinta al resto del documento.', conf: 84 } ],
      evidencia: [ { key: 'timbre', caption: 'Timbre con resolución distinta al resto del documento' } ],
      razon: 'Certificado CEIM rechazado: el timbre no corresponde al emisor. Se comparó con un certificado original de CEIM y el diseño y la numeración no coinciden.',
      pasos: [['warn', '1 señal'], ['skip', 'No ejecutado'], ['done', 'Rechazó'], ['rej', 'Rechazado']],
      tiempos: ['8 min', '—', '17 h 47 min', 'Total 17 h 55 min'],
      notasDocs: [['Sin señales', 'No se contrastó: el proceso terminó antes del Agente 2'], ['Sin señales', 'No se contrastó'], ['Sin señales', 'No se contrastó'], ['Rechazado', 'Timbre no corresponde al emisor']],
      timeline: [
        ['13 oct 15:10', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 15:18', 'Agente 1', 'Señal detectada', 'Certificado CEIM: timbre con resolución distinta (confianza 84%)'],
        ['14 oct 08:57', 'J. Salinas', 'Revisó la evidencia', 'Abrió la evidencia del Certificado CEIM'],
        ['14 oct 09:05', 'J. Salinas', 'Resultado: Rechazado', 'Rechazó el Certificado CEIM. Motivo: timbre no corresponde al emisor'],
        ['14 oct 09:05', 'Sistema', 'Notificación enviada', 'Se informa la decisión del revisor al equipo de Reclutamiento']
      ]
    },
    r03: {   // Tomás Araya Fuentes
      nota: '1 documento validado manualmente (sitio sin respuesta)',
      razon: 'El sitio del Registro Civil no respondió al validar la Hoja de vida del conductor. El revisor la validó manualmente con el código QR; el Agente 2 terminó el resto sin observaciones y el revisor dio la conformidad final.',
      pasos: [['ok', 'Sin señales'], ['warn', 'Sitio sin respuesta en documento 3 de 4'], ['done', 'Validó manualmente y dio conformidad'], ['res', 'Conforme']],
      tiempos: ['7 min', '16 min', '22 h 17 min', 'Total 22 h 40 min'],
      notasDocs: [['Validado', 'Coincide con MINEDUC'], ['Validado', 'Coincide con Registro Civil'], ['Validado manualmente', 'Sitio sin respuesta; validado con QR'], ['Validado', 'Coincide con CEIM']],
      timeline: [
        ['13 oct 11:40', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 11:47', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['13 oct 12:02', 'Agente 2', 'Sitio sin respuesta en documento 3 de 4', 'Hoja de vida del conductor: el Registro Civil no respondió tras 3 intentos'],
        ['14 oct 10:12', 'J. Salinas', 'Validó manualmente el documento', 'Validado con el código QR'],
        ['14 oct 10:13', 'Agente 2', 'Reanudado y finalizado', 'Certificado CEIM coincide; vuelve a revisión para la conformidad final'],
        ['14 oct 10:20', 'J. Salinas', 'Resultado: Conforme', 'Dio la conformidad final: 3 documentos coinciden y 1 validado manualmente con QR']
      ]
    },
    r04: {   // Constanza Vidal Rojas · en aclaración, esperando respuesta
      nota: 'Se pidió nuevo certificado de antecedentes',
      stopAt: null,
      items: [ { doc: 1, level: 'Media', detail: 'El código de verificación del certificado no es legible.', conf: 66 } ],
      evidencia: [ { key: 'codigo', ov: { codigo: '8F3A-2_C9-7_B0' }, caption: 'Código de verificación ilegible' } ],
      razon: 'El código de verificación del Certificado de antecedentes no es legible. Se pidió a la postulante un certificado reciente descargado desde el sitio del Registro Civil. Plazo de respuesta: 17 oct.',
      pasos: [['warn', '1 señal'], ['skip', 'No iniciado'], ['done', 'Pidió aclaración'], ['clar', 'Observado']],
      tiempos: ['8 min', '—', '1 h 37 min', 'Total 1 h 45 min'],
      notasDocs: [['Sin señales', 'Pendiente de contraste'], ['Aclaración pedida', 'Código de verificación ilegible'], ['Sin señales', 'Pendiente de contraste'], ['Sin señales', 'Pendiente de contraste']],
      timeline: [
        ['14 oct 07:55', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['14 oct 08:03', 'Agente 1', 'Señal detectada', 'Certificado de antecedentes: código de verificación ilegible (confianza 66%)'],
        ['14 oct 09:40', 'J. Salinas', 'Resultado: Aclaración solicitada', 'Pidió un certificado nuevo descargado del Registro Civil'],
        ['14 oct 09:41', 'Sistema', 'Correo enviado a la postulante', 'Plazo: 17 oct. Al recibir el documento, el expediente vuelve a los agentes y la decisión final la toma un revisor']
      ],
      aclaracion: {
        docs: [1], origen: { 1: 'a1' },
        motivo: 'Envíe un Certificado de antecedentes nuevo, descargado del sitio del Registro Civil, con el código de verificación legible',
        solicitada: '2026-10-14 09:40', por: 'J. Salinas', plazo: '2026-10-17',
        recibida: null
      },
      revalidacion: { resultado: 'ready' }     // el certificado nuevo no tiene señales y los 4 documentos coinciden
    },
    r05: {   // Francisca Morales Tapia
      nota: '4 de 4 validados · conformidad del revisor',
      razon: 'Sin señales en el Agente 1 y los 4 documentos coinciden con los sitios de los emisores. El revisor verificó el resumen y dio la conformidad.',
      pasos: [['ok', 'Sin señales'], ['ok', '4 de 4 coinciden'], ['done', 'Dio conformidad'], ['res', 'Conforme']],
      tiempos: ['7 min', '14 min', '24 min', 'Total 45 min'],
      notasDocs: [['Validado', 'Coincide con MINEDUC'], ['Validado', 'Coincide con Registro Civil'], ['Validado', 'Coincide con Registro Civil'], ['Validado', 'Coincide con CEIM']],
      timeline: [
        ['14 oct 09:20', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['14 oct 09:27', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['14 oct 09:41', 'Agente 2', 'Contraste con sitios web', 'Los 4 documentos coinciden; pasa a revisión para la conformidad'],
        ['14 oct 10:05', 'J. Salinas', 'Resultado: Conforme', 'Revisó el resumen de los agentes y dio la conformidad final']
      ]
    },
    r06: {   // Diego Fuentes Castillo
      nota: 'Licencia de enseñanza media: folio inexistente en MINEDUC',
      razon: 'Licencia de enseñanza media rechazada: el folio no existe en el sitio de MINEDUC. Se reintentó la consulta dos veces con el mismo resultado.',
      pasos: [['ok', 'Sin señales'], ['warn', 'Discrepancia en documento 1 de 4'], ['done', 'Rechazó'], ['rej', 'Rechazado']],
      tiempos: ['7 min', '8 min', '24 h 42 min', 'Total 24 h 57 min'],
      notasDocs: [['Rechazado', 'Folio inexistente en MINEDUC'], ['No evaluado', 'El Agente 2 se detuvo antes'], ['No evaluado', 'El Agente 2 se detuvo antes'], ['No evaluado', 'El Agente 2 se detuvo antes']],
      timeline: [
        ['13 oct 09:05', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 09:12', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['13 oct 09:20', 'Agente 2', 'Discrepancia en documento 1 de 4', 'Folio no encontrado en el sitio de MINEDUC'],
        ['14 oct 10:02', 'J. Salinas', 'Resultado: Rechazado', 'Rechazó la Licencia de enseñanza media. Motivo: folio inexistente, consulta reintentada 2 veces'],
        ['14 oct 10:02', 'Sistema', 'Notificación enviada', 'Se informa la decisión del revisor al equipo de Reclutamiento']
      ]
    },
    r07: {   // Cristóbal Herrera Lagos
      nota: '1 señal aprobada por revisor',
      razon: 'La señal en la Hoja de vida del conductor (PDF reexportado) se aprobó porque el contenido coincide con el original. Luego el Agente 2 confirmó los 4 documentos y el revisor dio la conformidad final.',
      pasos: [['ok', 'Señal aprobada'], ['ok', '4 de 4 coinciden'], ['done', 'Aprobó y dio conformidad'], ['res', 'Conforme']],
      tiempos: ['8 min', '8 min', '18 h 6 min', 'Total 18 h 22 min'],
      notasDocs: [['Validado', 'Coincide con MINEDUC'], ['Validado', 'Coincide con Registro Civil'], ['Aprobado por revisor', 'PDF reexportado; datos coinciden'], ['Validado', 'Coincide con CEIM']],
      timeline: [
        ['13 oct 14:30', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 14:38', 'Agente 1', 'Señal detectada', 'Hoja de vida del conductor: metadatos de edición (confianza 58%)'],
        ['14 oct 08:31', 'J. Salinas', 'Aprobó el documento', 'PDF reexportado por el postulante, contenido sin cambios'],
        ['14 oct 08:39', 'Agente 2', 'Contraste con sitios web', 'Los 4 documentos coinciden; vuelve a revisión para la conformidad final'],
        ['14 oct 08:52', 'J. Salinas', 'Resultado: Conforme', 'Dio la conformidad final con 1 señal aprobada']
      ]
    },
    r08: {   // Catalina Rojas Espinoza
      nota: 'Hoja de vida del conductor: clase de licencia no coincide',
      razon: 'Hoja de vida del conductor rechazada: el Registro Civil indica licencia clase B y el documento presentado dice clase D, que es la que exige el cargo.',
      pasos: [['ok', 'Sin señales'], ['warn', 'Discrepancia en documento 3 de 4'], ['done', 'Rechazó'], ['rej', 'Rechazado']],
      tiempos: ['7 min', '13 min', '17 h 17 min', 'Total 17 h 37 min'],
      notasDocs: [['Validado', 'Coincide con MINEDUC'], ['Validado', 'Coincide con Registro Civil'], ['Rechazado', 'Clase de licencia no coincide (B vs D)'], ['No evaluado', 'El Agente 2 se detuvo antes']],
      timeline: [
        ['13 oct 16:15', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 16:22', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['13 oct 16:35', 'Agente 2', 'Discrepancia en documento 3 de 4', 'Registro Civil indica clase B; documento indica clase D'],
        ['14 oct 09:52', 'J. Salinas', 'Resultado: Rechazado', 'Rechazó la Hoja de vida del conductor. Motivo: clase de licencia adulterada'],
        ['14 oct 09:52', 'Sistema', 'Notificación enviada', 'Se informa la decisión del revisor al equipo de Reclutamiento']
      ]
    },

    // ---------- Nuevos casos en aclaración ----------
    r09: {   // Gabriel Méndez Torres · p2 · aclaración RECIBIDA (CEIM v2 solicitado + Hoja de vida v2 no solicitada)
      nota: 'Aclaración recibida: Certificado CEIM nuevo (y una Hoja de vida no solicitada)',
      stopAt: 3,
      items: [ { doc: 3, level: 'Discrepancia', detail: 'El N° de certificado no existe en el sitio de CEIM.', conf: null } ],
      evidencia: [ { key: 'num', ov: { num: 'CEIM-2026-18734' }, site: 'Certificado no encontrado', caption: 'N° de certificado inexistente en el sitio de CEIM' } ],
      razon: 'El Agente 2 no encontró el N° del Certificado CEIM en el sitio de CEIM. El revisor pidió un certificado vigente. El postulante envió la versión 2 del CEIM y, sin que se le pidiera, una nueva Hoja de vida del conductor. Falta que un revisor pida la revalidación.',
      pasos: [['ok', 'Sin señales'], ['warn', 'Discrepancia en documento 4 de 4'], ['done', 'Pidió aclaración'], ['clar', 'Aclaración recibida']],
      tiempos: ['7 min', '14 min', '3 h 49 min', 'Total 4 h 10 min'],
      notasDocs: [['Coincide', 'Coincide con MINEDUC'], ['Coincide', 'Coincide con Registro Civil'], ['Cambio no solicitado · revisar', 'Llegó una versión 2 que no se pidió; no se revalida'], ['Aclaración recibida', 'Versión 2 recibida; pendiente de revalidación']],
      timeline: [
        ['13 oct 11:20', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['13 oct 11:27', 'Agente 1', 'Evaluación documental', 'Sin señales de adulteración'],
        ['13 oct 11:41', 'Agente 2', 'Discrepancia en documento 4 de 4', 'Certificado CEIM: el N° de certificado no existe en el sitio de CEIM'],
        ['13 oct 15:30', 'J. Salinas', 'Resultado: Aclaración solicitada', 'Pidió un Certificado CEIM vigente con N° verificable en el sitio de CEIM'],
        ['13 oct 15:31', 'Sistema', 'Correo enviado al postulante', 'Plazo: 16 oct. Al recibir el documento, los agentes lo detectan y un revisor pide la revalidación'],
        ['14 oct 09:55', 'Sistema', 'Aclaración recibida', 'El postulante envió 2 documentos: Certificado CEIM (versión 2) y Hoja de vida del conductor (versión 2)'],
        ['14 oct 09:56', 'Agente 2', 'Detectó nueva versión de Certificado CEIM', 'Versión 2 solicitada en la aclaración; queda lista para revalidar'],
        ['14 oct 09:56', 'Sistema', 'Documento no solicitado recibido', 'Hoja de vida del conductor (versión 2): no se revalida; queda en el historial del caso']
      ],
      aclaracion: {
        docs: [3], origen: { 3: 'a2' },
        motivo: 'Envíe un Certificado CEIM vigente con N° verificable en el sitio de CEIM',
        solicitada: '2026-10-13 15:30', por: 'J. Salinas', plazo: '2026-10-16',
        recibida: { fecha: '2026-10-14 09:55', docs: [ { doc: 3, solicitado: true }, { doc: 2, solicitado: false } ] }
      },
      revalidacion: { resultado: 'ready' }     // el CEIM v2 existe en el sitio de CEIM → listo para conformidad
    },
    r10: {   // Daniela Cifuentes Ortiz · p3 · aclaración pedida, ESPERANDO respuesta
      nota: 'Se pidió la licencia de enseñanza media emitida por MINEDUC',
      stopAt: null,
      items: [ { doc: 0, level: 'Alta', detail: 'La fecha de egreso tiene restos de texto bajo el número.', conf: 79 } ],
      evidencia: [ { key: 'egreso', ov: { egreso: '2012' }, caption: 'Año de egreso con restos de texto debajo' } ],
      razon: 'La fecha de egreso de la Licencia de enseñanza media tiene restos de texto bajo el número. Se pidió a la postulante la licencia emitida por MINEDUC. Plazo de respuesta: 17 oct.',
      pasos: [['warn', '1 señal'], ['skip', 'No iniciado'], ['done', 'Pidió aclaración'], ['clar', 'Observado']],
      tiempos: ['8 min', '—', '1 h 27 min', 'Total 1 h 35 min'],
      notasDocs: [['Aclaración pedida', 'Fecha de egreso con restos de texto'], ['Sin señales', 'Pendiente de contraste'], ['Sin señales', 'Pendiente de contraste'], ['Sin señales', 'Pendiente de contraste']],
      timeline: [
        ['14 oct 07:10', 'Sistema', 'Ingreso de carpeta', '4 documentos identificados'],
        ['14 oct 07:18', 'Agente 1', 'Señal detectada', 'Licencia de enseñanza media: fecha de egreso con restos de texto (confianza 79%)'],
        ['14 oct 08:45', 'J. Salinas', 'Resultado: Aclaración solicitada', 'Pidió la Licencia de enseñanza media emitida por MINEDUC'],
        ['14 oct 08:46', 'Sistema', 'Correo enviado a la postulante', 'Plazo: 17 oct. Al recibir el documento, los agentes lo detectan y un revisor pide la revalidación']
      ],
      aclaracion: {
        docs: [0], origen: { 0: 'a1' },
        motivo: 'Envíe la Licencia de enseñanza media emitida por MINEDUC, sin correcciones en la fecha de egreso',
        solicitada: '2026-10-14 08:45', por: 'J. Salinas', plazo: '2026-10-17',
        recibida: null
      },
      // La versión 2 no tiene señales, pero el Agente 2 se detiene: MINEDUC registra otro año de egreso
      revalidacion: {
        resultado: 'a2stop', stopAt: 0, level: 'Discrepancia',
        detail: 'MINEDUC registra egreso en 2011; la licencia (versión 2) indica 2012.',
        ev: { key: 'egreso', ov: { egreso: '2012' }, site: '2011', caption: 'Año de egreso distinto al registrado en MINEDUC' }
      }
    }
  },

  // "Iniciar evaluación": se recorre en orden y se repite por cada expediente que pasa de none a rev
  patronesEvaluacion: ['ready', 'ready', 'a1Alta', 'ready', 'a2Off', 'ready', 'a1Media', 'ready', 'a2Disc', 'ready', 'ready', 'ready'],

  // Señales y observaciones genéricas para los expedientes evaluados en la demo (items + evidencia alineados)
  señalesGenericas: {
    a1Alta: {
      items: [ { doc: 0, level: 'Alta', detail: 'Un dígito del folio tiene una tipografía distinta al resto.', conf: 77 } ],
      evidencia: [ { key: 'folio', ov: { folio: 'N° 0041731' }, caption: 'Dígito del folio con tipografía distinta' } ]
    },
    a1Media: {
      items: [ { doc: 2, level: 'Media', detail: 'Los metadatos del PDF indican que fue reexportado con un editor de imágenes.', conf: 61 } ],
      evidencia: [ { key: 'meta', meta: 'Metadatos del PDF · Creado con: editor de imágenes · Modificado: 13 oct 2026', caption: 'El PDF fue generado con un editor de imágenes' } ]
    },
    a2Off: {
      stopAt: 3,
      items: [ { doc: 3, level: 'No disponible', detail: 'El sitio de CEIM no respondió tras 3 intentos. No es una inconsistencia del documento.', conf: null } ],
      evidencia: [ { key: 'num', site: 'Sin respuesta (tiempo de espera agotado)', tries: '3 intentos', caption: 'Dato que no se pudo contrastar' } ],
      respuestaFuente: 'coincide'
    },
    a2Disc: {
      stopAt: 1,
      items: [ { doc: 1, level: 'Discrepancia', detail: 'El folio del certificado no existe en el sitio del Registro Civil.', conf: null } ],
      evidencia: [ { key: 'folio', ov: { folio: '500-128-7310' }, site: 'Folio no encontrado', caption: 'Folio inexistente en el sitio del Registro Civil' } ],
      resultadoAgente2: null
    }
  }
};
