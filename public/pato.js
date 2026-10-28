/* El pato de Multiverso Norte, v2 (2026-10-19): estilo de los cortos clásicos de los años 40.
   No anda: para ir lejos ARRANCA (anticipación + piernas en rueda), sale disparado dejando una nube de polvo, corre y
   DERRAPA al frenar; para distancias cortas va de PUNTILLAS. Si lo coges cuelga del cogote pataleando; si lo lanzas
   vuela en pánico y al caer se estampa y se marea. Quieto se impacienta; sin ratón un rato, se duerme en una esquina.
   Saluda al llegar y hace una «doble toma» si el puntero pasa rapidísimo por delante. Sin dependencias.
   Hojas en /img/pato2/<accion>-<320|160>.webp (rejilla), manifiesto en MN.pato (gen/pato2/publicar.py).
   Revisado con pruebas en navegador real (23 fallos corregidos el 2026-10-19: ver docs/PATO2-ANIMACIONES.md). */
(function () {
  'use strict';
  var cfg = (window.MN && window.MN.pato) || null;
  var debug = /[?&]pato=debug/.test(location.search);
  var motivos = [];
  function diag(m) { motivos.push(m); if (debug) console.log('[pato]', m); }
  if (debug) {
    var caja = document.createElement('pre');
    caja.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;background:#111b36;color:#fff;font:12px/1.4 monospace;padding:10px 12px;border-radius:8px;max-width:90vw;white-space:pre-wrap';
    document.body.appendChild(caja);
    setInterval(function () {
      caja.textContent = ['PATO v2 debug'].concat(motivos).concat([
        'reduced-motion: ' + window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        'estado: ' + (window.__pato ? window.__pato.estado() + ' / ' + window.__pato.accion() + ' / visible ' + window.__pato.visible() : 'sin arrancar'),
        'navegador: ' + navigator.userAgent.slice(0, 80)
      ]).join(String.fromCharCode(10));
    }, 500);
  }
  var toggle = document.getElementById('pato-esconder');
  if (!cfg || !cfg.acciones) { diag('sin configuración MN.pato'); return; }
  var escondido = false;
  try { escondido = localStorage.getItem('mn-pato') === 'no'; } catch (e) { diag('localStorage sin acceso'); }
  if (escondido) {
    // el enlace del pie sirve para traerlo de vuelta (antes solo añadía «#» a la URL)
    diag('escondido por el usuario');
    var r0 = document.getElementById('pato'); if (r0) r0.remove();
    if (toggle) {
      toggle.textContent = 'Traer al pato';
      toggle.addEventListener('click', function (e) { e.preventDefault(); try { localStorage.removeItem('mn-pato'); } catch (err) {} location.reload(); });
    }
    return;
  }
  var quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (quieto) diag('prefers-reduced-motion: el pato se queda dormido en la esquina, sin moverse');

  var raiz = document.getElementById('pato');
  if (!raiz) return;
  var sprite = raiz.querySelector('.pato-sprite');
  var sombra = raiz.querySelector('.pato-sombra');
  var agarre = raiz.querySelector('.pato-agarre');

  /* tamaños: la caja es cuadrada y el pato ocupa ~2/3 de su alto (el resto es sitio para los efectos) */
  var MOVIL = window.innerWidth < 640;
  var TAM = MOVIL ? 108 : 192;
  // hoja: la más pequeña que no se vea ampliada en esta pantalla (en 2D las líneas negras se notan borrosas si se amplían)
  var TAMANOS = (cfg.tamanos && cfg.tamanos.length ? cfg.tamanos : [160, 320]).slice().sort(function (a, b) { return a - b; });
  var HOJA = (function () {
    var hace = TAM * Math.min(window.devicePixelRatio || 1, 3) * 0.9;
    for (var k = 0; k < TAMANOS.length; k++) if (TAMANOS[k] >= hace) return TAMANOS[k];
    return TAMANOS[TAMANOS.length - 1];
  })();
  var FPS = cfg.fps || 12;
  var AFK_MS = cfg.afkMs || 20000;
  try { var afkPrueba = Number(localStorage.getItem('mn-pato-afk')); if (afkPrueba > 0) AFK_MS = afkPrueba; } catch (e) {}
  var PIES = [0.52, 0.88];                     // dónde están los pies dentro del cuadro (u, v)
  var ANCLA = { colgado: [0.5, 0.15], volando: [0.5, 0.5] };
  var COLGADO_BAJO = 0.67;                     // lo que cuelga el cuerpo por debajo del cogote (fracción de TAM)
  var VEL_CORRER = MOVIL ? 620 : 900;          // px/s
  // de puntillas va a la velocidad a la que su pie apoyado retrocede en el dibujo (así no patina): fracción de TAM por segundo
  var VEL_PUNTILLAS = cfg.acciones && cfg.acciones.puntillas && cfg.acciones.puntillas.avance ? cfg.acciones.puntillas.avance * TAM : (MOVIL ? 80 : 110);
  var LEJOS = MOVIL ? 110 : 170;               // más que esto → arranca y corre; menos → puntillas (de puntillas va despacio)
  var CERCA = MOVIL ? 30 : 50;
  var T_FRENO = 5 / FPS;                        // el frenazo frena en sus 5 primeros fotogramas
  var DIST_FRENO = VEL_CORRER * T_FRENO / 2;
  var GRAVEDAD = 2600;
  var UMBRAL_LANZAR = 650;
  var ESPACIO = MOVIL ? 70 : 110;
  var IMPACIENTE_MS = 9000;
  raiz.style.width = raiz.style.height = TAM + 'px';

  /* hojas: las de la entrada primero; el resto cuando termina la entrada */
  var hojas = {};
  function urlHoja(n) { return cfg.base + '/' + n + '-' + HOJA + '.webp' + (cfg.v ? '?v=' + cfg.v : ''); }
  function hoja(n) {
    if (!hojas[n]) {
      var im = new Image(); im.src = urlHoja(n); hojas[n] = im;
      im.addEventListener('error', function () { diag('no se pudo cargar ' + n); });
    }
    return hojas[n];
  }
  function lista(n) { var im = hoja(n); return im.complete && im.naturalWidth > 0; }
  var ENTRADA = quieto ? ['dormir'] : ['carrera', 'frenazo', 'saludo', 'reposo', 'fx_derrape', 'arranque', 'fx_polvo'];
  ENTRADA.forEach(hoja);
  var restoPedido = false;
  function pedirResto() { if (restoPedido) return; restoPedido = true; Object.keys(cfg.acciones).forEach(hoja); }

  /* estado: P = punto de anclaje en la ventana (x desde la izquierda, y desde arriba) */
  var p = { x: -TAM, y: window.innerHeight, vx: 0, vy: 0, dir: 1, rot: 0, estado: 'fuera', ancla: PIES, visible: false };
  var accion = null, tAccion = 0, fotograma = -1, alTerminar = null, pendiente = null;
  var puntero = { x: window.innerWidth * 0.4, y: window.innerHeight * 0.5 };
  var ultimoMov = performance.now(), ultimaToma = -Infinity;
  var arrastre = null, muestras = [], freno = null, esperaVuelta = 0, yaSaludo = false, apagado = false, rafId = 0;
  var pasoPuntillas = -1, metaPuntillas = 0;
  try { yaSaludo = sessionStorage.getItem('mn-pato-saludo') === '1'; } catch (e) {}

  function aplicarHoja(n) {
    var a = cfg.acciones[n];
    sprite.style.backgroundImage = 'url(' + urlHoja(n) + ')';
    sprite.style.backgroundSize = (a.cols * TAM) + 'px auto';
    sprite.style.backgroundPosition = '0px 0px';
  }
  function poner(n, fin) {
    var a = cfg.acciones[n]; if (!a) { diag('falta la acción ' + n); return; }
    accion = n; tAccion = 0; fotograma = 0; alTerminar = fin || null; pasoPuntillas = -1;
    // si la hoja aún no ha llegado, se queda la anterior (antes el pato desaparecía en conexiones lentas)
    if (lista(n)) { pendiente = null; aplicarHoja(n); }
    else { pendiente = n; hoja(n).addEventListener('load', function () { if (pendiente === n) { pendiente = null; aplicarHoja(n); } }, { once: true }); }
  }
  function pintar(dt) {
    var a = cfg.acciones[accion]; if (!a) return;
    if (pendiente) return;                          // esperando la hoja: no avanza el tiempo de la acción
    tAccion += dt;
    var i = Math.floor(tAccion * FPS);
    if (a.bucle) i = i % a.fotogramas;
    else if (i >= a.fotogramas) { i = a.fotogramas - 1; if (alTerminar) { var f = alTerminar; alTerminar = null; f(); return; } }
    if (i !== fotograma) {
      fotograma = i;
      sprite.style.backgroundPosition = (-(i % a.cols) * TAM) + 'px ' + (-Math.floor(i / a.cols) * TAM) + 'px';
    }
  }
  function anchoVentana() { return document.documentElement.clientWidth; }
  // el suelo, un poco por encima del borde: el pie de la cámara baja hasta el 92 % del cuadro y se cortaba
  function suelo() { return window.innerHeight - Math.round(0.04 * TAM); }
  function mostrar(v) { p.visible = v; raiz.style.visibility = v ? 'visible' : 'hidden'; }
  function minX() { return TAM * 0.35; }
  function maxX() { return anchoVentana() - TAM * 0.35; }
  // cambiar el punto de anclaje sin que la caja salte
  function anclar(nueva) {
    var bx = p.x - p.ancla[0] * TAM, by = p.y - p.ancla[1] * TAM;
    p.ancla = nueva; p.x = bx + nueva[0] * TAM; p.y = by + nueva[1] * TAM;
    sprite.style.transformOrigin = (nueva[0] * 100) + '% ' + (nueva[1] * 100) + '%';
  }

  /* efectos que se quedan en el suelo (polvo de salida, derrape, impacto) */
  function efecto(n, x, dir) {
    var a = cfg.acciones[n]; if (!a || quieto || apagado || !lista(n)) return;
    if (x < -TAM * 0.3 || x > anchoVentana() + TAM * 0.3) return;     // fuera de la pantalla no se ve: no se pone
    var d = document.createElement('div');
    d.className = 'pato-fx';
    d.style.width = d.style.height = TAM + 'px';
    d.style.backgroundImage = 'url(' + urlHoja(n) + ')';
    d.style.backgroundSize = (a.cols * TAM) + 'px auto';
    d.style.transform = 'translate3d(' + Math.round(x - PIES[0] * TAM) + 'px,' + Math.round(suelo() - PIES[1] * TAM) + 'px,0) scaleX(' + dir + ')';
    document.body.appendChild(d);
    var t0 = performance.now();
    (function cuadro() {
      var i = Math.floor((performance.now() - t0) / 1000 * FPS);
      if (apagado || i >= a.fotogramas) { d.remove(); return; }
      d.style.backgroundPosition = (-(i % a.cols) * TAM) + 'px ' + (-Math.floor(i / a.cols) * TAM) + 'px';
      requestAnimationFrame(cuadro);
    })();
  }

  /* destino: al lado del puntero (no debajo), o la esquina si está AFK */
  function objetivo() {
    var lado = p.x < puntero.x ? -1 : 1;
    var d = ESPACIO + (puntero.y > window.innerHeight - TAM ? 70 : 0);
    return Math.max(minX(), Math.min(maxX(), puntero.x + lado * d));
  }
  function esquina() {
    if (MOVIL) return anchoVentana() - TAM * 0.4;
    return p.x < anchoVentana() / 2 ? TAM * 0.4 : anchoVentana() - TAM * 0.4;
  }
  function afk(ahora) { return ahora - ultimoMov > AFK_MS; }
  function destino(ahora) { return afk(ahora) ? esquina() : objetivo(); }
  // el puntero está «encima» del pato: dentro de su ancho y por encima, cerca (no lo esquiva: así se le puede coger)
  function punteroEncima() {
    return Math.abs(puntero.x - p.x) < TAM * 0.4 && puntero.y < suelo() - TAM * 0.2 && puntero.y > suelo() - TAM * 2.6;
  }

  /* transiciones */
  function enSuelo(estado, n) { if (p.ancla !== PIES) anclar(PIES); p.rot = 0; p.estado = estado; raiz.classList.remove('vuela'); poner(n || estado); }
  function aReposo() { raiz.classList.remove('duerme'); enSuelo('reposo'); pedirResto(); }
  function arrancar(dir) {
    p.dir = dir; enSuelo('arranque');
    poner('arranque', function () {
      // si mientras se agachaba el destino ha quedado detrás, no sale corriendo hacia el lado equivocado
      var resto = (destino(performance.now()) - p.x) * p.dir;
      if (resto <= DIST_FRENO) { aReposo(); return; }
      efecto('fx_polvo', p.x, p.dir); p.estado = 'carrera'; p.vx = VEL_CORRER * p.dir; poner('carrera');
    });
  }
  function frenar(resto) {
    // la velocidad del derrape sale de lo que le queda por recorrer: frena justo en el destino y nunca de golpe
    var v0 = Math.min(Math.abs(p.vx) || VEL_CORRER, 2 * Math.max(resto, 0) / T_FRENO) * p.dir;
    var x0 = p.x, xF = Math.max(minX(), Math.min(maxX(), x0 + v0 * T_FRENO / 2));
    freno = { t0: performance.now(), x0: x0, xF: xF };
    p.vx = 0; p.estado = 'frenazo'; poner('frenazo', tras);
    efecto('fx_derrape', x0, p.dir);
  }
  function tras() {
    // al quedarse quieto: saluda la primera vez; si no, reposo
    if (!yaSaludo && !afk(performance.now())) {
      yaSaludo = true; try { sessionStorage.setItem('mn-pato-saludo', '1'); } catch (e) {}
      p.estado = 'saludo'; poner('saludo', aReposo); return;
    }
    if (afk(performance.now()) && Math.abs(esquina() - p.x) < 14) { dormir(); return; }
    aReposo();
  }
  function dormir() { enSuelo('dormir'); raiz.classList.add('duerme'); }
  function despertar() {
    if (p.estado !== 'dormir' || quieto) return;
    raiz.classList.remove('duerme'); p.estado = 'despertar'; poner('despertar', aReposo);
  }
  function toma() { if (cfg.acciones.toma) { p.estado = 'toma'; poner('toma', aReposo); ultimaToma = performance.now(); } }
  function lanzar(vx, vy) {
    vx = Math.max(-1500, Math.min(1500, vx)); vy = Math.max(-1300, Math.min(400, vy));
    anclar(ANCLA.volando); p.estado = 'volando'; p.vx = vx; p.vy = vy; raiz.classList.add('vuela'); poner('volando');
  }
  function aterrizar() {
    var x = Math.max(minX(), Math.min(maxX(), p.x));   // nunca aterriza fuera de la pantalla
    anclar(PIES); p.x = x; p.y = suelo(); p.vx = 0; p.vy = 0; p.rot = 0;
    raiz.classList.remove('vuela');
    p.estado = 'aterrizaje'; poner('aterrizaje', aReposo);
    efecto('fx_impacto', p.x, p.dir);
  }
  function irse() { mostrar(false); raiz.classList.remove('vuela'); p.estado = 'fuera'; esperaVuelta = performance.now() + 1500; }
  function volver() {
    var W = anchoVentana();
    anclar(PIES); p.rot = 0; p.y = suelo();
    var desdeIzq = puntero.x > W / 2;            // entra por el lado contrario al puntero: cruza corriendo
    p.x = desdeIzq ? -TAM * 0.5 : W + TAM * 0.5; p.dir = desdeIzq ? 1 : -1;
    mostrar(true); p.estado = 'carrera'; p.vx = VEL_CORRER * p.dir; poner('carrera');
  }

  /* dibujar (también se llama al cambiar el tamaño de la ventana en modo quieto) */
  function dibujar() {
    raiz.style.transform = 'translate3d(' + Math.round(p.x - p.ancla[0] * TAM) + 'px,' + Math.round(p.y - p.ancla[1] * TAM) + 'px,0)';
    sprite.style.transform = 'scaleX(' + p.dir + ') rotate(' + (p.rot * p.dir).toFixed(1) + 'deg)';
    // sombra: siempre en el suelo (coordenadas de la caja) y más pequeña cuanto más alto va el pato
    var sueloEnCaja = suelo() - (p.y - p.ancla[1] * TAM);
    var alto = Math.max(0, sueloEnCaja - PIES[1] * TAM);
    var s = Math.max(0.3, 1 - alto / 400);
    sombra.style.transform = 'translate(' + Math.round(PIES[0] * TAM) + 'px,' + Math.round(sueloEnCaja) + 'px) scale(' + s.toFixed(2) + ')';
    sombra.style.opacity = (0.32 * s).toFixed(2);
  }

  /* bucle */
  var ultimo = performance.now();
  function paso(ahora) {
    if (apagado) return;
    var dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora;
    var W = anchoVentana();
    switch (p.estado) {
      case 'fuera':
        if (ahora >= esperaVuelta) volver();
        break;
      case 'colgado': {
        // del sitio donde lo cogiste al cogote bajo el puntero, sin salto (150 ms); el cuerpo no se hunde en el suelo
        var k = Math.max(0, 1 - (ahora - arrastre.t0) / 150);
        p.x = arrastre.x + arrastre.ox * k; p.y = arrastre.y + arrastre.oy * k;
        p.y = Math.min(p.y, suelo() - COLGADO_BAJO * TAM);
        break;
      }
      case 'volando':
        p.vy += GRAVEDAD * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vx * dt * 0.5;
        // rebota en los lados salvo que vaya lo bastante rápido para salir
        if (p.x < TAM * 0.3 && p.vx < 0 && p.vx > -700) p.vx = -p.vx * 0.5;
        if (p.x > W - TAM * 0.3 && p.vx > 0 && p.vx < 700) p.vx = -p.vx * 0.5;
        if (p.x < -TAM || p.x > W + TAM) irse();
        else if (p.vy > 0 && p.y + (PIES[1] - 0.5) * TAM >= suelo()) aterrizar();
        break;
      case 'carrera': {
        var resto = (destino(ahora) - p.x) * p.dir;
        p.x += p.vx * dt;
        var dentro = p.x >= minX() && p.x <= maxX();
        // frena solo cuando ya está en la pantalla (si no, en el móvil derrapaba fuera y aparecía de golpe)
        if (dentro && resto <= DIST_FRENO) frenar(resto);
        break;
      }
      case 'frenazo': {
        var t = Math.min((ahora - freno.t0) / 1000, T_FRENO);
        var u = t / T_FRENO;                       // desacelera hasta pararse en xF
        p.x = freno.x0 + (freno.xF - freno.x0) * (2 * u - u * u);
        break;
      }
      case 'puntillas': {
        var dP = destino(ahora) - p.x;
        if (!afk(ahora) && punteroEncima()) { tras(); break; }
        if (Math.abs(dP) > LEJOS) { arrancar(dP > 0 ? 1 : -1); break; }
        if (Math.abs(dP) < 6) { tras(); break; }
        p.dir = dP > 0 ? 1 : -1;
        metaPuntillas = destino(ahora);             // avanza en pintar(), a saltos con cada dibujo
        break;
      }
      case 'reposo': case 'impaciente': case 'mirar': {
        var encima = !afk(ahora) && punteroEncima();
        var dR = destino(ahora) - p.x;
        if (!encima) {
          if (Math.abs(dR) > LEJOS) { arrancar(dR > 0 ? 1 : -1); break; }
          if (Math.abs(dR) > CERCA) { p.estado = 'puntillas'; p.dir = dR > 0 ? 1 : -1; poner('puntillas'); break; }
        }
        if (afk(ahora)) { dormir(); break; }
        p.dir = puntero.x >= p.x ? 1 : -1;
        var quiere = ahora - ultimoMov > IMPACIENTE_MS ? 'impaciente' : (encima ? 'mirar' : 'reposo');
        if (quiere !== p.estado) { p.estado = quiere; poner(quiere); }
        break;
      }
      default: /* arranque, aterrizaje, despertar, toma, saludo, dormir: quietos mientras dura la acción */
        break;
    }
    pintar(dt);
    // de puntillas: avanza lo mismo que retrocede el pie apoyado en el dibujo, justo cuando cambia el dibujo (así no patina
    // ni tiembla entre dibujos)
    if (p.estado === 'puntillas' && fotograma !== pasoPuntillas) {
      pasoPuntillas = fotograma;
      p.x += p.dir * Math.min(Math.abs(metaPuntillas - p.x), VEL_PUNTILLAS / FPS);
    }
    dibujar();
    rafId = requestAnimationFrame(paso);
  }

  /* entrada */
  function registrar(x, y, t) {
    t = t || performance.now(); muestras.push({ x: x, y: y, t: t });
    while (muestras.length && t - muestras[0].t > 120) muestras.shift();
  }
  var ultimoPunto = null;
  function alMover(e) {
    if (quieto || apagado) return;
    var ahora = performance.now();
    if (arrastre) {
      if (e.pointerId !== arrastre.id) return;      // un segundo dedo no se lleva el pato
      arrastre.x = e.clientX; arrastre.y = e.clientY; registrar(e.clientX, e.clientY, ahora);
    }
    // doble toma: el puntero pasa rapidísimo cerca de él
    if (!arrastre && ultimoPunto && (p.estado === 'reposo' || p.estado === 'impaciente' || p.estado === 'mirar') && ahora - ultimaToma > 12000) {
      var dtp = (ahora - ultimoPunto.t) / 1000;
      var vel = dtp > 0 ? Math.hypot(e.clientX - ultimoPunto.x, e.clientY - ultimoPunto.y) / dtp : 0;
      if (vel > 3000 && Math.abs(e.clientX - p.x) < TAM && e.clientY > suelo() - TAM * 2) toma();
    }
    ultimoPunto = { x: e.clientX, y: e.clientY, t: ahora };
    if (!arrastre) { puntero.x = e.clientX; puntero.y = e.clientY; }
    ultimoMov = ahora;
    if (p.estado === 'dormir') despertar();
  }
  function alTocar(e) {
    if (quieto || apagado || arrastre) return;
    if (e.target.closest && e.target.closest('#pato')) return;
    if (e.pointerType === 'touch') { puntero.x = e.clientX; puntero.y = e.clientY; ultimoMov = performance.now(); if (p.estado === 'dormir') despertar(); }
  }
  function alCoger(e) {
    if (quieto || apagado || arrastre || p.estado === 'fuera' || p.estado === 'volando') return;
    e.preventDefault();
    agarre.setPointerCapture(e.pointerId);
    raiz.classList.remove('duerme'); raiz.classList.add('agarrado', 'vuela');
    anclar(ANCLA.colgado);                          // la caja no se mueve; el cogote va hacia el puntero poco a poco
    arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: p.x - e.clientX, oy: p.y - e.clientY, t0: performance.now() };
    muestras = []; registrar(e.clientX, e.clientY);
    p.rot = 0; p.estado = 'colgado'; poner('colgado'); pedirResto();
  }
  function soltar(e) {
    if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
    raiz.classList.remove('agarrado');
    // la velocidad con la que se suelta: solo cuenta el movimiento de los últimos 100 ms (si lo sostienes quieto y
    // lo sueltas, cae; antes salía lanzado con la velocidad de un tirón anterior)
    var ahora = performance.now();
    if (e && e.type === 'pointerup') registrar(e.clientX, e.clientY, ahora);   // pointercancel puede traer (0, 0)
    while (muestras.length && ahora - muestras[0].t > 100) muestras.shift();
    var a = muestras[0], b = muestras[muestras.length - 1], vx = 0, vy = 0;
    if (a && b && b.t - a.t > 16) { var dtm = (b.t - a.t) / 1000; vx = (b.x - a.x) / dtm; vy = (b.y - a.y) / dtm; }
    arrastre = null;
    if (Math.hypot(vx, vy) > UMBRAL_LANZAR) lanzar(vx, Math.min(vy, -200));
    else lanzar(vx * 0.3, Math.max(vy * 0.3, 0));
    ultimoMov = performance.now();
  }
  function alRedimensionar() {
    if (p.x > anchoVentana()) p.x = maxX();
    if (p.ancla === PIES && p.estado !== 'volando') p.y = suelo();
    if (quieto) { p.x = anchoVentana() - TAM * 0.4; p.y = suelo(); dibujar(); }
  }
  function alVolver() { ultimo = performance.now(); }
  window.addEventListener('pointermove', alMover, { passive: true });
  window.addEventListener('pointerdown', alTocar, { passive: true });
  agarre.addEventListener('pointerdown', alCoger);
  agarre.addEventListener('pointerup', soltar);
  agarre.addEventListener('pointercancel', soltar);
  window.addEventListener('resize', alRedimensionar);
  document.addEventListener('visibilitychange', alVolver);

  /* arranque: entra corriendo desde fuera, derrapa y la primera vez en la sesión saluda */
  function empezar() {
    if (apagado) return;
    if (quieto) {
      p.x = anchoVentana() - TAM * 0.4; p.y = suelo(); p.dir = -1; p.estado = 'dormir';
      poner('dormir'); raiz.classList.add('duerme'); mostrar(true); dibujar();
      agarre.style.cursor = 'default';
      return;
    }
    p.y = suelo();
    var W = anchoVentana();
    // sale de lejos para que la carrera se vea antes del derrape (en el móvil no le daba tiempo)
    if (MOVIL) { p.x = W + TAM * 0.5; p.dir = -1; puntero.x = Math.max(TAM, W * 0.35); }
    else { p.x = -TAM * 0.5; p.dir = 1; puntero.x = Math.min(W * 0.4, 520); }
    mostrar(true); p.estado = 'carrera'; p.vx = VEL_CORRER * p.dir; poner('carrera');
    ultimo = performance.now(); ultimoMov = performance.now();
    rafId = requestAnimationFrame(paso);
    setTimeout(pedirResto, 6000);
  }
  // espera a que estén las hojas de la entrada (carrera, frenazo y saludo) o, como mucho, 4 s
  var esperaDesde = performance.now();
  (function esperar() {
    var listas = quieto ? lista('dormir') : (lista('carrera') && lista('frenazo') && lista('saludo'));
    if (listas || performance.now() - esperaDesde > 4000) setTimeout(empezar, 300);
    else setTimeout(esperar, 100);
  })();
  /* sonda para pruebas automáticas (solo lectura) */
  window.__pato = { estado: function () { return p.estado; }, x: function () { return p.x; }, y: function () { return p.y; }, accion: function () { return accion; }, visible: function () { return p.visible; }, version: 2 };

  /* esconder: se apaga del todo (bucle, eventos y efectos) */
  if (toggle) toggle.addEventListener('click', function (e) {
    e.preventDefault(); try { localStorage.setItem('mn-pato', 'no'); } catch (err) {}
    apagado = true; cancelAnimationFrame(rafId);
    window.removeEventListener('pointermove', alMover); window.removeEventListener('pointerdown', alTocar);
    window.removeEventListener('resize', alRedimensionar); document.removeEventListener('visibilitychange', alVolver);
    document.querySelectorAll('.pato-fx').forEach(function (d) { d.remove(); });
    raiz.remove(); toggle.textContent = 'El pato se ha ido a dormir a la trastienda.';
  });
})();
