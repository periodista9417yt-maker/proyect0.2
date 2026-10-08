const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Aplicamos el plugin Stealth
chromium.use(StealthPlugin());

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/my/account#!/info';

// Ruta absoluta al vídeo que Chromium usará como cámara
const VIDEO_PATH = path.resolve('videos/video1.mp4');

/*
 * ------------------------------------------------------------
 * HELPER DE BÚSQUEDA Y ESPERA EN INTERFAZ
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
  await page.waitForTimeout(1000);

  await clickButton(page, 'Continuar', 30000);
  await page.waitForTimeout(1000);
  await clickButton(page, 'Continuar', 30000);

  console.log('⏳ Esperando inicialización de la cámara de Persona...');
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

  // Tomar captura inicial tras la activación de la cámara
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'injected-video-screenshot.png', fullPage: true });
  console.log('📸 Captura tomada tras la activación de la cámara: injected-video-screenshot.png');

  console.log('⏳ Esperando verificación continua hasta detectar "Completado"...');

  const MAX_WAIT_TIME = 180000;
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
 * MAIN CON FLAGS DE CHROMIUM PARA INYECCIÓN DE VÍDEO NATIVA
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

  let browser = null;

  try {
    // Inyección nativa de vídeo usando flags de Chromium
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${VIDEO_PATH}`,
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
  }
}

main().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
