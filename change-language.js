// REEMPLAZA las primeras líneas de tu archivo por estas:
const { chromium } = require('playwright-extra'); // Cambiado para usar el ecosistema extra
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

// Aplicamos el plugin de sigilo globalmente antes de lanzar Chromium
chromium.use(stealth);

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';

async function main() {
  const cookieValue = process.env.ROBLOSECURITY;

  if (!cookieValue) {
    console.error('❌ No se encontró la variable de entorno ROBLOSECURITY.');
    process.exit(1);
  }
 const videoPath = path.resolve(__dirname, 'video-captura.y4m');
  // Lanzamiento del navegador utilizando la cámara física virtual del sistema operativo
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',     // Otorga permisos automáticos a la cámara sin lanzar popups
      '--use-fake-device-for-media-stream', // Permite inicializar streams sin cámaras físicas reales       
      '--use-file-for-fake-video-capture=${videoPath}',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled' // Remueve el flag de automatización 'navigator.webdriver'
    ],
  });

  // Seleccionamos un perfil móvil del registro de Playwright
  const mobileDevice = devices['Pixel 7'];

  const context = await browser.newContext({
    ...mobileDevice, // Emula viewport, userAgent, isMobile, hasTouch, etc.
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

        // -------------------------------------------------------------------------
    // SALTAR PANTALLA INTERMEDIA DE APP MÓVIL
    // -------------------------------------------------------------------------
    const continueInBrowserButton = page.locator(
      'button:has-text("Continue in browser"), [role="button"]:has-text("Continue in browser"), a:has-text("Continue in browser"), ' +
      'button:has-text("Continuar en el navegador"), [role="button"]:has-text("Continuar en el navegador"), a:has-text("Continuar en el navegador")'
    ).first();

    if (await continueInBrowserButton.count() > 0 && await continueInBrowserButton.isVisible()) {
      console.log('📱 Se detectó la pantalla intermedia móvil. Presionando "Continue in browser"...');
      await continueInBrowserButton.click({ force: true });
      await page.waitForTimeout(3000); // Esperamos a que cargue el contenido real de la cuenta
    }

    // -------------------------------------------------------------------------
    // VERIFICACIÓN DE SESIÓN
    // -------------------------------------------------------------------------
  
    if (page.url().includes('/login')) {
      throw new Error('La cookie .ROBLOSECURITY parece inválida o expirada: Roblox redirigió a /login.');
    }

    console.log('✅ Sesión iniciada correctamente (Modo Móvil).');
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
      await option.click({ timeout: 10000 }).catch(() => {});

      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (dropdown personalizado).`);
    }

    await page.waitForTimeout(2000);

    // -------------------------------------------------------------------------
    // CÁMARA Y DIÁLOGOS DE PERSONA (DENTRO DE IFRAME)
    // -------------------------------------------------------------------------
    console.log('➡️ Buscando y haciendo clic en "Continuar con la cámara"...');
    const cameraButton = page.locator('button:has-text("Continuar con la cámara"), [role="button"]:has-text("Continuar con la cámara")').first();
    await cameraButton.waitFor({ state: 'visible', timeout: 15000 });
    // En entornos móviles usamos tap() si está disponible, o click() forzado
    await cameraButton.click({ force: true });
    console.log('✅ Botón "Continuar con la cámara" presionado.');

    console.log('➡️ Esperando a que aparezca el diálogo de Persona...');
    const iframeElement = page.locator('iframe[src*="withpersona.com"], iframe[title*="Persona"]').first();
    await iframeElement.waitFor({ state: 'attached', timeout: 15000 });
    
    const personaFrame = page.frameLocator('iframe[src*="withpersona.com"], iframe[title*="Persona"]').first();

        // Primer botón "Continuar" dentro del iframe de Persona
    console.log('➡️ Buscando el botón azul de "Continuar" dentro de Persona...');
    
    // Filtramos estrictamente por elementos interactivos reales ('button') o con rol de botón y texto exacto
    const firstContinueButton = personaFrame.locator(
      'button:has-text("Continuar"), [role="button"]:has-text("Continuar")'
    ).filter({ has: page.locator('*:not(p):not(span):not(div)') }).first();

    // Alternativa ultra precisa basada en la estructura clásica de Persona:
    const strictPersonaButton = personaFrame.locator('button, [role="button"]').filter({ hasText: /^Continuar$/ }).first();

    await strictPersonaButton.waitFor({ state: 'visible', timeout: 20000 });
    
    await page.screenshot({ path: 'paso-primer-continuar.png', fullPage: true });
    console.log('📸 Captura guardada: paso-primer-continuar.png');

    await strictPersonaButton.click({ force: true });
    console.log('✅ Botón azul "Continuar" presionado correctamente.');


    // Segundo botón "Continuar" dentro del iframe de Persona
    console.log('➡️ Esperando el siguiente paso y haciendo clic nuevamente en "Continuar"...');
    await page.waitForTimeout(5000);
    const secondContinueButton = personaFrame.locator('button, [role="button"]').filter({ hasText: /^Continuar$/ }).first();
    await secondContinueButton.waitFor({ state: 'visible', timeout: 15000 });
    await secondContinueButton.click({ force: true });
    console.log('✅ Segundo botón "Continuar" presionado.');

    // -------------------------------------------------------------------------
    // TRANSMISIÓN WEBRTC Y CAPTURAS POR TEXTO ("izquierda", "derecha", "estimando")
    // -------------------------------------------------------------------------
    console.log('➡️ Monitoreando transmisión WebRTC y textos en pantalla...');

    try {
      console.log('⏳ Esperando texto "izquierda"...');
      await personaFrame.getByText(/izquierda/i).first().waitFor({ state: 'visible', timeout: 25000 });
      await page.screenshot({ path: 'paso-izquierda.png', fullPage: true });
      console.log('📸 Captura guardada: paso-izquierda.png');
    } catch (e) {
      console.log('⚠️ No se detectó explícitamente el texto "izquierda", continuando...');
    }

    try {
      console.log('⏳ Esperando texto "derecha"...');
      await personaFrame.getByText(/derecha/i).first().waitFor({ state: 'visible', timeout: 23000 });
      await page.screenshot({ path: 'paso-derecha.png', fullPage: true });
      console.log('📸 Captura guardada: paso-derecha.png');
    } catch (e) {
      console.log('⚠️ No se detectó explícitamente el texto "derecha", continuando...');
    }

    try {
      console.log('⏳ Esperando texto "estimando"...');
      await personaFrame.getByText(/estimando/i).first().waitFor({ state: 'visible', timeout: 26000 });
      await page.waitForTimeout(12000);
      await page.screenshot({ path: 'paso-estimando.png', fullPage: true });   
      console.log('📸 Captura guardada: paso-estimando.png');
      console.log('✅ Proceso de verificación de edad finalizado correctamente.');
  
    } catch (e) {
      await page.screenshot({ path: 'paso-transmision-webrtc.png', fullPage: true });
      console.log('📸 Captura de respaldo guardada: paso-transmision-webrtc.png');
    }

  } catch (err) {
    console.error('❌ Error durante la automatización:', err.message);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
