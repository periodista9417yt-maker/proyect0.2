    // -------------------------------------------------------------------------
    // CÁMARA Y DIÁLOGOS DE PERSONA (DENTRO DE IFRAME)
    // -------------------------------------------------------------------------
    console.log('➡️ Buscando y haciendo clic en "Continuar con la cámara"...');
    const cameraButton = page.locator('button:has-text("Continuar con la cámara"), [role="button"]:has-text("Continuar con la cámara")').first();
    await cameraButton.waitFor({ state: 'visible', timeout: 15000 });
    await cameraButton.click({ force: true });
    console.log('✅ Botón "Continuar con la cámara" presionado.');

    console.log('➡️ Esperando a que cargue el iframe de Persona...');
    // Esperamos a que el iframe de Persona aparezca en la página
    const iframeElement = page.locator('iframe[src*="withpersona.com"], iframe[title*="Persona"]').first();
    await iframeElement.waitFor({ state: 'attached', timeout: 15000 });
    
    // Cambiamos el contexto de ejecución al interior del iframe
    const personaFrame = page.frameLocator('iframe[src*="withpersona.com"], iframe[title*="Persona"]').first();

    // Primer botón "Continuar" dentro del iframe de Persona
    console.log('➡️ Buscando el primer botón "Continuar" dentro de Persona...');
    const firstContinueButton = personaFrame.locator('button:has-text("Continuar"), [role="button"]:has-text("Continuar")').first();
    await firstContinueButton.waitFor({ state: 'visible', timeout: 20000 });
    
    await page.screenshot({ path: 'paso-primer-continuar.png', fullPage: true });
    console.log('📸 Captura guardada: paso-primer-continuar.png');

    await firstContinueButton.click({ force: true });
    console.log('✅ Primer botón "Continuar" presionado.');

    // Segundo botón "Continuar" dentro del iframe de Persona
    console.log('➡️ Esperando el siguiente paso dentro de Persona y haciendo clic en "Continuar"...');
    await page.waitForTimeout(2000);
    const secondContinueButton = personaFrame.locator('button:has-text("Continuar"), [role="button"]:has-text("Continuar")').first();
    await secondContinueButton.waitFor({ state: 'visible', timeout: 15000 });
    await secondContinueButton.click({ force: true });
    console.log('✅ Segundo botón "Continuar" presionado.');

    // -------------------------------------------------------------------------
    // TRANSMISIÓN WEBRTC Y CAPTURAS POR TEXTO ("izquierda", "derecha", "estimando")
    // -------------------------------------------------------------------------
    console.log('➡️ Monitoreando transmisión WebRTC y textos dentro del iframe...');

    // Esperar y capturar cuando aparezca el texto "izquierda" (dentro del iframe)
    try {
      console.log('⏳ Esperando texto "izquierda"...');
      await personaFrame.getByText(/izquierda/i).first().waitFor({ state: 'visible', timeout: 20000 });
      await page.screenshot({ path: 'paso-izquierda.png', fullPage: true });
      console.log('📸 Captura guardada: paso-izquierda.png');
    } catch (e) {
      console.log('⚠️ No se detectó explícitamente el texto "izquierda", continuando...');
    }

    // Esperar y capturar cuando aparezca el texto "derecha" (dentro del iframe)
    try {
      console.log('⏳ Esperando texto "derecha"...');
      await personaFrame.getByText(/derecha/i).first().waitFor({ state: 'visible', timeout: 20000 });
      await page.screenshot({ path: 'paso-derecha.png', fullPage: true });
      console.log('📸 Captura guardada: paso-derecha.png');
    } catch (e) {
      console.log('⚠️ No se detectó explícitamente el texto "derecha", continuando...');
    }

    // Esperar y capturar cuando aparezca el texto de finalización ("estimando" o similar en la página o iframe)
    try {
      console.log('⏳ Esperando texto "estimando"...');
      await personaFrame.getByText(/estimando/i).first().waitFor({ state: 'visible', timeout: 25000 });
      await page.screenshot({ path: 'paso-estimando.png', fullPage: true });
      console.log('📸 Captura guardada: paso-estimando.png');
      console.log('✅ Proceso de verificación de edad finalizado correctamente.');
    } catch (e) {
      await page.screenshot({ path: 'paso-transmision-webrtc.png', fullPage: true });
      console.log('📸 Captura de respaldo guardada: paso-transmision-webrtc.png');
    }
