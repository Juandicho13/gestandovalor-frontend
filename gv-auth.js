/*
 * GestandoValor · sesión y llamadas protegidas
 * ------------------------------------------------------------------
 * Se carga UNA vez por página, antes que Alpine. Hace cinco cosas:
 *   1. Guarda y lee el token de la sesión.
 *   2. Le pone la cabecera Authorization a toda llamada a nuestra API.
 *   3. Si el servidor responde 401, cierra la sesión y manda al login.
 *   4. Hace que cada pestaña recuerde con quién entró.
 *   5. Deja una hoja de estilos propia de primera en la página (la necesita
 *      el calendario en iPad y tablets, abajo está explicado por qué).
 *
 * Por qué cabecera y no cookie: el sitio vive en gestandovalor.com y la API
 * en onrender.com. Son dominios distintos, y Safari bloquea las cookies de
 * terceros por defecto, así que una sesión por cookie simplemente no
 * funcionaría ahí. Con Bearer funciona igual en Safari, Chrome y Firefox.
 *
 * Por qué una sesión por pestaña: localStorage lo comparten TODAS las pestañas
 * del navegador. Si en una entrabas como Ricardo y en otra como Pipe, la última
 * pisaba a la primera y al recargar salía el otro usuario. Ahora cada pestaña
 * guarda su copia en sessionStorage (sobrevive a recargar, pero es solo de esa
 * pestaña). localStorage sigue guardando la última sesión, para que una pestaña
 * nueva o el celular al reabrir ya entren sin pedir la clave.
 */
(function () {
    'use strict';

    var API = 'https://gestandovalor-backend.onrender.com';

    // ✨ Calendario en iPad y tablets
    // Cuando el calendario de 2 meses no cabe ni a la izquierda ni a la derecha del campo
    // de fechas, flatpickr lo centra escribiendo una regla en la PRIMERA hoja de estilos de
    // la página. Esa primera hoja era la del CDN de flatpickr, que es de otro dominio, y el
    // navegador no deja escribir ahí: salía un error y el calendario quedaba medio por fuera
    // de la pantalla. Con esta hoja vacía de primera, flatpickr escribe aquí y queda centrado.
    try {
        if (!document.getElementById('gv-estilos-propios')) {
            var hoja = document.createElement('style');
            hoja.id = 'gv-estilos-propios';
            document.head.insertBefore(hoja, document.head.firstChild);
        }
    } catch (e) { }

    // Safari en modo privado puede lanzar excepción al tocar el almacenamiento.
    // Todo acceso va envuelto para que la página nunca se caiga por esto.
    function leer(clave) {
        try { return window.localStorage.getItem(clave); } catch (e) { return null; }
    }
    function escribir(clave, valor) {
        try { window.localStorage.setItem(clave, valor); return true; } catch (e) { return false; }
    }
    function borrar(clave) {
        try { window.localStorage.removeItem(clave); } catch (e) { }
    }
    function leerPestana(clave) {
        try { return window.sessionStorage.getItem(clave); } catch (e) { return null; }
    }
    function escribirPestana(clave, valor) {
        try { window.sessionStorage.setItem(clave, valor); } catch (e) { }
    }
    function borrarPestana(clave) {
        try { window.sessionStorage.removeItem(clave); } catch (e) { }
    }

    // ✨ Al abrir o recargar: cada pestaña se queda con SU usuario
    var tokenPestana = leerPestana('gv_token');
    var usuarioPestana = leerPestana('gv_usuario_actual');
    if (tokenPestana && usuarioPestana) {
        // Esta pestaña ya había entrado. La devolvemos al almacén compartido para que
        // la página, que lee localStorage al arrancar, vea a quien entró AQUÍ.
        escribir('gv_token', tokenPestana);
        escribir('gv_usuario_actual', usuarioPestana);
    } else if (leer('gv_token') && leer('gv_usuario_actual')) {
        // Pestaña nueva: arranca con la última sesión que se abrió en este navegador
        escribirPestana('gv_token', leer('gv_token'));
        escribirPestana('gv_usuario_actual', leer('gv_usuario_actual'));
    }

    window.gvToken = function () { return leerPestana('gv_token') || leer('gv_token'); };

    window.gvUsuario = function () {
        try {
            return JSON.parse(leerPestana('gv_usuario_actual') || leer('gv_usuario_actual') || 'null');
        } catch (e) { return null; }
    };

    window.gvGuardarSesion = function (token, usuario) {
        var datos = JSON.stringify(usuario || {});
        escribir('gv_token', token || '');
        escribir('gv_usuario_actual', datos);
        escribirPestana('gv_token', token || '');
        escribirPestana('gv_usuario_actual', datos);
    };

    window.gvSalir = function (motivo) {
        var mio = leerPestana('gv_token');
        // La sesión compartida solo se borra si es la de esta pestaña, no la de otro usuario
        if (!mio || leer('gv_token') === mio) {
            borrar('gv_token');
            borrar('gv_usuario_actual');
        }
        borrarPestana('gv_token');
        borrarPestana('gv_usuario_actual');
        // Avisamos a las otras pestañas de ESTE mismo usuario para que también salgan
        if (mio) {
            escribir('gv_salida', huella(mio) + '|' + Date.now());
            borrar('gv_salida');
        }
        try { if (motivo) window.sessionStorage.setItem('gv_motivo_salida', motivo); } catch (e) { }
        window.location.href = 'login.html';
    };

    // Identifica un token sin guardarlo completo (su firma, al final, es única)
    function huella(token) { return String(token || '').slice(-24); }

    // Páginas que ve cualquier visitante: ahí salir de la sesión no manda al login
    var PUBLICAS = ['', 'index', 'alojamientos', 'resultados', 'suite', 'blog', 'articulo', 'confirmacion', 'login'];

    // Si en otra pestaña cierran la sesión de ESTE mismo usuario, esta también sale
    window.addEventListener('storage', function (e) {
        if (e.key !== 'gv_salida' || !e.newValue) return;
        var mio = leerPestana('gv_token');
        if (!mio || e.newValue.split('|')[0] !== huella(mio)) return;
        borrarPestana('gv_token');
        borrarPestana('gv_usuario_actual');
        var pagina = window.location.pathname.split('/').pop().replace(/\.html$/, '');
        if (PUBLICAS.indexOf(pagina) === -1) {
            try { window.sessionStorage.setItem('gv_motivo_salida', 'Cerraste la sesión en otra pestaña.'); } catch (err) { }
            window.location.href = 'login.html';
        }
    });

    // ¿Esta persona tenía sesión abierta? Si no, es un visitante del sitio
    // público y un 401 no debe sacarlo a ninguna parte.
    function teniaSesion() {
        return !!(leerPestana('gv_token') || leer('gv_token') || leer('gv_usuario_actual'));
    }

    var fetchOriginal = window.fetch.bind(window);

    window.fetch = function (entrada, opciones) {
        var url = (typeof entrada === 'string')
            ? entrada
            : (entrada && entrada.url) || '';
        var esNuestraApi = url.indexOf(API) === 0;

        if (esNuestraApi) {
            var token = window.gvToken();
            if (token) {
                var base = (opciones && opciones.headers)
                    || (typeof entrada !== 'string' && entrada ? entrada.headers : null)
                    || {};
                var cabeceras = new Headers(base);
                if (!cabeceras.has('Authorization')) {
                    cabeceras.set('Authorization', 'Bearer ' + token);
                }
                opciones = Object.assign({}, opciones || {}, { headers: cabeceras });
            }
        }

        return fetchOriginal(entrada, opciones).then(function (respuesta) {
            if (respuesta.status === 401 && esNuestraApi && teniaSesion()) {
                window.gvSalir('Tu sesión venció. Entra de nuevo.');
            }
            return respuesta;
        });
    };

    // Los paneles llaman esto al arrancar: si no hay token, ni se molestan en cargar.
    window.gvExigirSesion = function (rolesPermitidos) {
        var usuario = window.gvUsuario();
        if (!window.gvToken() || !usuario) {
            window.gvSalir('Entra con tu usuario para continuar.');
            return null;
        }
        if (rolesPermitidos && rolesPermitidos.length && rolesPermitidos.indexOf(usuario.rol) === -1) {
            window.location.href = 'login.html';
            return null;
        }
        return usuario;
    };
})();