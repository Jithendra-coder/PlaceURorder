export function initLandingEngine() {
  let animFrameId;
  let clockIntervalId;

  
  

  // 1. LIVE TIME & GREETING ENGINE
  function updateKioskTime() {
    const now = new Date();
    const clockEl = document.getElementById('kioskClock');
    const paymentClockEl = document.getElementById('paymentLiveClock');
    const greetingEl = document.getElementById('kioskGreeting');
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (clockEl) clockEl.textContent = timeStr;
    if (paymentClockEl) paymentClockEl.textContent = timeStr;
    if (greetingEl) {
      const h = now.getHours();
      if (h < 12) greetingEl.textContent = 'Good morning';
      else if (h < 17) greetingEl.textContent = 'Good afternoon';
      else greetingEl.textContent = 'Good evening';
    }
  }
  clockIntervalId = setInterval(updateKioskTime, 1000);
  updateKioskTime();

  // 2. SCROLL ENGINE & CHOREOGRAPHY
  const showcaseWrapper = document.getElementById('demo');

  // Kiosk Screens
  const viewMenu = document.getElementById('viewMenu');
  const viewUpsell = document.getElementById('viewUpsell');
  const upsellSheet = document.getElementById('upsellSheetContainer');
  const viewCart = document.getElementById('viewCart');
  const viewPayment = document.getElementById('viewPayment');
  const viewSuccess = document.getElementById('viewSuccess');

  // Interactive Kiosk Cards
  const pizzaCard = document.getElementById('kioskPizzaCard');
  const pizzaAddBtn = document.getElementById('pizzaAddBtn');
  const pizzaQtyStepper = document.getElementById('pizzaQtyStepper');

  const burgerCard = document.getElementById('kioskBurgerCard');
  const burgerAddBtn = document.getElementById('burgerAddBtn');
  const burgerQtyStepper = document.getElementById('burgerQtyStepper');

  const cheeseModifierTile = document.getElementById('cheeseModifierTile');
  const cheeseCheckIndicator = document.getElementById('cheeseCheckIndicator');
  const sheetPriceDisplay = document.getElementById('sheetPriceDisplay');
  const sheetConfirmBtnText = document.getElementById('sheetConfirmBtnText');
  const sheetConfirmBtn = document.getElementById('sheetAddConfirmBtn');
  const sheetCloseBtn = document.querySelector('.sheet-close-btn');
  const kioskBackButtons = document.querySelectorAll('.kiosk-back-arrow-btn');
  const kioskAddMoreBtn = document.querySelector('.kiosk-add-more-btn');

  const payMethodTile1 = document.getElementById('payMethodTile1');

  // Realistic Thermal Receipt Chit Elements
  const receiptSlipWrapper = document.getElementById('receiptSlipWrapper');
  const printSlipBtn = document.getElementById('printSlipBtn');
  const closeReceiptBtn = document.getElementById('closeReceiptBtn');

  // Bottom Unified Dock Button
  const kioskBottomDock = document.getElementById('kioskBottomDock');
  const dockActionButton = document.getElementById('dockActionButton');
  const dockActionLabel = document.getElementById('dockActionLabel');
  const dockBadgeCount = document.getElementById('dockBadgeCount');
  const dockPriceTotal = document.getElementById('dockPriceTotal');

  // Story Stage Cards on Left
  const storyCards = [
    document.getElementById('storyStage1'),
    document.getElementById('storyStage2'),
    document.getElementById('storyStage3'),
    document.getElementById('storyStage4'),
    document.getElementById('storyStage5')
  ];

  // Hand pointer & ripple
  const handCursor = document.getElementById('handCursor');
  const touchRipple = document.getElementById('touchRipple');

  const kioskChassis = document.getElementById('kioskChassis');

  // Coordinate and state tracking
  let targetProgress = 0;
  let currentProgress = 0;
  let handX = 215;
  let handY = 280;
  let lastTriggeredAction = -1;

  function updateScrollProgress() {
    if (!showcaseWrapper) return;
    const rect = showcaseWrapper.getBoundingClientRect();
    const windowH = window.innerHeight;
    const totalDist = showcaseWrapper.offsetHeight - windowH;
    const scrolled = -rect.top;
    targetProgress = Math.max(0, Math.min(1, scrolled / totalDist));
  }
  function scrollToProgress(progress) {
    if (!showcaseWrapper) return;
    const top = showcaseWrapper.getBoundingClientRect().top + window.scrollY;
    const distance = Math.max(0, showcaseWrapper.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + distance * progress, behavior: 'smooth' });
  }
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress);
  updateScrollProgress();

  function triggerTapEffect() {
    touchRipple.classList.remove('burst');
    void touchRipple.offsetWidth;
    touchRipple.classList.add('burst');
    handCursor.classList.add('tapping');
    setTimeout(() => {
      handCursor.classList.remove('tapping');
    }, 180);
  }

  // Smoothstep easing for silky interpolation
  function smoothstep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
  }

  let pizzaBtnPos = { x: 130, y: 280 };
  let burgerBtnPos = { x: 300, y: 280 };
  let dockBtnPos = { x: 180, y: 666 };
  let payCounterPos = { x: 215, y: 248 };
  let sheetBtnPos = { x: 270, y: 600 };
  let cheesePos = { x: 215, y: 440 };
  let printSlipBtnPos = { x: 215, y: 395 };

  function measureElements() {
    if (!kioskChassis) return;
    const cRect = kioskChassis.getBoundingClientRect();

    if (pizzaAddBtn && pizzaAddBtn.offsetWidth > 0) {
      const pRect = pizzaAddBtn.getBoundingClientRect();
      pizzaBtnPos = {
        x: Math.round(pRect.left + pRect.width / 2 - cRect.left),
        y: Math.round(pRect.top + pRect.height / 2 - cRect.top)
      };
    }
    if (burgerAddBtn && burgerAddBtn.offsetWidth > 0) {
      const bRect = burgerAddBtn.getBoundingClientRect();
      burgerBtnPos = {
        x: Math.round(bRect.left + bRect.width / 2 - cRect.left),
        y: Math.round(bRect.top + bRect.height / 2 - cRect.top)
      };
    }
    if (dockActionButton && dockActionButton.offsetWidth > 0) {
      const dRect = dockActionButton.getBoundingClientRect();
      dockBtnPos = {
        x: Math.round(dRect.left + dRect.width * 0.42 - cRect.left),
        y: Math.round(dRect.top + dRect.height * 0.45 - cRect.top)
      };
    }
    if (payMethodTile1 && payMethodTile1.offsetWidth > 0) {
      const payRect = payMethodTile1.getBoundingClientRect();
      payCounterPos = {
        x: Math.round(payRect.left + payRect.width * 0.5 - cRect.left),
        y: Math.round(payRect.top + payRect.height / 2 - cRect.top)
      };
    }
    if (sheetConfirmBtn && sheetConfirmBtn.offsetWidth > 0) {
      const sRect = sheetConfirmBtn.getBoundingClientRect();
      sheetBtnPos = {
        x: Math.round(sRect.left + sRect.width / 2 - cRect.left),
        y: Math.round(sRect.top + sRect.height / 2 - cRect.top)
      };
    }
    if (cheeseModifierTile && cheeseModifierTile.offsetWidth > 0) {
      const chRect = cheeseModifierTile.getBoundingClientRect();
      cheesePos = {
        x: Math.round(chRect.left + chRect.width / 2 - cRect.left),
        y: Math.round(chRect.top + chRect.height / 2 - cRect.top)
      };
    }
    if (printSlipBtn && printSlipBtn.offsetWidth > 0) {
      const prRect = printSlipBtn.getBoundingClientRect();
      printSlipBtnPos = {
        x: Math.round(prRect.left + prRect.width / 2 - cRect.left),
        y: Math.round(prRect.top + prRect.height / 2 - cRect.top)
      };
    }
  }
  window.addEventListener('resize', measureElements);
  setTimeout(measureElements, 250);

  // MATHEMATICALLY EXACT COORDINATES (Calibrated to vertical kiosk chassis):
  function getHandPosition(p) {
    const cH = kioskChassis ? kioskChassis.clientHeight : 695;
    const cW = kioskChassis ? kioskChassis.clientWidth : 430;
    const midX = Math.round(cW / 2);

    // 0.00 to 0.06: Hero Viewport - hand parked below terminal, hidden
    if (p < 0.06) {
      return { x: pizzaBtnPos.x + 35, y: cH + 60 };
    }
    // 0.06 to 0.16: Glides up smoothly from below targeting Pizza ADD button
    else if (p < 0.16) {
      const t = smoothstep(0.06, 0.16, p);
      return {
        x: (pizzaBtnPos.x + 35) + t * -35,
        y: (cH + 60) + t * (pizzaBtnPos.y - (cH + 60))
      };
    }
    // 0.16 to 0.32: DWELL / LATENCY WINDOW on Pizza card
    else if (p < 0.32) {
      return { x: pizzaBtnPos.x, y: pizzaBtnPos.y };
    }
    // 0.32 to 0.38: Glide across from Pizza to Burger ADD button
    else if (p < 0.38) {
      const t = smoothstep(0.32, 0.38, p);
      return {
        x: pizzaBtnPos.x + t * (burgerBtnPos.x - pizzaBtnPos.x),
        y: pizzaBtnPos.y + t * (burgerBtnPos.y - pizzaBtnPos.y)
      };
    }
    // 0.38 to 0.51: Modifier Sheet sequence
    else if (p < 0.51) {
      const t = (p - 0.38) / 0.13;
      if (t < 0.50) {
        // Glide from Burger ADD to Truffle Cheese tile
        const sub = smoothstep(0, 0.50, t);
        return {
          x: burgerBtnPos.x + sub * (cheesePos.x - burgerBtnPos.x),
          y: burgerBtnPos.y + sub * (cheesePos.y - burgerBtnPos.y)
        };
      } else {
        // Glide from Truffle Cheese to Sheet Add button
        const sub = smoothstep(0.50, 1.0, t);
        return {
          x: cheesePos.x + sub * (sheetBtnPos.x - cheesePos.x),
          y: cheesePos.y + sub * (sheetBtnPos.y - cheesePos.y)
        };
      }
    }
    // 0.51 to 0.54: DWELL WINDOW after Burger added
    else if (p < 0.54) {
      return { x: sheetBtnPos.x, y: sheetBtnPos.y };
    }
    // 0.54 to 0.60: Glide from sheet footer down to Bottom Dock View Cart
    else if (p < 0.60) {
      const t = smoothstep(0.54, 0.60, p);
      return {
        x: sheetBtnPos.x + t * (dockBtnPos.x - sheetBtnPos.x),
        y: sheetBtnPos.y + t * (dockBtnPos.y - sheetBtnPos.y)
      };
    }
    // 0.60 to 0.72: In Review Screen, hover/tap Proceed to Payment at Bottom Dock
    else if (p < 0.72) {
      return { x: dockBtnPos.x, y: dockBtnPos.y };
    }
    // 0.72 to 0.78: In Payment Screen, glide up to Pay at Cashier Counter tile
    else if (p < 0.78) {
      const t = smoothstep(0.72, 0.78, p);
      return {
        x: dockBtnPos.x + t * (payCounterPos.x - dockBtnPos.x),
        y: dockBtnPos.y + t * (payCounterPos.y - dockBtnPos.y)
      };
    }
    // 0.78 to 0.86: Glide down from Pay at Counter to Bottom Dock Place Order
    else if (p < 0.86) {
      const t = smoothstep(0.78, 0.86, p);
      return {
        x: payCounterPos.x + t * (dockBtnPos.x - payCounterPos.x),
        y: payCounterPos.y + t * (dockBtnPos.y - payCounterPos.y)
      };
    }
    // 0.86 to 0.92: In Success Screen, glide from dock button to Print Bill Slip button
    else if (p < 0.92) {
      const t = smoothstep(0.86, 0.92, p);
      return {
        x: dockBtnPos.x + t * (printSlipBtnPos.x - dockBtnPos.x),
        y: dockBtnPos.y + t * (printSlipBtnPos.y - dockBtnPos.y)
      };
    }
    // 0.92 to 1.00: Bill slip is printed! Hand rests gracefully to the right side of chit
    else {
      const restX = Math.min(cW - 35, midX + 95);
      const restY = Math.round(cH * 0.68);
      return {
        x: restX + Math.sin(Date.now() * 0.003) * 3,
        y: restY + Math.cos(Date.now() * 0.003) * 2
      };
    }
  }

  // 100% Silky Frame Loop
  function renderFrame() {
    // Smooth continuous damping
    currentProgress += (targetProgress - currentProgress) * 0.09;
    const p = currentProgress;

    const targetPos = getHandPosition(p);
    handX += (targetPos.x - handX) * 0.12;
    handY += (targetPos.y - handY) * 0.12;
    handCursor.style.transform = `translate(${handX}px, ${handY}px)`;

    // Hand visibility: only show when scrolling down to explore interactive kiosk flow
    if (p < 0.05) {
      handCursor.style.opacity = '0';
      handCursor.style.pointerEvents = 'none';
    } else if (p < 0.12) {
      const alpha = (p - 0.05) / 0.07;
      handCursor.style.opacity = String(Math.min(1, Math.max(0, alpha)));
      handCursor.style.pointerEvents = 'none';
    } else if (p >= 0.93) {
      // After order placed & bill slip printed, hand retreats completely so screen is clean!
      const retreatAlpha = Math.max(0, 1 - (p - 0.93) / 0.05);
      handCursor.style.opacity = String(retreatAlpha);
      handCursor.style.pointerEvents = 'none';
    } else {
      handCursor.style.opacity = '1';
    }

    // ── PRECISE STATE MACHINE ──
    if (p < 0.86 && kioskBottomDock) {
      kioskBottomDock.classList.remove('hidden');
    }

    // 1. Stage 1: Margherita Pizza (0.00 to 0.32)
    if (p < 0.32) {
      viewMenu.classList.add('active');
      viewUpsell.classList.remove('active');
      upsellSheet.classList.remove('open');
      viewCart.classList.remove('active');
      viewPayment.classList.remove('active');
      viewSuccess.classList.remove('active');

      if (p >= 0.18) {
        // Pizza tapped!
        pizzaCard.classList.add('targeted');
        if (p < 0.22) {
          // Momentary "ADDED ✓" state
          pizzaAddBtn.style.display = 'inline-flex';
          pizzaAddBtn.classList.add('in-cart');
          pizzaAddBtn.textContent = 'ADDED ✓';
          pizzaQtyStepper.classList.remove('visible');
          pizzaCard.classList.add('pressed');
        } else {
          // Smoothly transitions into quantity stepper "[-] 1 [+]"!
          pizzaAddBtn.style.display = 'none';
          pizzaQtyStepper.classList.add('visible');
          pizzaCard.classList.remove('pressed');
        }
        dockBadgeCount.textContent = '1 item';
        dockPriceTotal.textContent = '$14.50';

        if (lastTriggeredAction !== 1) {
          triggerTapEffect();
          lastTriggeredAction = 1;
        }
      } else {
        // Initial state before tap (Hero and initial glide)
        pizzaCard.classList.remove('targeted');
        pizzaAddBtn.style.display = 'inline-flex';
        pizzaAddBtn.classList.remove('in-cart');
        pizzaAddBtn.textContent = 'ADD +';
        pizzaQtyStepper.classList.remove('visible');
        pizzaCard.classList.remove('pressed');
        dockBadgeCount.textContent = '0 items';
        dockPriceTotal.textContent = '$0.00';
        if (p < 0.08) lastTriggeredAction = -1;
      }

      burgerCard.classList.remove('targeted');
      dockActionLabel.textContent = 'View Cart';
      burgerAddBtn.style.display = 'inline-flex';
      burgerAddBtn.classList.remove('in-cart');
      burgerAddBtn.textContent = 'ADD +';
      burgerQtyStepper.classList.remove('visible');
      burgerCard.classList.remove('pressed');
      dockActionButton.classList.remove('pressed');
    }

    // 2. Stage 2: Truffle Smash Burger & Modifier Sheet (0.32 to 0.54)
    else if (p >= 0.32 && p < 0.54) {
      viewMenu.classList.add('active');
      viewCart.classList.remove('active');
      viewPayment.classList.remove('active');
      viewSuccess.classList.remove('active');

      // Keep Pizza stepper active
      pizzaCard.classList.remove('targeted');
      pizzaAddBtn.style.display = 'none';
      pizzaQtyStepper.classList.add('visible');

      burgerCard.classList.add('targeted');
      dockActionLabel.textContent = 'View Cart';

      // 0.32 to 0.38: Glide to Burger
      if (p < 0.38) {
        viewUpsell.classList.remove('active');
        upsellSheet.classList.remove('open');
        burgerAddBtn.style.display = 'inline-flex';
        burgerAddBtn.classList.remove('in-cart');
        burgerAddBtn.textContent = 'ADD +';
        burgerQtyStepper.classList.remove('visible');
        burgerCard.classList.remove('pressed');
        cheeseModifierTile.classList.remove('active');
        cheeseCheckIndicator.textContent = '';
        sheetPriceDisplay.textContent = '$12.90';
        sheetConfirmBtnText.textContent = 'Add Item · $12.90';
        dockBadgeCount.textContent = '1 item';
        dockPriceTotal.textContent = '$14.50';
      }
      // 0.38 to 0.50: Inside Modifier Sheet
      else if (p < 0.50) {
        viewUpsell.classList.add('active');
        upsellSheet.classList.add('open');
        burgerCard.classList.add('pressed');

        if (lastTriggeredAction !== 2) {
          triggerTapEffect();
          lastTriggeredAction = 2;
        }

        // 0.44: Tap Truffle Cheese
        if (p >= 0.44) {
          cheeseModifierTile.classList.add('active');
          cheeseCheckIndicator.textContent = '✓';
          sheetPriceDisplay.textContent = '$15.40';
          sheetConfirmBtnText.textContent = 'Add Item · $15.40';

          if (lastTriggeredAction !== 3) {
            triggerTapEffect();
            lastTriggeredAction = 3;
          }
        } else {
          cheeseModifierTile.classList.remove('active');
          cheeseCheckIndicator.textContent = '';
          sheetPriceDisplay.textContent = '$12.90';
          sheetConfirmBtnText.textContent = 'Add Item · $12.90';
        }

        burgerAddBtn.style.display = 'inline-flex';
        burgerAddBtn.textContent = 'ADD +';
        burgerQtyStepper.classList.remove('visible');
        dockBadgeCount.textContent = '1 item';
        dockPriceTotal.textContent = '$14.50';
      }
      // 0.50 to 0.54: Added to Cart!
      else {
        upsellSheet.classList.remove('open');
        viewUpsell.classList.remove('active');
        burgerCard.classList.remove('pressed');

        // Burger transitions to quantity stepper!
        burgerAddBtn.style.display = 'none';
        burgerQtyStepper.classList.add('visible');

        dockBadgeCount.textContent = '2 items';
        dockPriceTotal.textContent = '$29.90';

        if (lastTriggeredAction !== 4) {
          triggerTapEffect();
          lastTriggeredAction = 4;
        }
      }
      dockActionButton.classList.remove('pressed');
    }

    // 3. Stage 3: Tap View Cart -> Authentic Cart Review (0.54 to 0.72)
    else if (p >= 0.54 && p < 0.72) {
      viewUpsell.classList.remove('active');
      upsellSheet.classList.remove('open');
      pizzaCard.classList.remove('targeted');
      burgerCard.classList.remove('targeted');

      if (p < 0.60) {
        // Still on Menu screen, hand gliding to View Cart dock
        viewMenu.classList.add('active');
        viewCart.classList.remove('active');
        viewPayment.classList.remove('active');
        viewSuccess.classList.remove('active');

        dockActionLabel.textContent = 'View Cart';
        dockBadgeCount.textContent = '2 items';
        dockPriceTotal.textContent = '$29.90';
        dockActionButton.classList.remove('pressed');
      } else {
        // Tapped View Cart! Authentic Cart Review active!
        viewMenu.classList.remove('active');
        viewCart.classList.add('active');
        viewPayment.classList.remove('active');
        viewSuccess.classList.remove('active');

        dockActionLabel.textContent = 'Proceed to Payment →';
        dockBadgeCount.textContent = '2 items';
        dockPriceTotal.textContent = '$32.29';

        if (lastTriggeredAction !== 5) {
          triggerTapEffect();
          dockActionButton.classList.add('pressed');
          setTimeout(() => dockActionButton.classList.remove('pressed'), 200);
          lastTriggeredAction = 5;
        }
      }
    }

    // 4. Stage 4: Proceed to Payment -> Payment Screen -> Card or Register (0.72 to 0.86)
    else if (p >= 0.72 && p < 0.86) {
      viewMenu.classList.remove('active');
      viewUpsell.classList.remove('active');
      upsellSheet.classList.remove('open');
      viewCart.classList.remove('active');
      viewPayment.classList.add('active');
      viewSuccess.classList.remove('active');
      if (kioskBottomDock) kioskBottomDock.classList.remove('hidden');
      if (receiptSlipWrapper) receiptSlipWrapper.classList.remove('slip-active');
      if (printSlipBtn) printSlipBtn.classList.remove('active');
      if (lastTriggeredAction > 6) lastTriggeredAction = 6;

      if (p < 0.78) {
        // Hand gliding to Card or Digital Wallet tile
        if (payMethodTile1) payMethodTile1.classList.remove('active');
        dockActionLabel.textContent = 'Pay $32.29 →';
        dockBadgeCount.textContent = '2 items';
        dockPriceTotal.textContent = '$32.29';
      } else {
        // Selected Card & Digital Wallet!
        if (payMethodTile1) payMethodTile1.classList.add('active');
        dockActionLabel.textContent = 'Pay $32.29 →';
        dockBadgeCount.textContent = 'Contactless';
        dockPriceTotal.textContent = '$32.29';

        if (lastTriggeredAction !== 6) {
          triggerTapEffect();
          lastTriggeredAction = 6;
        }
      }

      if (p >= 0.84) {
        dockActionButton.classList.add('pressed');
      } else {
        dockActionButton.classList.remove('pressed');
      }
    }

    // 5. Stage 5: Order Confirmed Screen (0.86 to 1.00)
    else {
      viewMenu.classList.remove('active');
      viewUpsell.classList.remove('active');
      upsellSheet.classList.remove('open');
      viewCart.classList.remove('active');
      viewPayment.classList.remove('active');
      viewSuccess.classList.add('active');

      // The button to pay / bottom dock is GONE after order is placed!
      if (kioskBottomDock) kioskBottomDock.classList.add('hidden');

      if (lastTriggeredAction !== 7 && lastTriggeredAction !== 8) {
        triggerTapEffect();
        lastTriggeredAction = 7;
      }

      // Automatically feed out the printed bill slip at p >= 0.90
      if (p >= 0.90) {
        if (receiptSlipWrapper) receiptSlipWrapper.classList.add('slip-active');
        if (printSlipBtn) printSlipBtn.classList.add('active');
        if (lastTriggeredAction !== 8) {
          triggerTapEffect();
          lastTriggeredAction = 8;
        }
      } else {
        if (receiptSlipWrapper) receiptSlipWrapper.classList.remove('slip-active');
        if (printSlipBtn) printSlipBtn.classList.remove('active');
        if (lastTriggeredAction === 8) {
          lastTriggeredAction = 7;
        }
      }
    }

    // Synchronize left-side story stage cards
    let activeStoryIdx = -1;
    if (p >= 0.12 && p < 0.32) activeStoryIdx = 0;
    else if (p >= 0.32 && p < 0.54) activeStoryIdx = 1;
    else if (p >= 0.54 && p < 0.72) activeStoryIdx = 2;
    else if (p >= 0.72 && p < 0.86) activeStoryIdx = 3;
    else if (p >= 0.86) activeStoryIdx = 4;

    storyCards.forEach((c, idx) => {
      if (c) c.classList.toggle('is-active', idx === activeStoryIdx);
    });

    animFrameId = requestAnimationFrame(renderFrame);
  }
  animFrameId = requestAnimationFrame(renderFrame);

  if (sheetCloseBtn) sheetCloseBtn.addEventListener('click', () => scrollToProgress(0.35));
  if (sheetConfirmBtn) sheetConfirmBtn.addEventListener('click', () => scrollToProgress(0.52));
  if (kioskBackButtons[0]) kioskBackButtons[0].addEventListener('click', () => scrollToProgress(0.56));
  if (kioskBackButtons[1]) kioskBackButtons[1].addEventListener('click', () => scrollToProgress(0.62));
  if (kioskAddMoreBtn) kioskAddMoreBtn.addEventListener('click', () => scrollToProgress(0.56));
  if (dockActionButton) dockActionButton.addEventListener('click', () => {
    scrollToProgress(targetProgress < 0.60 ? 0.62 : targetProgress < 0.72 ? 0.75 : 0.88);
  });

  // Category rail tab click interactivity
  document.querySelectorAll('.kiosk-category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.kiosk-category-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Printed Slip Interactivity (Print Bill & Close)
  if (printSlipBtn) {
    printSlipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (receiptSlipWrapper) receiptSlipWrapper.classList.toggle('slip-active');
    });
  }
  if (closeReceiptBtn) {
    closeReceiptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (receiptSlipWrapper) receiptSlipWrapper.classList.remove('slip-active');
    });
  }
  if (receiptSlipWrapper) {
    receiptSlipWrapper.addEventListener('click', (e) => {
      if (e.target === receiptSlipWrapper) {
        receiptSlipWrapper.classList.remove('slip-active');
      }
    });
  }

  // 3. ROI CALCULATOR ENGINE
  const customerSlider = document.getElementById('customerSlider');
  const wageSlider = document.getElementById('wageSlider');
  const customerCountLabel = document.getElementById('customerCountLabel');
  const wageLabel = document.getElementById('wageLabel');
  const laborDollarsSaved = document.getElementById('laborDollarsSaved');
  const laborHoursSub = document.getElementById('laborHoursSub');
  const upsellProfit = document.getElementById('upsellProfit');
  const annualTotalGain = document.getElementById('annualTotalGain');
  const paybackDays = document.getElementById('paybackDays');
  const wagePresetBtns = document.querySelectorAll('.wage-preset-btn');

  function updateSliderFill(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--mt-blue) 0%, var(--mt-blue) ${pct}%, #E2E8F0 ${pct}%, #E2E8F0 100%)`;
  }

  function calculateROI() {
    const customers = parseInt(customerSlider.value, 10);
    const wage = parseInt(wageSlider.value, 10);

    customerCountLabel.textContent = customers.toLocaleString();
    wageLabel.textContent = '$' + wage + ' / hr';

    // Update track fills
    updateSliderFill(customerSlider);
    updateSliderFill(wageSlider);

    // Sync wage preset buttons
    wagePresetBtns.forEach(btn => {
      if (parseInt(btn.dataset.wage, 10) === wage) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Labor savings: ~1.5 min cashier time saved per order
    const monthlyHours = Math.round((customers * 1.5 * 30) / 60);
    const monthlyLaborCostSaved = Math.round(monthlyHours * wage);

    laborDollarsSaved.textContent = '$' + monthlyLaborCostSaved.toLocaleString();
    laborHoursSub.textContent = monthlyHours.toLocaleString() + ' cashier hours saved';

    // Upsell profit: ~40% take a $3.20 add-on
    const monthlyUpsell = Math.round(customers * 0.40 * 3.20 * 30);
    upsellProfit.textContent = '+$' + monthlyUpsell.toLocaleString();

    // Total net annual profit = (Labor + Upsell) * 12
    const totalMonthly = monthlyLaborCostSaved + monthlyUpsell;
    const annualTotal = totalMonthly * 12;
    annualTotalGain.textContent = '$' + annualTotal.toLocaleString();

    // Payback period on $399 iPad tablet setup
    const dailyBenefit = totalMonthly / 30;
    const days = Math.max(3, Math.round(399 / Math.max(1, dailyBenefit)));
    paybackDays.textContent = '~' + days + ' days';
  }

  wagePresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      wageSlider.value = btn.dataset.wage;
      calculateROI();
    });
  });

  customerSlider.addEventListener('input', calculateROI);
  wageSlider.addEventListener('input', calculateROI);
  calculateROI();

  // 4. FAQ ACCORDION ENGINE (Single-open, centered SVG +/x rotation)
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const currentItem = btn.closest('.faq-item');
      const wasOpen = currentItem.classList.contains('open');

      // Close all items
      document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('open');
        const qBtn = item.querySelector('.faq-question');
        if (qBtn) qBtn.setAttribute('aria-expanded', 'false');
      });

      // If clicked item wasn't open, open it
      if (!wasOpen) {
        currentItem.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // 4. SCROLL REVEAL OBSERVER (Vercel / Linear Reveal on Scroll)
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-revealed'));
  }



  return function cleanup() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (clockIntervalId) clearInterval(clockIntervalId);
    window.removeEventListener('scroll', updateScrollProgress);
    window.removeEventListener('resize', updateScrollProgress);
    window.removeEventListener('resize', measureElements);
  };
}
