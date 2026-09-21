const { chromium } = require("playwright");

const roblosecurity = process.env.ROBLOSECURITY;

if (!roblosecurity) {
  throw new Error("Falta el secret ROBLOSECURITY.");
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  // La cookie se mantiene solamente en memoria durante esta ejecución.
  await context.addCookies([
    {
      name: ".ROBLOSECURITY",
      value: roblosecurity,
      domain: ".roblox.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  const page = await context.newPage();

  try {
    await page.goto(
      "https://www.roblox.com/es/my/account#!/info",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForLoadState("networkidle").catch(() => {});

    console.log("Página de configuración cargada.");

    // Busca el selector de idioma.
    const languageSelect = page.locator(
      'select[name="language"], select[aria-label*="Language"], select[aria-label*="Idioma"]'
    ).first();

    await languageSelect.waitFor({
      state: "visible",
      timeout: 30000
    });

    // Español (España)
    await languageSelect.selectOption({
      label: "Español (España)"
    });

    // Si Roblox requiere guardar explícitamente los cambios.
    const saveButton = page.getByRole("button", {
      name: /guardar|save/i
    }).first();

    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
    }

    await page.waitForTimeout(3000);

    console.log("Idioma cambiado a Español (España).");
  } finally {
    await context.close();
    await browser.close();
  }
})();
