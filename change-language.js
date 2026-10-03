const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/es/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/es/my/account#!/info';

const VIDEOS = {
  video1: path.resolve('videos/video1.mp4'),
  video2: path.resolve('videos/video2.mp4'),
  video3: path.resolve('videos/video3.mp4')
};

const PORT = 8765;
const TIMEOUT = 30000;

/*
 * ------------------------------------------------------------
 * SERVIDOR LOCAL DE VÍDEOS
 * ------------------------------------------------------------
 */
function startVideoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let requested = req.url || '';
      if (requested.startsWith('/')) {
        requested = requested.substring(1);
      }
      requested = requested.split('?')[0];

      console.log(`📡 Servidor de vídeo recibió petición para: "${requested}"`);

      let targetPath = '';
      if (requested === 'video1.mp4') targetPath = VIDEOS.video1;
      else if (requested === 'video2.mp4') targetPath = VIDEOS.video2;
      else if (requested === 'video3.mp4') targetPath = VIDEOS.video3;

      if (!targetPath || !fs.existsSync(targetPath)) {
        console.error(`❌ Archivo no encontrado: "${requested}"`);
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end('Not found');
        return;
      }

      const stat = fs.statSync(targetPath);
      const range = req.headers.range;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (!match) {
          res.writeHead(416);
          res.end();
          return;
        }
        const start = Number(match[1]);
        let end = match[2] ? Number(match[2]) : stat.size - 1;
        if (end >= stat.size) end = stat.size - 1;

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': chunkSize
        });
        fs.createReadStream(targetPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size });
        fs.createReadStream(targetPath).pipe(res);
      }
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`🎥 Servidor de vídeos iniciado en http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

/*
 * ------------------------------------------------------------
 * CÁMARA VIRTUAL - SCRIPT DE INYECCIÓN GLOBAL
 * ------------------------------------------------------------
 */
const CAMERA_INIT_SCRIPT = () => {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  let fakeStream = null;
  let canvas = null;
  let ctx = null;
  let video = null;
  let ready = false;

  async function createCamera() {
    if (ready) return fakeStream;

    canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    ctx = canvas.getContext('2d', { alpha: false });

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    
    video.setAttribute('autoplay', 'true');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');

    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    video.style.width = '1px';
    video.style.height = '1px';

    document.documentElement.appendChild(video);
    fakeStream = canvas.captureStream(30);

    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    function render() {
      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (_) {}
      }
      requestAnimationFrame(render);
    }

    render();
    ready = true;
    return fakeStream;
  }

  window.__setCameraVideo = function(url) {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await createCamera();
        
        video.pause();
        video.onloadeddata = null;
        video.onerror = null;
        video.src = ''; 
        video.load(); 
        
        await new Promise(r => setTimeout(r, 100));

        video.src = url + '?t=' + Date.now();
        video.load();

        video.onloadeddata = async () => {
          try {
            await video.play();
            video.currentTime = 0;

            console.log('📊 DIAGNÓSTICO MULTIMEDIA EN IFRAME:');
            console.log('readyState:', video.readyState);
            console.log('videoWidth:', video.videoWidth);
            console.log('videoHeight:', video.videoHeight);

            setTimeout(() => {
              try {
                const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let min = 255, max = 0, sum = 0;
                for (let i = 0; i < image.data.length; i += 4) {
                  const r = image.data[i];
                  const g = image.data[i + 1];
                  const b = image.data[i + 2];
                  min = Math.min(min, r, g, b);
                  max = Math.max(max, r, g, b);
                  sum += r + g + b;
                }
                
                console.log('🎥 Canvas diagnóstico de píxeles:', {
                  min,
                  max,
                  average: sum / (image.data.length / 4) / 3
                });
              } catch (e) {
                console.error('⚠️ No se pudo leer ImageData:', e.message);
              }

              resolve({ 
                ok: true, 
                tracks: stream.getVideoTracks().length, 
                width: video.videoWidth, 
                height: video.videoHeight 
              });
            }, 1000);

          } catch (error) {
            reject(error);
          }
        };

        video.onerror = () => {
          const error = video.error;
          reject(new Error(`Error de descodificación de vídeo: ${error ? error.message : 'Formato no soportado o Demuxer bloqueado'}`));
        };
      } catch (error) {
        reject(error);
      }
    });
  };

  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.video) {
      return createCamera();
    }
    return originalGetUserMedia(constraints);
  };
};

/*
 * ------------------------------------------------------------
 * UTILIDADES DE BÚSQUEDA Y ESPERA
 * ------------------------------------------------------------
 */
async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function clickButton(page, text, timeout = 30000) {
  console.log(`➡️ Buscando botón "${text}"...`);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        const iframeButtons = frame.locator('button, [role="button"]');
        const iframeCount = await iframeButtons.count();

        for (let j = 0; j < iframeCount; j++) {
          const button = iframeButtons.nth(j);
          if (!(await button.isVisible().catch(() => false))) continue;

          const buttonText = (await button.innerText().catch(() => '')).trim();
          if (buttonText === text && !(await button.isDisabled().catch(() => false))) {
            console.log(`🎯 Botón "${text}" detectado internamente en el iframe de Persona.`);
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click({ force: true, timeout: 5000 });
            console.log(`✅ Botón "${text}" de Persona pulsado.`);
            return;
          }
        }
      }
    }

    const globalButtons = page.locator('button, [role="button"], [class*="button"]');
    const globalCount = await globalButtons.count();
    const candidates = [];

    for (let i = 0; i < globalCount; i++) {
      const button = globalButtons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;

      const buttonText = (await button.innerText().catch(() => '')).trim();
      const ariaLabel = await button.getAttribute('aria-label').catch(() => null);
      const box = await button.boundingBox().catch(() => null);

      if (!box) continue;

      if (buttonText === text || ariaLabel === text) {
        candidates.push({ button, disabled: await button.isDisabled().catch(() => false), y: box.y });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.y - a.y);
      const target = candidates[0];
      if (!target.disabled) {
        await target.button.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await target.button.click({ timeout: 5000 });
          return;
        } catch (_) {
          await target.button.click({ force: true, timeout: 5000 });
          return;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`No se pudo encontrar el botón "${text}" después de ${timeout} ms.`);
}

async function waitForTextOrButton(page, texts, buttons, timeout = TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        for (const text of texts) {



if (await frame.getByText(text).first().isVisible().catch(() => false)) {
return { type: 'text', value: text };
}
}
for (const button of buttons) {
if (await frame.getByRole('button', { name: button }).first().isVisible().catch(() => false)) {
return { type: 'button', value: button };
}
}
}
}
await new Promise(resolve => setTimeout(resolve, 500));
}
throw new Error('No apareció ninguna condición esperada en los plazos definidos.');
}

/*

-

---

1. CAMBIAR VIDEO EXCLUSIVAMENTE EN EL IFRAME DE PERSONA
2.

---

*/
async function setCameraVideo(page, filename) {
const url = `http://127.0.0.1:${PORT}/${filename}`;
console.log(`📷 Cambiando cámara a ${filename} SOLO en Persona...`);

const frames = page.frames();
let cambiadoEnIframe = false;

for (const frame of frames) {
const frameUrl = frame.url();
if (frameUrl.includes('withpersona.com') || frameUrl.includes('inquiry')) {
try {
const result = await frame.evaluate(async (videoUrl) => {
if (typeof window.__setCameraVideo === 'function') {
return await window.__setCameraVideo(videoUrl);
}
return { error: 'El script de la cámara virtual no está presente en este frame.' };
}, url);

if (result && result.ok) {
console.log(`✅ Cámara cambiada en iframe de Persona de forma estable.`);
cambiadoEnIframe = true;
}
} catch (err) {
console.error(`❌ Error inyectando vídeo en el iframe: ${err.message}`);
}
}
}

if (!cambiadoEnIframe) {
console.log(`⏳ Esperando sincronización de frames multimedia en el canvas...`);
await page.waitForTimeout(1500);
}
}

/*

-

---

1. CAMBIAR IDIOMA ROBLOX
2.

---

*/
async function changeLanguage(page) {
console.log('➡️ Abriendo página de cuenta...');
await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(3000);

if (page.url().includes('/login')) {
throw new Error('La cookie .ROBLOSECURITY parece inválida o expiró.');
}

const nativeSelect = page.locator('select').filter({ hasText: 'Español' }).first();
if (await nativeSelect.count() > 0) {
await nativeSelect.selectOption({ label: TARGET_LANGUAGE_LABEL });
} else {
const dropdown = page.locator('[class*="language"] button, [class*="Language"] button, [data-testid*="language"]').first();
await dropdown.click({ timeout: 10000 });
await wait(1000);
await page.getByText(TARGET_LANGUAGE_LABEL, { exact: true }).first().click({ timeout: 10000 });
}
console.log('✅ Idioma cambiado.');
await wait(2000);
}

/*

-

---

1. FLUJO PRINCIPAL DE VERIFICACIÓN
2.

---

*/
async function runGameFlow(page) {
console.log('➡️ Abriendo Build the Pyramid...');
await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await wait(5000);

await clickButton(page, 'Continuar con la cámara', 30000);
await page.waitForTimeout(1000);

await clickButton(page, 'Continuar', 30000);
await page.waitForTimeout(1000);

console.log('➡️ Buscando segundo Continuar...');
await clickButton(page, 'Continuar', 30000);

console.log('⏳ Esperando a que aparezca "Centra tu rostro en el círculo"...');
const TEXTO_CAMARA = 'Centra tu rostro en el círculo';
let iframePersona = null;
const deadline = Date.now() + 30000;

while (Date.now() < deadline) {
const frames = page.frames();
for (const frame of frames) {
if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
const visible = await frame.getByText(TEXTO_CAMARA).first().isVisible().catch(() => false);
if (visible) {
iframePersona = frame;
break;
}
}
}
if (iframePersona) break;
await page.waitForTimeout(500);
}

if (!iframePersona) {
throw new Error('No se encontró la interfaz inicial de la cámara de Persona.');
}

/*

-

---

1. VIDEO 1: Rostro de Frente
2.

---

*/
await setCameraVideo(page, 'video1.mp4');
  await page.waitForTimeout(1000);

console.log('⏳ Sincronizando: Esperando que Persona procese el Rostro de Frente...');


console.log('⏳ Esperando acción de captura inicial...');
await waitForTextOrButton(page, ['izquierda', 'agrefa', 'Mirar'], ['Toma una foto'], 60000);

// ↓↓↓ NUEVO: ESPERA MÍNIMA DE SEGURIDAD ANTES DEL CLIC ↓↓↓
await page.waitForTimeout(1500);
  await page.screenshot({ path: 'video1-status.png', fullPage: true });

await clickButton(page, 'Toma una foto', 5000).catch(() => {});

/*

-

---

1. VIDEO 2: Rostro de Perfil Izquierdo
2.

---

*/
await page.waitForTimeout(500);
await setCameraVideo(page, 'video2.mp4');

console.log('⏳ Sincronizando: Esperando que Persona procese el Perfil Izquierdo...');
await page.waitForTimeout(1000);

console.log('⏳ Esperando validación de perfil izquierdo...');
await waitForTextOrButton(page, ['derecha', 'agrefa'], ['Toma una foto'], 60000);

// ↓↓↓ NUEVO: ESPERA MÍNIMA DE SEGURIDAD ANTES DEL CLIC ↓↓↓
await page.waitForTimeout(1500);
  await page.screenshot({ path: 'video2-status.png', fullPage: true });

await clickButton(page, 'Toma una foto', 5000).catch(() => {});

/*

-

---

1. VIDEO 3: Finalización del Flujo
2.

---

*/
await page.waitForTimeout(500);
await setCameraVideo(page, 'video3.mp4');

console.log('⏳ Sincronizando: Esperando procesamiento final de verificación...');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'video3-status.png', fullPage: true });
console.log('⏳ Esperando pantalla final de éxito...');
await waitForTextOrButton(page, ['Procesando', 'Completado', 'Estimando', 'Validando'], ['Continuar', 'Toma una foto'], 60000);

// ↓↓↓ NUEVO: ESPERA MÍNIMA DE SEGURIDAD ANTES DE CONFIRMAR LA SALIDA ↓↓↓
await page.waitForTimeout(2000);
    

try {
await clickButton(page, 'Toma una foto', 8000);
} catch (_) {
console.log('ℹ️ El botón "Toma una foto" no apareció o el flujo cerró automáticamente el modal.');
}

console.log('🎉 Flujo completado de forma segura.');
  await page.waitForTimeout(10000);
await page.screenshot({ path: 'success-screenshot.png', fullPage: true });
}

/*

-

---

1. MAIN
2.

---

*/
async function main() {
console.log('🚀 Iniciando automatización...');
const cookie = process.env.ROBLOSECURITY;

if (!cookie) {
throw new Error('No existe el secret ROBLOSECURITY.');
}

for (const [name, file] of Object.entries(VIDEOS)) {
if (!fs.existsSync(file)) throw new Error(`No existe ${name}: ${file}`);
}

const server = await startVideoServer();
let browser = null;

try {
browser = await chromium.launch({
headless: true,
args: [
'--use-fake-ui-for-media-stream',
'--use-fake-device-for-media-stream',
'--autoplay-policy=no-user-gesture-required',
'--disable-dev-shm-usage',
'--disable-web-security',
'--allow-running-insecure-content'
]
});

const context = await browser.newContext({
locale: 'es-ES',
userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
permissions: ['camera']
});

await context.grantPermissions(['camera'], { origin: 'https://roblox.com' });
await context.addCookies([
{ name: '.ROBLOSECURITY', value: cookie, domain: '.roblox.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }
]);

await context.addInitScript({ content: `(${CAMERA_INIT_SCRIPT.toString()})();` });

const page = await context.newPage();

await page.route('**/*', async route => {
try {
const response = await route.fetch();
const headers = response.headers();
delete headers['x-frame-options'];
delete headers['content-security-policy'];
await route.fulfill({ response, headers });
} catch (err) {
await route.continue().catch(() => {});
}
});

page.on('console', message => {
console.log(`🌐 [Navegador] ${message.type()}: ${message.text()}`);
});

await changeLanguage(page);
await runGameFlow(page);

console.log('=================================\n🎉 AUTOMATIZACIÓN TERMINADA\n=================================');
} catch (error) {
console.error('=================================\n❌ AUTOMATIZACIÓN FALLÓ\n=================================');
console.error(error.stack || error.message);

if (browser) {
try {
const pages = browser.contexts()[0]?.pages();
if (pages && pages.length > 0) {
await pages[0].screenshot({ path: 'error-screenshot.png', fullPage: true });
fs.writeFileSync('error-page.html', await pages[0].content());
}
} catch (cErr) {
console.error('⚠️ Error generando archivos debug:', cErr.message);
}
}
process.exitCode = 1;
} finally {
if (browser) await browser.close();
server.close();
console.log('🛑 Servidor de vídeos detenido.');
}
}

main().catch(error => {
console.error('❌ Error fatal:', error);
process.exit(1);
});
