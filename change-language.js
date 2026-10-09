const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const http = require('http');
const path = require('path');

chromium.use(StealthPlugin());

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/my/account#!/info';

const VIDEO_PATH = path.resolve('videos/video1.mp4');
const PORT = 8765;

/*
 * ------------------------------------------------------------
 * SERVIDOR LOCAL DE VÍDEO CON SOPORTE DE ORIGEN LIBRE
 * ------------------------------------------------------------
 */
function startVideoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!fs.existsSync(VIDEO_PATH)) {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end('Not found');
        return;
      }

      const stat = fs.statSync(VIDEO_PATH);
      const range = req.headers.range;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

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
 * SCRIPT DE INYECCIÓN EN CÁMARA (SIN PANTALLA EN BLANCO)
 * ------------------------------------------------------------
 */
const CAMERA_INIT_SCRIPT = (videoUrl) => {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  let fakeStream = null;
  let canvas = null;
  let ctx = null;
  let video = null;

  navigator.mediaDevices.enumerateDevices = async function() {
    return [
      {
        deviceId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        kind: 'videoinput',
        label: 'Front Camera',
        groupId: '9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba'
      }
    ];
  };

  async function createCamera() {
    if (fakeStream) return fakeStream;

    canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    ctx = canvas.getContext('2d', { alpha: false });

    video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.loop = true;

    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    video.style.width = '1px';
    video.style.height = '1px';
    document.documentElement.appendChild(video);

    // Esperar explícitamente a que el vídeo esté listo para renderizar
    await new Promise((resolve) => {
      video.onloadeddata = resolve;
      video.onerror = resolve;
      video.src = videoUrl + '?t=' + Date.now();
      video.load();
    });

    await video.play().catch(() => {});

    fakeStream = canvas.captureStream(30);

    function render() {
      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const noiseIntensity = 1.5;

          for (let i = 0; i < data.length; i += 16) {
            const noise = (Math.random() - 0.5) * noiseIntensity;
            data[i]     = Math.min(255, Math.max(0, data[i] + noise));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (_) {}
      }
      requestAnimationFrame(render);
    }

    render();
    return fakeStream;
  }

  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.video) {
      return createCamera();
    }
    return originalGetUserMedia(constraints);
  };
};

/*
 * ------------------------------------------------------------
 * MÉTODOS AUXILIARES Y BÚSQUEDA DE ELEMENTOS
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
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry') || frame.url().includes('roblox.com')) {
        const iframeButtons = frame.locator('button, [role="button"], a[class*="button"]');
        const iframeCount = await iframeButtons.count();

        for (let j = 0; j < iframeCount; j++) {
          const button = iframeButtons.nth(j);
          if (!(await button.isVisible().catch(() => false))) continue;

          const buttonText = (await button.innerText().catch(() => '')).trim();

          if (buttonText === text && !(await button.isDisabled().catch(() => false))) {
            console.log(`🎯 Botón presionado: "${buttonText}"`);
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click({ force: true, timeout: 5000 });
            return;
          }
        }
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`No se pudo encontrar el botón exacto "${text}" tras ${timeout}ms`);
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
 * FLUJO PRINCIPAL DE VERIFICACIÓN
 * ------------------------------------------------------------
 */
async function runGameFlow(page) {
  console.log('➡️ Abriendo flujo de verificación...');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(5000);

  await clickButton(page, 'Continuar con la cámara', 30000);
  await page.waitForTimeout(1500);

  await clickButton(page, 'Continuar', 30000);
  await page.waitForTimeout(1500);

  console.log('⏳ Esperando inicialización de la cámara de Persona...');
  const TEXTO_CAMARA = 'Centra tu rostro en el círculo';
  let iframePersona = null;
  const deadline = Date.now() + 45000;

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

  await page.waitForTimeout(3000); // Tiempo para renderizar los primeros fotogramas del vídeo
  await page.screenshot({ path: 'injected-video-screenshot.png', fullPage: true });
  console.log('📸 Captura tomada tras la activación de la cámara: injected-video-screenshot.png');

  console.log('⏳ Esperando verificación continua en la interfaz hasta detectar "Completado"...');

  const MAX_WAIT_TIME = 180000;
  const startTime = Date.now();
  let completado = false;

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const frames = page.frames();

    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        // Validar estrictamente la presencia del texto final dentro del iframe
        const completadoLocator = frame.locator('text="Estimando"');
        const count = await completadoLocator.count().catch(() => 0);

        if (count > 0 && await completadoLocator.first().isVisible().catch(() => false)) {
          completado = true;
          break;
        }
      }
    }

    if (completado) {
      console.log('🎉 Se detectó el mensaje real de "Completado". Verificación exitosa.');
      break;
    }

    // Presionar el botón de capturar si la interfaz lo requiere
    try {
      await clickButton(page, 'Toma una foto', 1000);
    } catch (_) {}

    await page.waitForTimeout(1500);
  }

  if (!completado) {
    throw new Error('Se alcanzó el tiempo límite de espera sin detectar la pantalla final de "Completado".');
  }

  await page.screenshot({ path: 'success-screenshot.png', fullPage: true });
  console.log('📸 Captura de finalización generada: success-screenshot.png');
}

/*
 * ------------------------------------------------------------
 * EJECUCIÓN PRINCIPAL CON NAVEGADOR
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
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-blink-features=AutomationControlled'
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

    const videoUrl = `http://127.0.0.1:${PORT}/video1.mp4`;
    await context.addInitScript({ content: `(${CAMERA_INIT_SCRIPT.toString()})("${videoUrl}");` });

    const page = await context.newPage();

    await changeLanguage(page);
    await runGameFlow(page);

    console.log('=================================\n🎉 PROCESO FINALIZADO CON ÉXITO\n=================================');
  } catch (error) {
    console.error('=================================\n❌ AUTOMATIZACIÓN FALLÓ\n=================================');
    console.error(error.stack || error.message);

    if (browser) {
      try {
        const pages = browser.contexts()?.[0]?.pages();
        if (pages && pages.length > 0) {
          await pages[0].screenshot({ path: 'error-screenshot.png', fullPage: true });
          fs.writeFileSync('error-page.html', await pages[0].content());
          console.log('📸 Captura y HTML de error generados exitosamente.');
        }
      } catch (cErr) {
        console.error('⚠️ Error guardando archivos de depuración:', cErr.message);
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
