const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/my/account#!/info';

// Solo utilizaremos un vídeo continuo
const VIDEO_PATH = path.resolve('videos/video1.mp4');

const PORT = 8765;
const TIMEOUT = 30000;

/*
 * ------------------------------------------------------------
 * SERVIDOR LOCAL DE VÍDEO
 * ------------------------------------------------------------
 */
function startVideoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!fs.existsSync(VIDEO_PATH)) {
        console.error(`❌ Archivo no encontrado: "${VIDEO_PATH}"`);
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end('Not found');
        return;
      }

      const stat = fs.statSync(VIDEO_PATH);
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
        fs.createReadStream(VIDEO_PATH, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size });
        fs.createReadStream(VIDEO_PATH).pipe(res);
      }
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`🎥 Servidor de vídeo iniciado en http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

/*
 * ------------------------------------------------------------
 * INYECTOR DE CÁMARA REAL EN VIVO (SIMULACIÓN SENSOR CMOS + CANVAS)
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
    ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.loop = true; // Bucle continuo transparente

    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    video.style.width = '1px';
    video.style.height = '1px';

    document.documentElement.appendChild(video);

    // Captura del canvas simulando los 30 FPS nativos de un iPhone
    fakeStream = canvas.captureStream(30);

    // Renderizado en vivo con emulación de sensor físico (Ruido y micro-jittering)
    function render() {
      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Inyección de ruido de sensor CMOS para evitar patrones estáticos
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const noiseIntensity = 2.0;

          for (let i = 0; i < data.length; i += 16) {
            const noise = (Math.random() - 0.5) * noiseIntensity;
            data[i]     = Math.min(255, Math.max(0, data[i] + noise));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (_) {}
      }

      // Micro variación de frames imitando el comportamiento de captura móvil real
      const jitterDelay = Math.random() > 0.9 ? Math.random() * 2 : 0;
      if (jitterDelay > 0) {
        setTimeout(() => { requestAnimationFrame(render); }, jitterDelay);
      } else {
        requestAnimationFrame(render);
      }
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
        video.src = url + '?t=' + Date.now();
        video.load();

        video.onloadeddata = async () => {
          try {
            await video.play();
            console.log('📡 [Cámara Real] Vídeo en vivo inyectado correctamente.');
            resolve({ ok: true });
          } catch (error) {
            reject(error);
          }
        };

        video.onerror = () => reject(new Error('Error al cargar la transmisión del vídeo'));
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
 * HELPER DE BÚSQUEDA Y ESPERA EN IFRAMES
 * ------------------------------------------------------------
 */
async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function clickButton(page, text, timeout = 30000) {
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
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click({ force: true, timeout: 5000 });
            return;
          }
        }
      }
    }

    const globalButtons = page.locator('button, [role="button"], [class*="button"]');
    const globalCount = await globalButtons.count();

    for (let i = 0; i < globalCount; i++) {
      const button = globalButtons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;

      const buttonText = (await button.innerText().catch(() => '')).trim();
      if (buttonText === text && !(await button.isDisabled().catch(() => false))) {
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ force: true, timeout: 5000 }).catch(() => {});
        return;
      }
    }
    await page.waitForTimeout(500);
  }
}

async function setCameraVideo(page, filename) {
  const url = `http://127.0.0.1:${PORT}/${filename}`;
  console.log(`📷 Inyectando transmisión en vivo de vídeo...`);

  const frames = page.frames();
  for (const frame of frames) {
    if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
      try {
        await frame.evaluate(async (videoUrl) => {
          if (typeof window.__setCameraVideo === 'function') {
            return await window.__setCameraVideo(videoUrl);
          }
        }, url);
      } catch (err) {
        console.error(`❌ Error inyectando vídeo en el iframe: ${err.message}`);
      }
    }
  }
}

async function changeLanguage(page) {
  console.log('➡️ Configurando idioma a Español...');
  await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000);

  if (page.url().includes('/login')) {
    throw new Error('La cookie .ROBLOSECURITY parece inválida o expiró.');
  }

  const nativeSelect = page.locator('select').filter({ hasText: 'Español' }).first();
  if (await nativeSelect.count() > 0) {
    await nativeSelect.selectOption({ label: TARGET_LANGUAGE_LABEL });
  } else {
    const dropdown = page.locator('[class*="language"] button, [class*="Language"] button').first();
    await dropdown.click({ timeout: 10000 }).catch(() => {});
    await wait(1000);
    await page.getByText(TARGET_LANGUAGE_LABEL, { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
  }
  await wait(2000);
}

/*
 * ------------------------------------------------------------
 * FLUJO PRINCIPAL (UN SOLO VÍDEO HASTA VER "COMPLETADO")
 * ------------------------------------------------------------
 */
async function runGameFlow(page) {
  console.log('➡️ Abriendo flujo de verificación...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(5000);

  await clickButton(page, 'Continuar con la cámara', 30000);
  await page.waitForTimeout(1000);

  await clickButton(page, 'Continuar', 30000);
  await page.waitForTimeout(1000);
  await clickButton(page, 'Continuar', 30000);

  console.log('⏳ Esperando inicialización de cámara Persona...');
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

  // 1. Inyectar UN solo vídeo en vivo desde el inicio
  await setCameraVideo(page, 'video1.mp4');

  console.log('⏳ Esperando verificación continua hasta detectar "Completado"...');

  // 2. Esperar indefinidamente haciendo clic automático si requiere capturas intermedias
  const MAX_WAIT_TIME = 180000; // 3 minutos máximo de tolerancia
  const startTime = Date.now();
  let completado = false;

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const frames = page.frames();

    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        // Verificar si apareció el mensaje de éxito
        const isCompletado = await frame.getByText(/completado/i).first().isVisible().catch(() => false);
        if (isCompletado) {
          completado = true;
          break;
        }
      }
    }

    if (completado) {
      console.log('🎉 Se detectó la palabra "Completado". Verificación exitosa.');
      break;
    }

    // Auto presionar "Toma una foto" si la interfaz lo solicita durante la simulación continua
    try {
      await clickButton(page, 'Toma una foto', 800);
    } catch (_) {}

    await page.waitForTimeout(1000);
  }

  if (!completado) {
    throw new Error('Se alcanzó el tiempo límite de espera sin detectar el estado "Completado".');
  }

  await page.screenshot({ path: 'success-screenshot.png', fullPage: true });
}

/*
 * ------------------------------------------------------------
 * MAIN (EMULACIÓN DISPOSITIVO MÓVIL IPHONE 14 PRO)
 * ------------------------------------------------------------
 */
async function main() {
  console.log('🚀 Iniciando servicio de automatización...');
  const cookie = process.env.ROBLOSECURITY;

  if (!cookie) {
    throw new Error('No existe el secret ROBLOSECURITY.');
  }

  if (!fs.existsSync(VIDEO_PATH)) {
    throw new Error(`Archivo de vídeo no encontrado en: ${VIDEO_PATH}`);
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
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'es-ES',
      permissions: ['camera']
    });

    await context.grantPermissions(['camera'], { origin: 'https://roblox.com' });
    await context.grantPermissions(['camera'], { origin: 'https://withpersona.com' });

    await context.addCookies([
      { name: '.ROBLOSECURITY', value: cookie, domain: '.roblox.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }
    ]);

    await context.addInitScript({ content: `(${CAMERA_INIT_SCRIPT.toString()})();` });

    const page = await context.newPage();

    // Eliminar restricciones CSP para inyección fluida de la cámara
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

    await changeLanguage(page);
    await runGameFlow(page);

    console.log('=================================\n🎉 PROCESO FINALIZADO CON ÉXITO\n=================================');
  } catch (error) {
    console.error('=================================\n❌ AUTOMATIZACIÓN FALLÓ\n=================================');
    console.error(error.stack || error.message);
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
