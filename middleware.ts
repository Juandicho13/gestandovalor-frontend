// Vista previa de cada alojamiento cuando se comparte el enlace de la suite
// (WhatsApp, iMessage, Facebook, Telegram, X, LinkedIn, Slack, Discord...).
//
// Esas apps no ejecutan JavaScript: leen solo las etiquetas og: del HTML.
// Por eso, cuando quien pide /suite?id=... es el robot de vista previa de una app,
// se le responde una página pequeña con el nombre, la descripción y la foto de portada
// de ese alojamiento. Las personas reciben suite.html normal, sin ningún cambio.

export const config = {
    matcher: ['/suite', '/suite.html'],
    runtime: 'nodejs',
};

const API = 'https://gestandovalor-backend.onrender.com';
const HOST_FOTOS = 'ntmoegfmcmzvzzzhjwnd.supabase.co';

// Tiempo máximo que el robot espera los datos del alojamiento antes de recibir la vista general.
const ESPERA_MAXIMA_MS = 6000;
// Los datos de cada alojamiento se guardan 10 minutos para responder rápido.
const DURACION_CACHE_MS = 10 * 60 * 1000;

// Robots de vista previa. No incluye Google ni Bing: esos sí ejecutan JavaScript
// y deben seguir viendo la página real.
const ROBOTS = /^WhatsApp\/|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|skypeuripreview|pinterestbot|pinterest\/0\.|redditbot|vkshare|embedly|iframely|mastodon\/|cardyb/i;

const NOMBRE_SITIO = 'GestandoValor Apartasuites';
const DESCRIPCION_GENERAL = 'Apartamentos y apartasuites amoblados para estadías cortas. Reserva directo en gestandovalor.com.';

type Contexto = { waitUntil?: (promesa: Promise<unknown>) => void };
type Propiedad = Record<string, unknown>;

const cache = new Map<string, { hasta: number; promesa: Promise<Propiedad | null> }>();

export default async function middleware(request: Request, context?: Contexto): Promise<Response> {
    try {
        const url = new URL(request.url);
        const agente = request.headers.get('user-agent') || '';
        const esLectura = request.method === 'GET' || request.method === 'HEAD';
        if (!esLectura || !ROBOTS.test(agente) || url.searchParams.has('web')) {
            return seguir();
        }
        return await paginaParaRobot(request, url, context);
    } catch (_error) {
        // Ante cualquier problema, la página normal.
        return seguir();
    }
}

// Deja pasar la petición a suite.html (es lo mismo que hace next() de @vercel/functions).
function seguir(): Response {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

async function paginaParaRobot(request: Request, url: URL, context?: Contexto): Promise<Response> {
    const origen = url.origin;
    const id = (url.searchParams.get('id') || '').trim();
    const idValido = /^[A-Za-z0-9_-]{1,64}$/.test(id);
    const datos = idValido ? await obtenerPropiedad(id, context) : null;

    const direccion = idValido ? `${origen}/suite?id=${encodeURIComponent(id)}` : `${origen}/suite`;
    const enlace = new URL(url.href);
    enlace.pathname = '/suite';
    enlace.searchParams.set('web', '1');

    let html: string;
    if (datos) {
        const titulo = recortar(
            texto(datos.titulo) || `${texto(datos.tipo_propiedad) || 'Alojamiento'} en ${texto(datos.ciudad) || 'Colombia'}`,
            120,
        );
        html = pagina({
            pestana: `${titulo} | GestandoValor`,
            titulo,
            descripcion: recortar(describir(datos), 300),
            imagen: elegirImagen(datos, id, origen),
            alt: `Foto de ${titulo}`,
            direccion,
            enlace: enlace.href,
        });
    } else {
        html = pagina({
            pestana: NOMBRE_SITIO,
            titulo: NOMBRE_SITIO,
            descripcion: DESCRIPCION_GENERAL,
            imagen: `${origen}/Logo.png`,
            alt: 'Logo de GestandoValor',
            direccion,
            enlace: enlace.href,
        });
    }

    return new Response(request.method === 'HEAD' ? null : html, {
        status: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'private, no-store',
        },
    });
}

function obtenerPropiedad(id: string, context?: Contexto): Promise<Propiedad | null> {
    const ahora = Date.now();
    const guardado = cache.get(id);
    if (guardado && guardado.hasta > ahora) {
        return conLimite(guardado.promesa, ESPERA_MAXIMA_MS);
    }

    const promesa = pedirAlBackend(id);
    cache.set(id, { hasta: ahora + DURACION_CACHE_MS, promesa });
    promesa.then((datos) => {
        // Si no llegaron datos, se borra para intentarlo de nuevo la próxima vez.
        if (!datos && cache.get(id)?.promesa === promesa) cache.delete(id);
    });
    if (cache.size > 300) {
        const masViejo = cache.keys().next().value;
        if (masViejo !== undefined) cache.delete(masViejo);
    }
    // Si el servidor está lento, la consulta sigue en segundo plano: así queda despierto
    // y con los datos listos para el siguiente intento.
    try {
        context?.waitUntil?.(promesa);
    } catch (_error) {
        // Sin waitUntil no pasa nada.
    }
    return conLimite(promesa, ESPERA_MAXIMA_MS);
}

async function pedirAlBackend(id: string): Promise<Propiedad | null> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 25000);
    try {
        const respuesta = await fetch(`${API}/propiedades/${encodeURIComponent(id)}/detalle`, {
            headers: { accept: 'application/json' },
            signal: control.signal,
        });
        if (!respuesta.ok) return null;
        const datos: unknown = await respuesta.json();
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null;
        return datos as Propiedad;
    } catch (_error) {
        return null;
    } finally {
        clearTimeout(reloj);
    }
}

function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolver) => {
        const reloj = setTimeout(() => resolver(null), ms);
        promesa.then(
            (valor) => {
                clearTimeout(reloj);
                resolver(valor);
            },
            () => {
                clearTimeout(reloj);
                resolver(null);
            },
        );
    });
}

// Foto de portada. Las de Supabase pasan por el optimizador de imágenes de Vercel
// (1200 px, liviana), porque WhatsApp no muestra fotos muy pesadas.
function elegirImagen(datos: Propiedad, id: string, origen: string): string {
    const fotos: unknown[] = Array.isArray(datos.fotos) ? datos.fotos : [];
    const indice = fotos.findIndex((foto) => typeof foto === 'string' && foto.trim() !== '');
    if (indice === -1) return `${origen}/Logo.png`;
    const foto = String(fotos[indice]).trim();
    if (foto.startsWith('data:')) {
        return `${API}/propiedades/${encodeURIComponent(id)}/foto/${indice}`;
    }
    try {
        const direccion = new URL(foto);
        if (direccion.protocol === 'https:' && direccion.hostname === HOST_FOTOS) {
            return `${origen}/_vercel/image?url=${encodeURIComponent(direccion.href)}&w=1200&q=70`;
        }
        if (direccion.protocol === 'https:' || direccion.protocol === 'http:') return direccion.href;
    } catch (_error) {
        // Formato desconocido: se usa el logo.
    }
    return `${origen}/Logo.png`;
}

// Ejemplo: "Apartaestudio en Chía, Cundinamarca · 4 huéspedes · 1 habitación · 2 camas · 1 baño."
function describir(datos: Propiedad): string {
    const tipo = texto(datos.tipo_propiedad) || 'Alojamiento';
    const lugar = [texto(datos.ciudad), texto(datos.departamento)].filter(Boolean).join(', ');
    const partes = [lugar ? `${tipo} en ${lugar}` : tipo];
    const detalles: Array<[unknown, string, string]> = [
        [datos.capacidad_huespedes, 'huésped', 'huéspedes'],
        [datos.habitaciones, 'habitación', 'habitaciones'],
        [datos.camas, 'cama', 'camas'],
        [datos.banos, 'baño', 'baños'],
    ];
    for (const [valor, uno, varios] of detalles) {
        const n = numero(valor);
        if (n !== null) partes.push(`${String(n).replace('.', ',')} ${n === 1 ? uno : varios}`);
    }
    return `${partes.join(' · ')}. Reserva directo en GestandoValor.`;
}

function numero(valor: unknown): number | null {
    const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
}

function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function recortar(valor: string, maximo: number): string {
    const letras = Array.from(valor);
    return letras.length > maximo ? `${letras.slice(0, maximo - 1).join('').trimEnd()}…` : valor;
}

function escapar(valor: string): string {
    return valor
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pagina(p: {
    pestana: string;
    titulo: string;
    descripcion: string;
    imagen: string;
    alt: string;
    direccion: string;
    enlace: string;
}): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(p.pestana)}</title>
<meta name="description" content="${escapar(p.descripcion)}">
<link rel="canonical" href="${escapar(p.direccion)}">
<link rel="icon" type="image/png" href="/Logo.png?v=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NOMBRE_SITIO}">
<meta property="og:locale" content="es_CO">
<meta property="og:title" content="${escapar(p.titulo)}">
<meta property="og:description" content="${escapar(p.descripcion)}">
<meta property="og:url" content="${escapar(p.direccion)}">
<meta property="og:image" content="${escapar(p.imagen)}">
<meta property="og:image:alt" content="${escapar(p.alt)}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body style="margin:0 auto;max-width:640px;padding:24px 16px;font-family:system-ui,sans-serif;color:#0B132B">
<img src="${escapar(p.imagen)}" alt="${escapar(p.alt)}" style="width:100%;height:auto;border-radius:12px">
<h1>${escapar(p.titulo)}</h1>
<p>${escapar(p.descripcion)}</p>
<p><a href="${escapar(p.enlace)}" style="color:#0B132B;font-weight:bold">Ver el alojamiento y reservar</a></p>
</body>
</html>`;
}