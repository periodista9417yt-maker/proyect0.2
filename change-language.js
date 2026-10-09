const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Aplicamos el plugin Stealth
chromium.use(StealthPlugin());

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/my/account#!/info';

const VIDEO_PATH = path.resolve('videos/video1.mp4');
const PORT = 8765;

/*
 * ------------------------------------------------------------
 * SERVIDOR LOCAL DE VÍDEO
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
 * INYECCIÓN Y MOCKEO AVANZADO DE WEBRTC / WEBCAM
 * ------------------------------------------------------------
 */
const CAMERA_INIT_SCRIPT = (videoUrl) => {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

  let fakeStream = null;
  let canvas = null;
  let ctx = null;
  let video = null;

  // 1. Enmascarar enumerateDevices para simular cámara frontal real de móvil
  navigator.mediaDevices.enumerateDevices = async function() {
    return [
      {
        deviceId: 'front-camera-device-id',
        kind: 'videoinput',
        label: 'Front Camera (Facetime HD)',
        groupId: 'group-id-1'
      },
      {
        deviceId: 'default-audio-id',
        kind: 'audioinput',
        label: 'iPhone Microphone',
        groupId: 'group-id-2'
      }
    ];
  };

  // 2. Crear Stream de Video dinámico
  async function createCamera() {
    if (fakeStream) return fakeStream;

    canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

    video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.loop = true;
    video.src = videoUrl + '?t=' + Date.now();

    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    document.documentElement.appendChild(video);

    await video.play().catch(() => {});

    fakeStream = canvas.captureStream(30);

    function render() {
      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          const noiseIntensity = 1.8;

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
 * HELPER DE BÚSQUEDA Y ESPERA
 * ------------------------------------------------------------
 */
async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function clickButton(page, text, timeout = 30000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const frames = page.frames();
    
    // 1. Buscar en iframes (Persona / Roblox modal)
    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry') || frame.url().includes('roblox.com')) {
        const iframeButtons = frame.locator('button, [role="button"], a[class*="button"]');
        const iframeCount = await iframeButtons.count();

        for (let j = 0; j < iframeCount; j++) {
          const button = iframeButtons.nth(j);
          if (!(await button.isVisible().catch(() => false))) continue;

          const buttonText = (await button.innerText().catch(() => '')).trim();
          
          // Coincidencia exacta del texto
          if (buttonText === text && !(await button.isDisabled().catch(() => false))) {
            console.log(`🎯 Botón exacto encontrado en iframe: "${buttonText}"`);
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click({ force: true, timeout: 5000 });
            return;
          }
        }
      }
    }

    // 2. Buscar en el contexto global de la página
    const globalButtons = page.locator('button, [role="button"], [class*="button"]');
    const globalCount = await globalButtons.count();

    for (let i = 0; i < globalCount; i++) {
      const button = globalButtons.nth(i);
      if (!(await button.isVisible().catch(() => false))) continue;

      const buttonText = (await button.innerText().catch(() => '')).trim();

      // Coincidencia exacta del texto
      if (buttonText === text && !(await button.isDisabled().catch(() => false))) {
        console.log(`🎯 Botón exacto encontrado en página: "${buttonText}"`);
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ force: true, timeout: 5000 }).catch(() => {});
        return;
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
 * FLUJO PRINCIPAL
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
  await clickButton(page, 'Continuar', 30000);

  
  console.log('⏳ Esperando inicialización de la cámara de Persona...');
  const TEXTO_CAMARA = 'Centra tu rostro en el círculo';
  let iframePersona = null;
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        
        // Si intenta mandarnos a continuar en otro dispositivo, forzamos clic en "Continuar aquí" si existe
        const tryOther = await frame.getByText('Continuar en otro dispositivo').first().isVisible().catch(() => false);
        if (tryOther) {
          console.log('⚠️ Detectada pantalla de cambio de dispositivo. Intentando forzar modo web...');
          await clickButton(page, 'Continuar en este dispositivo', 5000).catch(() => {});
        }

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

  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'injected-video-screenshot.png', fullPage: true });
  console.log('📸 Captura tomada tras la activación de la cámara: injected-video-screenshot.png');

  console.log('⏳ Esperando verificación continua hasta detectar "Completado"...');

  const MAX_WAIT_TIME = 120000;
  const startTime = Date.now();
  let completado = false;

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const frames = page.frames();

    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        const isCompletado = await frame.getByText(/estimando/i).first().isVisible().catch(() => false);
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

    try {
      await clickButton(page, 'Toma una foto', 800);
    } catch (_) {}

    await page.waitForTimeout(1000);
  }

  if (!completado) {
    throw new Error('Se alcanzó el tiempo límite de espera sin detectar el estado "Completado".');
  }

  await page.screenshot({ path: 'success-screenshot.png', fullPage: true });
  console.log('📸 Captura de finalización generada: success-screenshot.png');
}

/*
 * ------------------------------------------------------------
 * MAIN CON CONFIGURACIÓN ANTIDETECCIÓN PURE-STEALTH
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
    // SIN FLAGS DE FAKE DEVICE QUE DETECTA PERSONA
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'es-ES',
      permissions: ['camera']
    });

    await context.grantPermissions(['camera'], { origin: 'https://roblox.com' });
    await context.grantPermissions(['camera'], { origin: 'https://withpersona.com' });

    await context.addCookies([
      { name: '.ROBLOSECURITY', value: cookie, domain: '.roblox.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }
    ]);

    // Inyectamos script camuflado directamente en todas las ventanas e iframes
    const videoUrl = `http://127.0.0.1:${PORT}/video1.mp4`;
    await context.addInitScript({ content: `(${CAMERA_INIT_SCRIPT.toString()})("${videoUrl}");` });

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
