// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

// URL de configuración protegida por Secret o fallback
const SITE_URL = process.env.SITE_URL || 'https://roblox.com';
const TARGET_LANGUAGE_LABEL = 'Español (España)';

// Rutas locales a los 3 videos que se van a inyectar como si fueran la cámara.
const VIDEO_1 = path.join(__dirname, '..', 'videos', 'video1.mp4');
const VIDEO_2 = path.join(__dirname, '..', 'videos', 'video2.mp4');
const VIDEO_3 = path.join(__dirname, '..', 'videos', 'video3.mp4');

// URLs falsas interceptadas para simular la cámara
const FAKE_ORIGIN = 'https://fake-camera-injector.local';
const FAKE_URLS = {
  video1: `${FAKE_ORIGIN}/video1.mp4`,
  video2: `${FAKE_ORIGIN}/video2.mp4`,
  video3: `${FAKE_ORIGIN}/video3.mp4`,
};

test('Flujo Unificado: Cambiar Idioma y Flujo de Cámara', async ({ page, context }) => {
  const cookieValue = process.env.ROBLOSECURITY;
  if (!cookieValue) {
    throw new Error('❌ No se encontró la variable de entorno ROBLOSECURITY en los Secrets.');
  }

  // 1) Configurar permisos de cámara previos para evitar alertas nativas
  await context.grantPermissions(['camera'], { origin: 'https://roblox.com' });

  // 2) Interceptar URLs de videos falsos
  await page.route(`${FAKE_ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    const file = url.endsWith('video1.mp4') ? VIDEO_1 : url.endsWith('video2.mp4') ? VIDEO_2 : VIDEO_3;
    await route.fulfill({ path: file, contentType: 'video/mp4' });
  });

  // 3) Inyectar script para simular la webcam mediante elementos de video ocultos
  await page.addInitScript(() => {
    const ID = '__fake_camera_video__';
    // @ts-ignore
    window.__setFakeVideoSrc = async (url) => {
      let video = document.getElementById(ID);
      if (!video) {
        video = document.createElement('video');
        video.id = ID;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.style.position = 'fixed';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        document.documentElement.appendChild(video);
      }
      video.src = url;
      try { await video.play(); } catch (e) {}
    };

    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      let video = document.getElementById(ID);
      if (!video) {
        // @ts-ignore
        await window.__setFakeVideoSrc(window.__initialFakeVideoUrl || '');
        video = document.getElementById(ID);
      }
      await new Promise((resolve) => {
        // @ts-ignore
        if (video.readyState >= 2) return resolve(undefined);
        // @ts-ignore
        video.onloadeddata = () => resolve(undefined);
      });
      // @ts-ignore
      if (video.captureStream) return video.captureStream();
      // @ts-ignore
      if (video.mozCaptureStream) return video.mozCaptureStream();
      return origGetUserMedia(constraints);
    };
  });

  // 4) Inyectar la Cookie de sesión de manera segura antes de navegar
  await context.addCookies([
    {
      name: '.ROBLOSECURITY',
      value: cookieValue,
      domain: '.roblox.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  try {
    console.log('➡️ Abriendo página de cuenta...');
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('/login')) {
      throw new Error('La cookie .ROBLOSECURITY ha expirado o es incorrecta.');
    }
    console.log('✅ Sesión iniciada correctamente.');

    // 5) Proceso de Cambio de Idioma
    console.log('➡️ Buscando selector de idioma...');
    const nativeSelect = page.locator('select').filter({ hasText: 'Español' }).first();

    if (await nativeSelect.count() > 0) {
      await nativeSelect.selectOption({ label: TARGET_LANGUAGE_LABEL });
      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (Nativo).`);
    } else {
      const dropdownTrigger = page.locator('[class*="language"] button, [class*="Language"] button, [data-testid*="language"]').first();
      await dropdownTrigger.click({ timeout: 10000 });
      await page.waitForTimeout(1000);
      const option = page.getByText(TARGET_LANGUAGE_LABEL, { exact: true }).first();
      await option.click({ timeout: 10000 });
      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (Dropdown).`);
    }
    await page.waitForTimeout(3000); // Esperar que procese el guardado sutilmente

    // 6) INICIO DEL FLUJO DE CÁMARA (En la misma página)
    console.log('➡️ Iniciando flujo de verificación de cámara...');
    
    // Preparar primer video virtual antes del disparo de la cámara
    await page.evaluate((url) => { window['__initialFakeVideoUrl'] = url; }, FAKE_URLS.video1);
    await page.evaluate((url) => window['__setFakeVideoSrc'](url), FAKE_URLS.video1);

    // Botón 1: Continuar con la cámara
    await page.getByRole('button', { name: /continuar con la cámara/i }).click();

    // Botón 2: Continuar
    await page.getByRole('button', { name: /^continuar\$/i }).click();

    // Botón 3: Continuar (segunda vez)
    await page.getByRole('button', { name: /^continuar\$/i }).click();

    // Asegurar video 1 activo en la captura inicial
    await page.evaluate((url) => window['__setFakeVideoSrc'](url), FAKE_URLS.video1);

    // 7) Intercalado de videos simulando movimientos (Izquierda / Derecha)
    await Promise.race([
      page.getByText(/izquierda/i).first().waitFor({ state: 'visible' }),
      page.getByRole('button', { name: /tomar foto/i }).first().waitFor({ state: 'visible' }),
    ]);
    await page.evaluate((url) => window['__setFakeVideoSrc'](url), FAKE_URLS.video2);

    const tomarFotoBtn1 = page.getByRole('button', { name: /tomar foto/i }).first();
    if (await tomarFotoBtn1.isVisible().catch(() => false)) {
      await tomarFotoBtn1.click();
    }

    await Promise.race([
      page.getByText(/derecha/i).first().waitFor({ state: 'visible' }),
      page.getByRole('button', { name: /tomar foto/i }).first().waitFor({ state: 'visible' }),
    ]);
    await page.evaluate((url) => window['__setFakeVideoSrc'](url), FAKE_URLS.video3);

    const tomarFotoBtn2 = page.getByRole('button', { name: /tomar foto/i }).first();
    if (await tomarFotoBtn2.isVisible().catch(() => false)) {
      await tomarFotoBtn2.click();
    }

    // Finalizar flujo
    const deAcuerdoBtn = page.getByRole('button', { name: /de acuerdo/i });
    await deAcuerdoBtn.waitFor({ state: 'visible', timeout: 30000 });
    await deAcuerdoBtn.click();
    console.log('✅ ¡Flujo de verificación completado con éxito!');

  } catch (error) {
    console.error('❌ Error durante la ejecución:', error.message);
    await page.screenshot({ path: 'test-results/error-screenshot.png', fullPage: true }).catch(() => {});
    throw error;
  }
});
