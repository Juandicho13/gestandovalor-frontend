/*
 * GestandoValor · sesión y llamadas protegidas
 * ------------------------------------------------------------------
 * Se carga UNA vez por página, antes que Alpine. Hace tres cosas:
 *   1. Guarda y lee el token de la sesión.
 *   2. Le pone la cabecera Authorization a toda llamada a nuestra API.
 *   3. Si el servidor responde 401, cierra la sesión y manda al login.
 *
 * Por qué cabecera y no cookie: el sitio vive en gestandovalor.com y la API
 * en onrender.com. Son dominios distintos, y Safari bloquea las cookies de
 * terceros por defecto, así que una sesión por cookie simplemente no
 * funcionaría ahí. Con Bearer funciona igual en Safari, Chrome y Firefox.
 */
(function () {
    'use strict';

    var API = 'https://gestandovalor-backend.onrender.com';

    // Safari en modo privado puede lanzar excepción al tocar localStorage.
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

    window.gvToken = function () { return leer('gv_token'); };

    window.gvUsuario = function () {
        try { return JSON.parse(leer('gv_usuario_actual') || 'null'); } catch (e) { return null; }
    };

    window.gvGuardarSesion = function (token, usuario) {
        escribir('gv_token', token || '');
        escribir('gv_usuario_actual', JSON.stringify(usuario || {}));
    };

    window.gvSalir = function (motivo) {
        borrar('gv_token');
        borrar('gv_usuario_actual');
        try { if (motivo) window.sessionStorage.setItem('gv_motivo_salida', motivo); } catch (e) { }
        window.location.href = 'login.html';
    };

    // ¿Esta persona tenía sesión abierta? Si no, es un visitante del sitio
    // público y un 401 no debe sacarlo a ninguna parte.
    function teniaSesion() {
        return !!(leer('gv_token') || leer('gv_usuario_actual'));
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