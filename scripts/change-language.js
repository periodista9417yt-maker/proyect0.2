// change-language.js
// Inicia sesión en Roblox usando la cookie .ROBLOSECURITY (guardada como
// GitHub Secret) y cambia el idioma de la cuenta a "Español (España)".

const { chromium } = require('playwright');

const TARGET_LANGUAGE_LABEL = 'Español (España)'; // texto visible en el selector
const ACCOUNT_URL = 'https://www.roblox.com/es/my/account#!/info';

async function main() {
  const cookieValue = process.env.ROBLOSECURITY;

  if (!cookieValue) {
    console.error('❌ No se encontró la variable de entorno ROBLOSECURITY.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
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
    console.log('➡️  Abriendo página de cuenta...');
    await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Verificamos que la cookie funcionó (si no, Roblox redirige a /login)
    await page.waitForTimeout(3000);
    if (page.url().includes('/login')) {
      throw new Error(
        'La cookie .ROBLOSECURITY parece inválida o expirada: Roblox redirigió a /login.'
      );
    }

    console.log('✅ Sesión iniciada correctamente.');

    // La sección de idioma suele estar dentro de "Configuración de idioma"
    // en la misma página de cuenta. Esperamos a que cargue el selector.
    console.log('➡️  Buscando selector de idioma...');

    // Roblox suele usar un <select> o un menú desplegable personalizado.
    // Intentamos primero con un <select> nativo:
    const nativeSelect = page.locator('select').filter({ hasText: 'Español' }).first();

    if (await nativeSelect.count() > 0) {
      await nativeSelect.selectOption({ label: TARGET_LANGUAGE_LABEL });
      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (selector nativo).`);
    } else {
      // Si no es un <select> nativo, probamos el patrón de dropdown
      // personalizado de Roblox (botón que abre una lista de opciones).
      const dropdownTrigger = page.locator(
        '[class*="language"] button, [class*="Language"] button, [data-testid*="language"]'
      ).first();

      await dropdownTrigger.click({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const option = page.getByText(TARGET_LANGUAGE_LABEL, { exact: true }).first();
      await option.click({ timeout: 10000 });

      console.log(`✅ Idioma cambiado a "${TARGET_LANGUAGE_LABEL}" (dropdown personalizado).`);
    }

    // Algunos formularios de Roblox guardan automáticamente al seleccionar,
    // otros requieren confirmar con un botón "Guardar" / "Save".
    const saveButton = page.getByRole('button', { name: /guardar|save/i }).first();
    if (await saveButton.count() > 0) {
      await saveButton.click();
      console.log('✅ Cambios guardados.');
    }

    await page.waitForTimeout(2000);
  } catch (err) {
    console.error('❌ Error durante la automatización:', err.message);
    // Guardamos captura y HTML para depurar selectores desde los "Artifacts" del run
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
