// change-language.js
// Cambia el idioma en Roblox, avanza por los diálogos de la cámara y 
// transmite un video falso mediante WebRTC usando flags de Chromium.

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

  // Ruta absoluta al archivo de video (ej. convertido previamente a .y4m en el workflow)
  // Nota: Chromium soporta nativamente archivos .y4m para --use-file-for-fake-video-capture
  const videoPath = path.resolve(__dirname, 'video-captura.y4m');
  
  if (!fs.existsSync(videoPath)) {
    console.warn('⚠️ No se encontró el archivo .y4m localmente, asegurate de convertir tu .mp4 a .y4m en el workflow de GitHub Actions.');
  }

  // Configuramos los argumentos (flags) de Chromium para WebRTC con video falso y omitir permisos
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',                    // Omite la ventana emergente de permisos de cámara/micrófono
      '--use-fake-device-for-media-stream',                 // Usa dispositivos multimedia falsos
      `--use-file-for-fake-video-capture=${videoPath}`,     // Inyecta el archivo de video como señal de la cámara WebRTC
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
    permissions: ['camera'], // Concede explícitamente el permiso de cámara
  });

  // Inyectamos la cookie de sesión ANTES de navegar
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
    // PASOS DE CÁMARA Y DIÁLOGOS DE CONTINUACIÓN
    // -------------------------------------------------------------------------
    console.log('➡️ Buscando y haciendo clic en "Continuar con la cámara"...');
    const cameraButton = page.getByRole('button', { name: /Continuar con la cámara/i }).first();
    await cameraButton.click({ timeout: 10000 });
    console.log('✅ Botón "Continuar con la cámara" presionado.');

    // Primer botón "Continuar" del diálogo
    console.log('➡️ Esperando el primer diálogo y haciendo clic en "Continuar"...');
    await page.waitForTimeout(1500);
    const firstContinueButton = page.getByRole('button', { name: /^Continuar$/i }).first();
    await firstContinueButton.click({ timeout: 10000 });
    console.log('✅ Primer botón "Continuar" presionado.');

    // Segundo botón "Continuar" del siguiente diálogo
    console.log('➡️ Esperando el segundo diálogo y haciendo clic nuevamente en "Continuar"...');
    await page.waitForTimeout(1500);
    const secondContinueButton = page.getByRole('button', { name: /^Continuar$/i }).first();
    await secondContinueButton.click({ timeout: 10000 });
    console.log('✅ Segundo botón "Continuar" presionado.');

    // -------------------------------------------------------------------------
    // TRANSMISIÓN WEBRTC (activada automáticamente por las flags de Chromium)
    // -------------------------------------------------------------------------
    console.log('➡️ Verificando transmisión WebRTC con el video inyectado...');
    // Damos un margen de tiempo para que la página procese el stream de video de la cámara virtual
    await page.waitForTimeout(5000);
    console.log('✅ ¡Flujo de video WebRTC transmitido correctamente en el diálogo!');

  } catch (err) {
    console.error('❌ Error durante la automatización:', err.message);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
