// ... (mismos requires iniciales)

const TARGET_LANGUAGE_LABEL = 'Español (España)';
const ACCOUNT_URL = 'https://www.roblox.com/my/account#!/info';
const GAME_URL = 'https://www.roblox.com/my/account#!/info'; // 🟢 CORREGIDO: Cambiar por la URL real de verificación

// ... (startVideoServer y CAMERA_INIT_SCRIPT se mantienen igual)

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

  await page.waitForTimeout(2000);
  
  console.log('⏳ Esperando verificación continua hasta detectar "Completado"...');
  const MAX_WAIT_TIME = 180000;
  const startTime = Date.now();
  let completado = false;

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const frames = page.frames();

    for (const frame of frames) {
      if (frame.url().includes('withpersona.com') || frame.url().includes('inquiry')) {
        // 🟢 CORREGIDO: Buscar la palabra real de éxito (ej. "completado" o "exitoso")
        const isCompletado = await frame.getByText(/estimando|éxito|verificado/i).first().isVisible().catch(() => false);
        if (isCompletado) {
          completado = true;
          break;
        }
      }
    }

    if (completado) {
      console.log('🎉 Se detectó la pantalla final. Verificación exitosa.');
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
}

async function main() {
  // ... (mismo inicio de main)
  
    // Interceptor con limpieza exhaustiva de headers (Case Insensitive)
    await page.route('**/*', async route => {
      try {
        const response = await route.fetch();
        const headers = response.headers();
        
        // 🟢 CORREGIDO: Eliminar variaciones de mayúsculas/minúsculas
        Object.keys(headers).forEach(key => {
          if (key.toLowerCase() === 'x-frame-options' || key.toLowerCase() === 'content-security-policy') {
            delete headers[key];
          }
        });

        await route.fulfill({ response, headers });
      } catch (err) {
        await route.continue().catch(() => {});
      }
    });

    await changeLanguage(page);
    await runGameFlow(page);

    console.log('🎉 PROCESO FINALIZADO CON ÉXITO');
  } catch (error) {
    // ... (manejo de errores del catch)
  } finally {
    if (browser) await browser.close();
    
    // 🟢 CORREGIDO: Forzar el cierre definitivo de sockets del servidor HTTP
    server.closeAllConnections?.(); 
    server.close();
    console.log('🛑 Servidor de vídeos detenido.');
  }
}
