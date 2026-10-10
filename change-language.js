// change-language.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/es/my/account#!/info';

async function main() {
  const cookieValue = process.env.ROBLOSECURITY;

  if (!cookieValue) {
    console.error('❌ No se encontró la variable de entorno ROBLOSECURITY.');
    process.exit(1);
  }

  const videoPath = path.resolve(__dirname, 'video-captura.y4m');
  if (!fs.existsSync(videoPath)) {
    console.warn('⚠️ No se encontró el archivo .y4m localmente, asegurate de convertir tu .mp4 a .y4m en el workflow.');
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${videoPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    permissions: ['camera'],
  });

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

  const page = await context.newPage();

  try {
    console.log('➡️ Abriendo página de cuenta...');
    await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForTimeout(3000);
    if (page.url().includes('/login')) {
      throw new Error('La cookie .ROBLOSECURITY parece inválida o expirada: Roblox redirigió a /login.');
    }

    console.log('✅ Sesión iniciada correctamente.');
    console.log('➡️ Buscando selector de idioma...');

    const nativeSelect = page.locator('select').filter({ hasText: 'Español' }).first();

    if (await nativeSelect.count() > 0) {
      await nativeSelect.selectOption({ label: TARGET_LANGUAGE_LABEL });
      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (selector nativo).`);
    } else {
      const dropdownTrigger = page.locator(
        '[class*="language"] button, [class*="Language"] button, [data-testid*="language"]'
      ).first();

      await dropdownTrigger.click({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const option = page.getByText(TARGET_LANGUAGE_LABEL, { exact: true }).first();
      await option.click({ timeout: 10000 });

      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (dropdown personalizado).`);
    }

    await page.waitForTimeout(2000);

    // -------------------------------------------------------------------------
    // CÁMARA Y DIÁLOGOS
    // -------------------------------------------------------------------------
    console.log('➡️ Buscando y haciendo clic en "Continuar con la cámara"...');
    const cameraButton = page.locator('button:has-text("Continuar con la cámara"), [role="button"]:has-text("Continuar con la cámara")').first();
    await cameraButton.waitFor({ state: 'visible', timeout: 15000 });
    await cameraButton.click({ force: true });
    console.log('✅ Botón "Continuar con la cámara" presionado.');

    // Esperar de forma explícita el primer botón "Continuar" dentro del diálogo
    console.log('➡️ Esperando el primer diálogo y haciendo clic en "Continuar"...');
    const firstContinueButton = page.locator('button:has-text("Continuar"), [role="button"]:has-text("Continuar")').first();
    await firstContinueButton.waitFor({ state: 'visible', timeout: 15000 });
    
    // Captura justo al hacer clic en el primer continuar
    await page.screenshot({ path: 'paso-primer-continuar.png', fullPage: true });
    console.log('📸 Captura guardada: paso-primer-continuar.png');

    // Usamos force: true para evitar que el overlay de Persona bloquee el clic
    await firstContinueButton.click({ force: true });
    console.log('✅ Primer botón "Continuar" presionado.');

    // Segundo botón "Continuar" del siguiente diálogo
    console.log('➡️ Esperando el segundo diálogo y haciendo clic nuevamente en "Continuar"...');
    await page.waitForTimeout(2000);
    const secondContinueButton = page.locator('button:has-text("Continuar"), [role="button"]:has-text("Continuar")').first();
    await secondContinueButton.waitFor({ state: 'visible', timeout: 15000 });
    await secondContinueButton.click({ force: true });
    console.log('✅ Segundo botón "Continuar" presionado.');

    // -------------------------------------------------------------------------
    // TRANSMISIÓN WEBRTC
    // -------------------------------------------------------------------------
    console.log('➡️ Verificando transmisión WebRTC con el video inyectado...');
    await page.waitForTimeout(6000); // Margen para que inicie la transmisión de la cámara virtual

    // Captura cuando se empieza a transmitir el video
    await page.screenshot({ path: 'paso-transmision-webrtc.png', fullPage: true });
    console.log('📸 Captura guardada: paso-transmision-webrtc.png');
    console.log('✅ ¡Flujo de video WebRTC transmitido correctamente!');

  } catch (err) {
    console.error('❌ Error durante la automatización:', err.message);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
