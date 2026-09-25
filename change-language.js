const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const TARGET_LANGUAGE_LABEL = 'Español (España)';

const ACCOUNT_URL =
  'https://www.roblox.com/es/my/account#!/info';

const GAME_URL =
  'https://www.roblox.com/es/my/account#!/info';

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
 *
 * Los vídeos permanecen en el repositorio.
 * El navegador los obtiene desde localhost.
 *
 * No subimos los vídeos a Roblox.
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

      if (!allowedFiles.includes(filePath)) {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*'
        });

        res.end('Not found');
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*'
        });

        res.end('Not found');
        return;
      }

      const stat = fs.statSync(filePath);

      const range = req.headers.range;

      res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
      );

      res.setHeader(
        'Access-Control-Allow-Headers',
        'Range'
      );

      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Range, Accept-Ranges, Content-Length'
      );

      res.setHeader(
        'Accept-Ranges',
        'bytes'
      );

      res.setHeader(
        'Content-Type',
        'video/mp4'
      );

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
          'Content-Range':
            `bytes ${start}-${end}/${stat.size}`,

          'Content-Length':
            chunkSize
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
 * CÁMARA VIRTUAL DENTRO DE LA PÁGINA
 * ------------------------------------------------------------
 *
 * Creamos:
 *
 * video
 *   ↓
 * canvas
 *   ↓
 * canvas.captureStream()
 *   ↓
 * MediaStream
 *   ↓
 * getUserMedia()
 *
 * La pista permanece viva mientras cambiamos de vídeo.
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
  let animationFrame = null;

  let ready = false;

  async function createCamera() {

    if (ready) {
      return fakeStream;
    }

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

    /*
     * No lo mostramos en pantalla.
     */
    video.style.position = 'fixed';
    video.style.left = '-10000px';
    video.style.top = '-10000px';
    video.style.width = '1px';
    video.style.height = '1px';

    document.documentElement.appendChild(video);

    /*
     * Stream persistente.
     */
    fakeStream = canvas.captureStream(30);

    /*
     * Empezamos dibujando negro.
     */
    ctx.fillStyle = 'black';
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    function render() {

      if (
        video &&
        video.readyState >= 2
      ) {

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

      animationFrame =
        requestAnimationFrame(render);
    }

    render();

    ready = true;

    return fakeStream;
  }


  /*
   * Cambiar la fuente del vídeo sin destruir
   * el MediaStream.
   */
  window.__setCameraVideo = async function(url) {

    const stream = await createCamera();

    return new Promise(async (resolve, reject) => {

      try {

        video.pause();

        video.src = url;

        video.currentTime = 0;

        video.onloadeddata = async () => {

          try {

            await video.play();

            /*
             * Esperamos unos frames para asegurarnos
             * de que el canvas está recibiendo imagen.
             */
            setTimeout(() => {

              resolve({
                ok: true,
                tracks:
                  stream.getVideoTracks().length,
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
              'No se pudo cargar el vídeo de cámara: ' +
              url
            )
          );
        };

        video.load();

      } catch (error) {
        reject(error);
      }
    });
  };


  /*
   * Exponemos el stream para diagnóstico.
   */
  window.__getCameraInfo = async function() {

    const stream = await createCamera();

    const track =
      stream.getVideoTracks()[0];

    return {
      active: track?.readyState === 'live',
      tracks: stream.getVideoTracks().length,
      label: track?.label || 'Fake Camera'
    };
  };


  /*
   * INTERCEPCIÓN DE getUserMedia
   *
   * Cuando Roblox solicite:
   *
   * navigator.mediaDevices.getUserMedia({
   *   video: true
   * })
   *
   * devolvemos nuestro stream persistente.
   */
  navigator.mediaDevices.getUserMedia =
    async function(constraints) {

      if (
        constraints &&
        constraints.video
      ) {

        return createCamera();
      }

      /*
       * Si alguna parte solicita audio,
       * dejamos el comportamiento original.
       */
      return originalGetUserMedia(
        constraints
      );
    };


  window.__cameraAutomationReady = true;
};


/*
 * ------------------------------------------------------------
 * UTILIDADES
 * ------------------------------------------------------------
 */

async function wait(ms) {
  await new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}



async function clickButton(page, text, timeout = 30000) {
  console.log(`➡️ Buscando botón "${text}"...`);

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {

    /*
     * ========================================================
     * BUSCAR DIALOG VISIBLE
     * ========================================================
     */

    const dialogs = page.locator(
      '[role="dialog"], [data-radix-dialog-content]'
    );

    const dialogCount = await dialogs.count();

    for (let i = 0; i < dialogCount; i++) {

      const dialog = dialogs.nth(i);

      if (
        !(await dialog.isVisible().catch(() => false))
      ) {
        continue;
      }

      console.log(
        `🔎 Dialog encontrado. Buscando botón inferior "${text}"...`
      );


      /*
       * ======================================================
       * BUSCAR TODOS LOS BUTTON DEL DIALOG
       * ======================================================
       */

      const buttons = dialog.locator('button');

      const buttonCount = await buttons.count();

      console.log(
        `🔎 Botones encontrados en Dialog: ${buttonCount}`
      );


      /*
       * Recorremos TODOS los botones.
       *
       * No usamos .first(), porque puede existir otro
       * elemento "Continuar" antes del botón azul.
       */

      const candidates = [];

      for (let j = 0; j < buttonCount; j++) {

        const button = buttons.nth(j);

        if (
          !(await button.isVisible().catch(() => false))
        ) {
          continue;
        }

        const buttonText = (
          await button.innerText().catch(() => '')
        ).trim();

        const ariaLabel =
          await button.getAttribute('aria-label')
            .catch(() => null);

        const disabled =
          await button.isDisabled()
            .catch(() => false);

        const box =
          await button.boundingBox()
            .catch(() => null);

        if (!box) {
          continue;
        }

        /*
         * Solo nos interesan botones cuyo texto sea
         * exactamente "Continuar".
         */

        if (
          buttonText === text ||
          ariaLabel === text
        ) {

          candidates.push({
            button,
            index: j,
            text: buttonText,
            ariaLabel,
            disabled,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          });
        }
      }


      /*
       * ======================================================
       * ELEGIR EL BOTÓN MÁS ABAJO
       * ======================================================
       *
       * El botón azul que quieres pulsar está abajo del Dialog.
       *
       * Por eso elegimos el candidato que tenga la mayor
       * coordenada Y.
       */

      if (candidates.length > 0) {

        candidates.sort(
          (a, b) => b.y - a.y
        );

        const target =
          candidates[0];

        console.log(
          `🎯 Botón "${text}" seleccionado:`
        );

        console.log(
          JSON.stringify({
            index: target.index,
            text: target.text,
            x: target.x,
            y: target.y,
            width: target.width,
            height: target.height,
            disabled: target.disabled
          })
        );


        /*
         * Si el botón está deshabilitado, esperamos.
         */

        if (target.disabled) {

          console.log(
            '⏳ El botón está deshabilitado. Esperando...'
          );

          await page.waitForTimeout(500);

          continue;
        }


        /*
         * ====================================================
         * SCROLL
         * ====================================================
         */

        await target.button
          .scrollIntoViewIfNeeded()
          .catch(() => {});


        /*
         * ====================================================
         * CLICK NORMAL
         * ====================================================
         */

        try {

          await target.button.click({
            timeout: 5000
          });

          console.log(
            `✅ Botón azul inferior "${text}" pulsado.`
          );

          return;

        } catch (normalError) {

          console.log(
            '⚠️ Click normal falló. Intentando force...'
          );


          /*
           * ==================================================
           * FORCE CLICK
           * ==================================================
           */

          try {

            await target.button.click({
              force: true,
              timeout: 5000
            });

            console.log(
              `✅ Botón "${text}" pulsado con force:true.`
            );

            return;

          } catch (forceError) {

            console.log(
              '⚠️ force:true también falló.'
            );
          }


          /*
           * ==================================================
           * CLICK POR COORDENADAS
           * ==================================================
           *
           * Como último recurso hacemos click en el centro
           * del botón real encontrado.
           */

          try {

            const box =
              await target.button.boundingBox();

            if (box) {

              const centerX =
                box.x + box.width / 2;

              const centerY =
                box.y + box.height / 2;

              console.log(
                `🖱️ Click por coordenadas: ${centerX}, ${centerY}`
              );

              await page.mouse.click(
                centerX,
                centerY
              );

              console.log(
                `✅ Botón "${text}" pulsado por coordenadas.`
              );

              return;
            }

          } catch (coordinateError) {

            console.log(
              '⚠️ Click por coordenadas falló:',
              coordinateError.message
            );
          }
        }
      }


      /*
       * ======================================================
       * SI NO ENCONTRAMOS BUTTON, DIAGNÓSTICO
       * ======================================================
       */

      const allElements =
        dialog.locator(
          'button, [role="button"]'
        );

      const totalElements =
        await allElements.count();

      for (
        let j = 0;
        j < totalElements;
        j++
      ) {

        const element =
          allElements.nth(j);

        if (
          !(await element.isVisible()
            .catch(() => false))
        ) {
          continue;
        }

        const txt =
          (
            await element.innerText()
              .catch(() => '')
          ).trim();

        if (txt.includes(text)) {

          const box =
            await element.boundingBox()
              .catch(() => null);

          console.log(
            '🔍 Candidato encontrado:',
            {
              index: j,
              text: txt,
              box
            }
          );
        }
      }
    }


    /*
     * ========================================================
     * BUSCAR FUERA DEL DIALOG
     * ========================================================
     */

    const globalButtons =
      page.locator(
        'button, [role="button"]'
      );

    const globalCount =
      await globalButtons.count();

    const globalCandidates = [];

    for (
      let i = 0;
      i < globalCount;
      i++
    ) {

      const button =
        globalButtons.nth(i);

      if (
        !(await button.isVisible()
          .catch(() => false))
      ) {
        continue;
      }

      const txt =
        (
          await button.innerText()
            .catch(() => '')
        ).trim();

      if (txt !== text) {
        continue;
      }

      const disabled =
        await button.isDisabled()
          .catch(() => false);

      const box =
        await button.boundingBox()
          .catch(() => null);

      if (!box) {
        continue;
      }

      globalCandidates.push({
        button,
        y: box.y,
        box,
        disabled
      });
    }


    /*
     * Elegimos igualmente el botón más abajo.
     */

    if (globalCandidates.length > 0) {

      globalCandidates.sort(
        (a, b) => b.y - a.y
      );

      const target =
        globalCandidates[0];

      if (!target.disabled) {

        await target.button
          .scrollIntoViewIfNeeded()
          .catch(() => {});

        try {

          await target.button.click({
            timeout: 5000
          });

        } catch (_) {

          await target.button.click({
            force: true,
            timeout: 5000
          });
        }

        console.log(
          `✅ "${text}" pulsado.`
        );

        return;
      }
    }


    /*
     * Esperar antes de volver a buscar.
     */

    await page.waitForTimeout(500);
  }


  /*
   * ========================================================
   * ERROR
   * ========================================================
   */

  throw new Error(
    `No se pudo encontrar el botón inferior "${text}" después de ${timeout} ms.`
  );
}




async function waitForText(
  page,
  texts,
  timeout = TIMEOUT
) {

  const start = Date.now();

  while (
    Date.now() - start < timeout
  ) {

    for (const text of texts) {

      const visible =
        await page
          .getByText(text, {
            exact: true
          })
          .first()
          .isVisible()
          .catch(() => false);

      if (visible) {

        console.log(
          `✅ Apareció texto "${text}".`
        );

        return text;
      }
    }

    await wait(500);
  }

  throw new Error(
    `No apareció: ${texts.join(' / ')}`
  );
}


async function waitForButton(
  page,
  texts,
  timeout = TIMEOUT
) {

  const start = Date.now();

  while (
    Date.now() - start < timeout
  ) {

    for (const text of texts) {

      const visible =
        await page
          .getByRole('button', {
            name: text,
            exact: true
          })
          .first()
          .isVisible()
          .catch(() => false);

      if (visible) {

        console.log(
          `✅ Apareció botón "${text}".`
        );

        return text;
      }
    }

    await wait(500);
  }

  throw new Error(
    `No apareció ningún botón: ${texts.join(' / ')}`
  );
}


/*
 * Espera texto O botón.
 */
async function waitForTextOrButton(
  page,
  texts,
  buttons,
  timeout = TIMEOUT
) {

  const start = Date.now();

  while (
    Date.now() - start < timeout
  ) {

    for (const text of texts) {

      const visible =
        await page
          .getByText(text, {
            exact: true
          })
          .first()
          .isVisible()
          .catch(() => false);

      if (visible) {

        console.log(
          `✅ Condición cumplida por texto: "${text}".`
        );

        return {
          type: 'text',
          value: text
        };
      }
    }

    for (const button of buttons) {

      const visible =
        await page
          .getByRole('button', {
            name: button,
            exact: true
          })
          .first()
          .isVisible()
          .catch(() => false);

      if (visible) {

        console.log(
          `✅ Condición cumplida por botón: "${button}".`
        );

        return {
          type: 'button',
          value: button
        };
      }
    }

    await wait(500);
  }

  throw new Error(
    'No apareció ninguna condición esperada.'
  );
}


/*
 * ------------------------------------------------------------
 * CAMBIAR VIDEO DE CÁMARA
 * ------------------------------------------------------------
 */

async function setCameraVideo(
  page,
  filename
) {

  const url =
    `http://127.0.0.1:${PORT}/${filename}`;

  console.log(
    `📷 Cambiando cámara a ${filename}...`
  );

  const result =
    await page.evaluate(async (videoUrl) => {

      if (
        typeof window.__setCameraVideo !==
        'function'
      ) {

        throw new Error(
          'La cámara virtual no está inicializada.'
        );
      }

      return window.__setCameraVideo(
        videoUrl
      );

    }, url);

  console.log(
    `✅ Cámara cambiada a ${filename}.`
  );

  console.log(
    `📷 Tracks activas: ${result.tracks}`
  );
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

  await page.goto(
    ACCOUNT_URL,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }
  );

  await wait(3000);

  if (
    page.url().includes('/login')
  ) {

    throw new Error(
      'La cookie .ROBLOSECURITY parece inválida o expiró.'
    );
  }

  console.log(
    '✅ Sesión iniciada.'
  );

  console.log(
    '➡️ Buscando idioma...'
  );

  const nativeSelect =
    page
      .locator('select')
      .filter({
        hasText: 'Español'
      })
      .first();

  if (
    await nativeSelect.count() > 0
  ) {

    await nativeSelect.selectOption({
      label: TARGET_LANGUAGE_LABEL
    });

  } else {

    const dropdown =
      page
        .locator(
          '[class*="language"] button,' +
          '[class*="Language"] button,' +
          '[data-testid*="language"]'
        )
        .first();

    await dropdown.click({
      timeout: 10000
    });

    await wait(1000);

    await page
      .getByText(
        TARGET_LANGUAGE_LABEL,
        {
          exact: true
        }
      )
      .first()
      .click({
        timeout: 10000
      });
  }

  console.log(
    '✅ Idioma cambiado.'
  );

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

  await page.goto(
    GAME_URL,
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }
  );

  await wait(5000);

  /*
   * ----------------------------------------------------------
   * CODES
   * ----------------------------------------------------------
   */


await clickButton(
  page,
  'Continuar con la cámara',
  30000
);

console.log('✅ CODES pulsado.');

await page.waitForTimeout(1000);

console.log('➡️ Buscando primer Continuar...');

await clickButton(
  page,
  'Continuar',
  30000
);

console.log('✅ Primer Continuar pulsado.');

await page.waitForTimeout(1000);

console.log('➡️ Buscando segundo Continuar...');

await clickButton(
  page,
  'Continuar',
  30000
);

console.log('✅ Segundo Continuar pulsado.');

  /*
   * ----------------------------------------------------------
   * CÁMARA
   * ----------------------------------------------------------
   */

  console.log(
    '📷 Comprobando cámara virtual...'
  );

  const cameraInfo =
    await page.evaluate(async () => {

      return window.__getCameraInfo();

    });

  console.log(
    '📷 Cámara:',
    cameraInfo
  );

  /*
   * ----------------------------------------------------------
   * VIDEO 1
   * ----------------------------------------------------------
   */

  await setCameraVideo(
    page,
    'video1.mp4'
  );

  console.log(
    '⏳ Esperando "codigo" o "De acuerdo"...'
  );

  await waitForTextOrButton(
    page,
    [
      'izquierda',
      'Código'
    ],
    [
      'Tomar foto'
    ],
    60000
  );

  /*
   * ----------------------------------------------------------
   * VIDEO 2
   * ----------------------------------------------------------
   *
   * IMPORTANTE:
   *
   * NO cerramos:
   * - browser
   * - context
   * - page
   *
   * Solamente cambiamos la fuente de la cámara.
   */

  await setCameraVideo(
    page,
    'video2.mp4'
  );

  console.log(
    '⏳ Esperando "clip gameplay" o "De acuerdo"...'
  );

  await waitForTextOrButton(
    page,
    [
      'derecha',
      'Clip gameplay'
    ],
    [
      'Tomar foto'
    ],
    60000
  );

  /*
   * ----------------------------------------------------------
   * VIDEO 3
   * ----------------------------------------------------------
   */

  await setCameraVideo(
    page,
    'video3.mp4'
  );

  console.log(
    '🎥 Video 3 activo.'
  );

  await wait(3000);

  /*
   * ----------------------------------------------------------
   * ESTA BIEN
   * ----------------------------------------------------------
   */

  console.log(
    '⏳ Esperando "Esta bien"...'
  );

  await clickButton(
    page,
    'Esta bien',
    60000
  );

  console.log(
    '🎉 Flujo completado.'
  );
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

  /*
   * Comprobar vídeos.
   */

  for (
    const [name, file] of
    Object.entries(VIDEOS)
  ) {

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

    /*
     * --------------------------------------------------------
     * UN SOLO BROWSER
     * --------------------------------------------------------
     */

    browser =
      await chromium.launch({

        headless: true,

        args: [
          '--use-fake-ui-for-media-stream',

          /*
           * Necesario para la cámara falsa.
           */
          '--use-fake-device-for-media-stream',

          '--autoplay-policy=no-user-gesture-required',

          '--disable-dev-shm-usage'
        ]
      });

    /*
     * --------------------------------------------------------
     * UN SOLO CONTEXT
     * --------------------------------------------------------
     */

    const context =
      await browser.newContext({

        locale: 'es-ES',

        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36',

        permissions: [
          'camera'
        ]
      });

    await context.grantPermissions(
      ['camera'],
      {
        origin:
          'https://www.roblox.com'
      }
    );

    /*
     * --------------------------------------------------------
     * COOKIE
     * --------------------------------------------------------
     */

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

    /*
     * --------------------------------------------------------
     * PÁGINA
     * --------------------------------------------------------
     */

    const page =
      await context.newPage();

    /*
     * Instalamos la cámara ANTES de navegar.
     */
    await page.addInitScript({
      content:
        `(${CAMERA_INIT_SCRIPT.toString()})();`
    });

    /*
     * Logs de consola.
     */

    page.on(
      'console',
      message => {

        if (
          message.type() === 'error'
        ) {

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

    /*
     * --------------------------------------------------------
     * ETAPA 1
     * --------------------------------------------------------
     */

    await changeLanguage(page);

    /*
     * --------------------------------------------------------
     * ETAPA 2
     * --------------------------------------------------------
     */

    await runGameFlow(page);

    console.log(
      '================================='
    );

    console.log(
      '🎉 AUTOMATIZACIÓN TERMINADA'
    );

    console.log(
      '================================='
    );

  } catch (error) {

    console.error(
      '================================='
    );

    console.error(
      '❌ AUTOMATIZACIÓN FALLÓ'
    );

    console.error(
      error.stack || error.message
    );

    /*
     * Captura.
     */

    /*
     * browser puede estar abierto.
     */
    if (browser) {

      try {

        const pages =
          browser.contexts()[0]?.pages();

        if (
          pages &&
          pages.length > 0
        ) {

          const page =
            pages[0];

          await page.screenshot({
            path:
              'error-screenshot.png',
            fullPage: true
          });

          console.log(
            '📸 Captura guardada: error-screenshot.png'
          );

          const html =
            await page.content();

          fs.writeFileSync(
            'error-page.html',
            html
          );

          console.log(
            '📄 HTML guardado: error-page.html'
          );
        }

      } catch (captureError) {

        console.error(
          '⚠️ No se pudo guardar la captura:',
          captureError.message
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
