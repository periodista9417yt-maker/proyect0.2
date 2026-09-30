const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const TARGET_LANGUAGE_LABEL = 'Español (España)';

const ACCOUNT_URL =
  'https://roblox.com';

const GAME_URL =
  'https://roblox.com';

const VIDEOS = {
  video1: path.resolve('videos/video1.mp4'),
  video2: path.resolve('videos/video2.mp4'),
  video3: path.resolve('videos/video3.mp4')
};

const PORT = 8765;

const TIMEOUT = 30000;


/*
 * ------------------------------------------------------------
 * SERVIDOR LOCAL DE VÍDEOS
 * ------------------------------------------------------------
 */

function startVideoServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let requested = req.url || '';

      if (requested.startsWith('/')) {
        requested = requested.substring(1);
      }

      const filePath = path.resolve('videos', requested);

      const allowedFiles = [
        path.resolve(VIDEOS.video1),
        path.resolve(VIDEOS.video2),
        path.resolve(VIDEOS.video3)
      ];

      if (!allowedFiles.includes(filePath) || !fs.existsSync(filePath)) {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*'
        });

        res.end('Not found');
        return;
      }

      const stat = fs.statSync(filePath);
      const range = req.headers.range;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Range, Accept-Ranges, Content-Length'
      );
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
        let end = match[2]
          ? Number(match[2])
          : stat.size - 1;

        if (end >= stat.size) {
          end = stat.size - 1;
        }

        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': chunkSize
        });

        fs.createReadStream(filePath, {
          start,
          end
        }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size
        });

        fs.createReadStream(filePath).pipe(res);
      }
    });

    server.on('error', reject);

    server.listen(PORT, '127.0.0.1', () => {
      console.log(
        `🎥 Servidor de vídeos iniciado en http://127.0.0.1:${PORT}`
      );

      resolve(server);
    });
  });
}


/*
 * ------------------------------------------------------------
 * CÁMARA VIRTUAL DENTRO DE LA PÁGINA (CORREGIDA)
 * ------------------------------------------------------------
 */

const CAMERA_INIT_SCRIPT = () => {
  const originalGetUserMedia =
    navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );

  let fakeStream = null;
  let canvas = null;
  let ctx = null;
  let video = null;
  let ready = false;

  async function createCamera() {
    if (ready) return fakeStream;

    canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;

    ctx = canvas.getContext('2d', {
      alpha: false
    });

    video = document.createElement('video');

    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    video.style.width = '1px';
    video.style.height = '1px';

    document.documentElement.appendChild(video);

    fakeStream = canvas.captureStream(30);

    ctx.fillStyle = 'black';
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    function render() {
      if (video && video.readyState >= 2) {
        try {
          ctx.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
          );
        } catch (_) {}
      }

      requestAnimationFrame(render);
    }

    render();

    ready = true;

    return fakeStream;
  }

  // CORRECCIÓN: Asignar explícitamente al objeto global
  // window de forma nativa e independiente
  window.__setCameraVideo = function (url) {
    return new Promise(async (resolve, reject) => {
      try {
        const stream = await createCamera();

        video.pause();
        video.src = url;
        video.currentTime = 0;

        video.onloadeddata = async () => {
          try {
            await video.play();

            setTimeout(() => {
              resolve({
                ok: true,
                tracks: stream.getVideoTracks().length,
                url
              });
            }, 500);
          } catch (error) {
            reject(error);
          }
        };

        video.onerror = () => {
          reject(
            new Error(
              'No se pudo cargar el vídeo de cámara: ' + url
            )
          );
        };

        video.load();
      } catch (error) {
        reject(error);
      }
    });
  };

  window.__getCameraInfo = async function () {
    const stream = await createCamera();
    const track = stream.getVideoTracks()[0];

    return {
      active: track?.readyState === 'live',
      tracks: stream.getVideoTracks().length,
      label: track?.label || 'Fake Camera'
    };
  };

  navigator.mediaDevices.getUserMedia = async function (
    constraints
  ) {
    if (constraints && constraints.video) {
      return createCamera();
    }

    return originalGetUserMedia(constraints);
  };

  window.__cameraAutomationReady = true;
};


/*
 * ------------------------------------------------------------
 * UTILIDADES
 * ------------------------------------------------------------
 */

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function clickButton(
  page,
  text,
  timeout = 30000
) {
  console.log(`➡️ Buscando botón "${text}"...`);

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const frames = page.frames();

    for (const frame of frames) {
      if (
        frame.url().includes('withpersona.com') ||
        frame.url().includes('inquiry')
      ) {
        const iframeButtons =
          frame.locator('button, [role="button"]');

        const iframeCount = await iframeButtons.count();

        for (let j = 0; j < iframeCount; j++) {
          const button = iframeButtons.nth(j);

          if (
            !(await button.isVisible().catch(() => false))
          ) {
            continue;
          }

          const buttonText =
            (await button.innerText().catch(() => '')).trim();

          if (
            buttonText === text &&
            !(await button.isDisabled().catch(() => false))
          ) {
            console.log(
              `🎯 Botón "${text}" detectado internamente en el iframe de Persona.`
            );

            await button
              .scrollIntoViewIfNeeded()
              .catch(() => {});

            await button.click({
              force: true,
              timeout: 5000
            });

            console.log(
              `✅ Botón "${text}" de Persona pulsado.`
            );

            return;
          }
        }
      }
    }

    const globalButtons = page.locator(
      'button, [role="button"], [class*="button"]'
    );

    const globalCount = await globalButtons.count();
    const candidates = [];

    for (let i = 0; i < globalCount; i++) {
      const button = globalButtons.nth(i);

      if (
        !(await button.isVisible().catch(() => false))
      ) {
        continue;
      }

      const buttonText =
        (await button.innerText().catch(() => '')).trim();

      const ariaLabel =
        await button
          .getAttribute('aria-label')
          .catch(() => null);

      const box =
        await button.boundingBox().catch(() => null);

      if (!box) continue;

      if (
        buttonText === text ||
        ariaLabel === text
      ) {
        candidates.push({
          button,
          text: buttonText,
          disabled:
            await button
              .isDisabled()
              .catch(() => false),
          y: box.y
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.y - a.y);

      const target = candidates[0];

      if (!target.disabled) {
        await target.button
          .scrollIntoViewIfNeeded()
          .catch(() => {});

        try {
          await target.button.click({
            timeout: 5000
          });

          console.log(
            `✅ Botón exacto "${text}" pulsado exitosamente.`
          );

          return;
        } catch (_) {
          await target.button.click({
            force: true,
            timeout: 5000
          });

          console.log(
            `✅ Botón exacto "${text}" pulsado con force:true.`
          );

          return;
        }
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `No se pudo encontrar el botón inferior "${text}" después de ${timeout} ms.`
  );
}

async function waitForTextOrButton(
  page,
  texts,
  buttons,
  timeout = TIMEOUT
) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const frames = page.frames();

    for (const frame of frames) {
      if (
        frame.url().includes('withpersona.com') ||
        frame.url().includes('inquiry')
      ) {
        for (const text of texts) {
          if (
            await frame
              .getByText(text)
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            console.log(
              `✅ Condición cumplida por texto en iframe: "${text}".`
            );

            return {
              type: 'text',
              value: text
            };
          }
        }

        for (const button of buttons) {
          if (
            await frame
              .getByRole('button', {
                name: button
              })
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            console.log(
              `✅ Condición cumplida por botón en iframe: "${button}".`
            );

            return {
              type: 'button',
              value: button
            };
          }
        }
      }
    }

    await new Promise(resolve =>
      setTimeout(resolve, 500)
    );
  }

  throw new Error(
    'No apareció ninguna condición esperada en los plazos definidos.'
  );
}


/*
 * ------------------------------------------------------------
 * CAMBIAR VIDEO DE CÁMARA (SOPORTE GLOBAL ESTABLE)
 * ------------------------------------------------------------
 */

async function setCameraVideo(page, filename) {
  const url =
    `http://127.0.0.1:${PORT}/${filename}`;

  console.log(
    `📷 Cambiando cámara a ${filename} en los frames de Persona...`
  );

  try {
    await page
      .evaluate((videoUrl) => {
        if (
          typeof window.__setCameraVideo === 'function'
        ) {
          return window.__setCameraVideo(videoUrl);
        }
      }, url)
      .catch(() => {});
  } catch (_) {}

  const frames = page.frames();
  let cambiadoEnIframe = false;

  for (const frame of frames) {
    const frameUrl = frame.url();

    if (
      frameUrl.includes('withpersona.com') ||
      frameUrl.includes('inquiry')
    ) {
      try {
        const result = await frame
          .evaluate(async (videoUrl) => {
            if (
              typeof window.__setCameraVideo === 'function'
            ) {
              return await window.__setCameraVideo(
                videoUrl
              );
            }

            return {
              error:
                'No inicializado en este frame'
            };
          }, url)
          .catch(e => ({
            error: e.message
          }));

        // CORRECCIÓN DE LA LÍNEA 332:
        // Agregadas comillas de texto para fijar el string
        if (result && result.ok) {
          console.log(
            '✅ Cámara cambiada exitosamente DENTRO del iframe de Persona.'
          );

          cambiadoEnIframe = true;
        } else if (result && result.error) {
          console.log(
            `⚠️ Alerta en iframe: ${result.error}`
          );
        }
      } catch (err) {
        console.log(
          `⚠️ Error de evaluación: ${err.message}`
        );
      }
    }
  }

  if (!cambiadoEnIframe) {
    console.log(
      '⏳ Esperando propagación de vídeo en el frame de la cámara...'
    );

    await page.waitForTimeout(1500);
  }
}


/*
 * ------------------------------------------------------------
 * CAMBIAR IDIOMA
 * ------------------------------------------------------------
 */

async function changeLanguage(page) {
  console.log(
    '➡️ Abriendo página de cuenta...'
  );

  await page.goto(ACCOUNT_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await wait(3000);

  if (page.url().includes('/login')) {
    throw new Error(
      'La cookie .ROBLOSECURITY parece inválida o expiró.'
    );
  }

  console.log(
    '✅ Sesión iniciada. Buscando idioma...'
  );

  const nativeSelect = page
    .locator('select')
    .filter({
      hasText: 'Español'
    })
    .first();

  if (await nativeSelect.count() > 0) {
    await nativeSelect.selectOption({
      label: TARGET_LANGUAGE_LABEL
    });
  } else {
    const dropdown = page
      .locator(
        '[class*="language"] button, [class*="Language"] button, [data-testid*="language"]'
      )
      .first();

    await dropdown.click({
      timeout: 10000
    });

    await wait(1000);

    await page
      .getByText(TARGET_LANGUAGE_LABEL, {
        exact: true
      })
      .first()
      .click({
        timeout: 10000
      });
  }

  console.log('✅ Idioma cambiado.');

  await wait(2000);
}


/*
 * ------------------------------------------------------------
 * FLUJO PRINCIPAL DEL JUEGO
 * ------------------------------------------------------------
 */

async function runGameFlow(page) {
  console.log(
    '➡️ Abriendo Build the Pyramid...'
  );

  await page.goto(GAME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await wait(5000);

  await clickButton(
    page,
    'Continuar con la cámara',
    30000
  );

  console.log('✅ CODES pulsado.');

  await page.waitForTimeout(1000);

  console.log(
    '➡️ Buscando primer Continuar...'
  );

  await clickButton(
    page,
    'Continuar',
    30000
  );

  console.log(
    '✅ Primer Continuar pulsado.'
  );

  await page.waitForTimeout(1000);

  console.log(
    '➡️ Buscando segundo Continuar...'
  );

  await clickButton(
    page,
    'Continuar',
    30000
  );

  console.log(
    '✅ Segundo Continuar pulsado.'
  );

  console.log(
    '⏳ Esperando a que aparezca "Centra tu rostro en el círculo"...'
  );

  const TEXTO_CAMARA =
    'Centra tu rostro en el círculo';

  let iframePersona = null;

  const deadline =
    Date.now() + 30000;

  while (Date.now() < deadline) {
    const frames = page.frames();

    for (const frame of frames) {
      if (
        frame.url().includes('withpersona.com') ||
        frame.url().includes('inquiry')
      ) {
        const visible = await frame
          .getByText(TEXTO_CAMARA)
          .first()
          .isVisible()
          .catch(() => false);

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
    throw new Error(
      'No se encontró la interfaz inicial de la cámara de Persona.'
    );
  }

  console.log(
    '📷 Re-inyectando la cámara virtual en el frame activo de Persona...'
  );

  await iframePersona
    .evaluate(
      `(${CAMERA_INIT_SCRIPT.toString()})();`
    )
    .catch(err => {
      console.error(
        '⚠️ Error al re-inyectar script:',
        err.message
      );
    });

  await page.waitForTimeout(1000);


  /*
   * ------------------------------------------------------------
   * VIDEO 1: Rostro de Frente
   * ------------------------------------------------------------
   */

  await setCameraVideo(
    page,
    'video1.mp4'
  );

  // ↓↓↓ NUEVO: CAPTURA DE PANTALLA PARA EL VIDEO 1 ↓↓↓
  await page.screenshot({
    path: 'video1-status.png',
    fullPage: true
  });

  console.log(
    '📸 Captura de estado del Video 1 guardada: video1-status.png'
  );

  console.log(
    '⏳ Esperando acción de captura inicial o giro...'
  );

  await waitForTextOrButton(
    page,
    ['izquierda', 'Gira', 'Mirar'],
    ['Toma una foto'],
    60000
  );

  // Forzamos clic en la foto si se requiere
  // o si el sistema se detiene
  await clickButton(
    page,
    'Toma una foto',
    5000
  ).catch(() => {});


  /*
   * ------------------------------------------------------------
   * VIDEO 2: Rostro de Perfil (Izquierda / Giro)
   * ------------------------------------------------------------
   */

  await page.waitForTimeout(2000);

  await setCameraVideo(
    page,
    'video2.mp4'
  );

  // ↓↓↓ NUEVO: CAPTURA DE PANTALLA PARA EL VIDEO 2 ↓↓↓
  await page.screenshot({
    path: 'video2-status.png',
    fullPage: true
  });

  console.log(
    '📸 Captura de estado del Video 2 guardada: video2-status.png'
  );

  console.log(
    '⏳ Esperando validación de perfil izquierdo...'
  );

  await waitForTextOrButton(
    page,
    ['derecha', 'Gira la cara'],
    ['Toma una foto'],
    60000
  );

  await clickButton(
    page,
    'Toma una foto',
    5000
  ).catch(() => {});


  /*
   * ------------------------------------------------------------
   * VIDEO 3: Finalización del Flujo
   * ------------------------------------------------------------
   */

  await page.waitForTimeout(2000);

  await setCameraVideo(
    page,
    'video3.mp4'
  );

  // ↓↓↓ NUEVO: CAPTURA DE PANTALLA PARA EL VIDEO 3 ↓↓↓
  await page.screenshot({
    path: 'video3-status.png',
    fullPage: true
  });

  console.log(
    '📸 Captura de estado del Video 3 guardada: video3-status.png'
  );

  console.log(
    '⏳ Esperando pantalla final ("Esta bien" o Procesando)...'
  );

  await waitForTextOrButton(
    page,
    ['Procesando', 'Completado', 'Éxito'],
    ['Esta bien', 'Toma una foto'],
    60000
  );

  try {
    await clickButton(
      page,
      'Esta bien',
      10000
    );
  } catch (_) {
    await clickButton(
      page,
      'Toma una foto',
      5000
    ).catch(() => {});
  }

  console.log(
    '🎉 Flujo completado.'
  );

  try {
    await page.screenshot({
      path: 'success-screenshot.png',
      fullPage: true
    });

    console.log(
      '📸 Captura de éxito guardada: success-screenshot.png'
    );
  } catch (screenshotError) {
    console.error(
      '⚠️ No se pudo tomar la captura de éxito:',
      screenshotError.message
    );
  }
}


/*
 * ------------------------------------------------------------
 * MAIN
 * ------------------------------------------------------------
 */

async function main() {
  console.log(
    '🚀 Iniciando automatización...'
  );

  const cookie =
    process.env.ROBLOSECURITY;

  if (!cookie) {
    throw new Error(
      'No existe el secret ROBLOSECURITY.'
    );
  }

  for (const [name, file] of Object.entries(VIDEOS)) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `No existe ${name}: ${file}`
      );
    }

    console.log(
      `✅ Encontrado ${name}: ${file}`
    );
  }

  const server =
    await startVideoServer();

  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,

      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--allow-running-insecure-content'
      ]
    });

    const context =
      await browser.newContext({
        locale: 'es-ES',

        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

        permissions: ['camera']
      });

    await context.grantPermissions(
      ['camera'],
      {
        origin: 'roblox.com'
      }
    );

    await context.addCookies([
      {
        name: '.ROBLOSECURITY',
        value: cookie,
        domain: '.roblox.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }
    ]);

    const page =
      await context.newPage();

    // Regla de enrutamiento global
    // para limpiar las cabeceras CSP/Frames
    await page.route(
      '**/*',
      async route => {
        try {
          const response =
            await route.fetch();

          const headers =
            response.headers();

          delete headers[
            'x-frame-options'
          ];

          delete headers[
            'content-security-policy'
          ];

          await route.fulfill({
            response,
            headers
          });
        } catch (err) {
          await route
            .continue()
            .catch(() => {});
        }
      }
    );

    await context.addInitScript({
      content:
        `(${CAMERA_INIT_SCRIPT.toString()})();`
    });

    page.on(
      'console',
      message => {
        if (message.type() === 'error') {
          console.error(
            '🌐 Browser error:',
            message.text()
          );
        }
      }
    );

    page.on(
      'pageerror',
      error => {
        console.error(
          '🌐 Page error:',
          error.message
        );
      }
    );

    await changeLanguage(page);

    await runGameFlow(page);

    console.log(
      '=================================\n' +
      '🎉 AUTOMATIZACIÓN TERMINADA\n' +
      '================================='
    );
  } catch (error) {
    console.error(
      '=================================\n' +
      '❌ AUTOMATIZACIÓN FALLÓ\n' +
      '================================='
    );

    console.error(
      error.stack || error.message
    );

    if (browser) {
      try {
        const pages =
          browser.contexts()[0]?.pages();

        if (
          pages &&
          pages.length > 0
        ) {
          const page = pages[0];

          await page.screenshot({
            path: 'error-screenshot.png',
            fullPage: true
          });

          console.log(
            '📸 Captura guardada: error-screenshot.png'
          );

          fs.writeFileSync(
            'error-page.html',
            await page.content()
          );
        }
      } catch (cErr) {
        console.error(
          '⚠️ Error en captura de depuración:',
          cErr.message
        );
      }
    }

    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }

    server.close();

    console.log(
      '🛑 Servidor de vídeos detenido.'
    );
  }
}

main().catch(error => {
  console.error(
    '❌ Error fatal:',
    error
  );

  process.exit(1);
});
