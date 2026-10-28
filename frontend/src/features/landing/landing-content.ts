export const LANDING_HTML = String.raw`<!-- ═══════════════ TOP NAVIGATION WITH EXACT APP LOGO ═══════════════ -->
<nav class="nav">
  <a href="/" class="mt-brand-logo" aria-label="Place UR Order">
    <img src="/place-ur-order-logo.png" alt="Place UR Order" class="mt-brand-logo-img" />
  </a>

  <ul class="nav-links">
    <li><a href="#demo">Live Demo</a></li>
    <li><a href="#industries">Menu Setups</a></li>
    <li><a href="#hardware">Hardware</a></li>
    <li><a href="#roi">Savings Calculator</a></li>
  </ul>
  <details class="nav-menu">
    <summary class="nav-menu-toggle" aria-label="Toggle navigation menu">
      <svg class="nav-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      <svg class="nav-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </summary>
    <div class="mobile-nav">
      <a href="#demo">Live Demo</a>
      <a href="#industries">Menu Setups</a>
      <a href="#hardware">Hardware</a>
      <a href="#roi">Savings Calculator</a>
      <div class="mobile-nav-actions">
        <a href="/auth/sign-in">Sign In</a>
        <a href="/auth/sign-up" class="btn-primary">Get Started Free</a>
      </div>
    </div>
  </details>
  <div class="nav-actions">
    <a href="/auth/sign-in" class="nav-signin">Sign In</a>
    <a href="/auth/sign-up" class="btn-primary">
      Get Started Free
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
    </a>
  </div>
</nav>

<!-- ═══════════════ UNIFIED HERO + RIGHT-SIDE LIVE KIOSK SHOWCASE ═══════════════ -->
<section id="demo" class="hero-showcase-section">
  <div class="hero-showcase-container">

    <!-- LEFT COLUMN: Hero content + Scrolling story stages -->
    <div class="hero-content-col">

      <!-- Hero Introduction (First Screen Viewport) -->
      <div class="hero-block">
        <div class="hero-pill">
          <span class="pill-dot"></span>
          Touchscreen Counter Ordering
        </div>
        <h1>Serve more guests in less time. <span class="highlight">Shorter lines, bigger checks.</span></h1>
        <p class="hero-sub">
          Turn any iPad or Android tablet into an intuitive ordering station. Let guests customize meals, send orders directly to your kitchen, and keep lines moving during peak hours without costly hardware leases.
        </p>
        <div class="hero-ctas">
          <a href="/auth/sign-up" class="btn-primary">
            Start 14 Day Free Trial
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
          </a>
          <a href="#storyStage1" class="btn-secondary">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><circle cx="8" cy="8" r="6"/><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" stroke="none"/></svg>
            See Live Demo Below
          </a>
        </div>
        <div class="hero-metrics-strip">
          <div class="metric-item">
            <span class="metric-val">+28%</span>
            <span class="metric-label">Average Check Lift</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="metric-val">&lt;45s</span>
            <span class="metric-label">Average Order Time</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="metric-val">$0</span>
            <span class="metric-label">Proprietary Hardware</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="metric-val">100%</span>
            <span class="metric-label">Offline Order Protection</span>
          </div>
        </div>
        <a href="#storyStage1" class="hero-scroll-cue">
          <span>Scroll down to see the ordering flow</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M3 6l5 5 5-5"/></svg>
        </a>
      </div>

      <!-- Scrolling Story Stages -->
      <div class="story-stages-wrap">

        <!-- Stage 1: One-Tap Quick Add -->
        <article class="story-stage-card" id="storyStage1">
          <div class="story-step-badge">Step 01 &bull; Quick Add</div>
          <h3>One tap for quick items. No popup hurdles.</h3>
          <p>
            Popular menu items like pizza add directly to the order on first touch with inline quantity steppers. No unwanted popups slow down customers during peak rush.
          </p>
          <div class="story-tags-row">
            <span class="story-tag">Instant Add</span>
            <span class="story-tag">Live Cart Sync</span>
            <span class="story-tag">Zero Popups</span>
          </div>
        </article>

        <!-- Stage 2: Smart Modifier Sheet -->
        <article class="story-stage-card" id="storyStage2">
          <div class="story-step-badge">Step 02 &bull; Modifiers</div>
          <h3>Structured modifiers that increase order value.</h3>
          <p>
            When an item has choices like burgers or bowls, a bottom drawer guides guests through required selections, paid toppings, and sides before adding to cart.
          </p>
          <div class="story-tags-row">
            <span class="story-tag">+$2.50 Avg Lift</span>
            <span class="story-tag">Required Choices</span>
            <span class="story-tag">Allergen Tags</span>
          </div>
        </article>

        <!-- Stage 3: Real Cart Review -->
        <article class="story-stage-card" id="storyStage3">
          <div class="story-step-badge">Step 03 &bull; Cart Review</div>
          <h3>Clear order review with Dine In and Takeout options.</h3>
          <p>
            Guests verify their selections, switch between Dine In and Takeout, and review tax and item totals before moving to payment.
          </p>
          <div class="story-tags-row">
            <span class="story-tag">Dine In / Takeout</span>
            <span class="story-tag">Itemized Summary</span>
            <span class="story-tag">Quantity Steppers</span>
          </div>
        </article>

        <!-- Stage 4: Card & Mobile Payments -->
        <article class="story-stage-card" id="storyStage4">
          <div class="story-step-badge">Step 04 &bull; Tap or Register</div>
          <h3>Tap to pay or settle at counter.</h3>
          <p>
            Accept contactless card, Apple Pay, and Google Pay directly on the kiosk terminal, or let guests settle with cash at your register.
          </p>
          <div class="story-tags-row">
            <span class="story-tag">Contactless Card</span>
            <span class="story-tag">Apple Pay</span>
            <span class="story-tag">Register Cash</span>
          </div>
        </article>

        <!-- Stage 5: Live Kitchen Dispatch -->
        <article class="story-stage-card" id="storyStage5">
          <div class="story-step-badge">Step 05 &bull; Printed Bill Slip</div>
          <h3>Kitchen ticket sent. Customer order slip printed.</h3>
          <p>
            The guest receives their printed bill slip with token number 4092 and barcode, while the kitchen line immediately receives the digital food prep ticket.
          </p>
          <div class="story-tags-row">
            <span class="story-tag">Token #4092</span>
            <span class="story-tag">Printed Bill Slip</span>
            <span class="story-tag">Auto Reset</span>
          </div>
        </article>

      </div>

    </div>

    <!-- RIGHT COLUMN: Pinned Top-Right Kiosk Preview -->
    <div class="hero-kiosk-col">
      <div class="kiosk-chassis" id="kioskChassis">

        <!-- Top Hardware Notch -->
        <div class="kiosk-notch-bar">
          <div class="kiosk-camera-dot"></div>
          <div class="kiosk-ear-slit"></div>
        </div>

        <!-- Real-Time Top Header with Live Clock & Greeting -->
        <div class="kiosk-top-header">
          <div class="kiosk-time-block">
            <div class="kiosk-greeting-text" id="kioskGreeting">Good morning</div>
            <div class="kiosk-live-clock" id="kioskClock">10:30 AM</div>
          </div>
          <div class="kiosk-restaurant-brand">
            <div class="kiosk-restaurant-icon">🔥</div>
            <div class="kiosk-restaurant-title">
              <div class="kiosk-restaurant-name">The Artisan Grill</div>
              <div class="kiosk-restaurant-sub">Terminal 01 · Live</div>
            </div>
          </div>
          <div class="kiosk-help-action">📞</div>
        </div>

        <!-- Kiosk Screen Viewport -->
        <div class="kiosk-screen-viewport" id="kioskViewport">

          <!-- ─ Screen 1: Food Menu Grid ─ -->
          <div class="kiosk-view-layer kiosk-menu-view active" id="viewMenu">
            <div class="kiosk-category-rail">
              <div class="kiosk-category-tab active">✨ All</div>
              <div class="kiosk-category-tab">🍕 Pizzas</div>
              <div class="kiosk-category-tab">🍔 Burgers</div>
              <div class="kiosk-category-tab">🍟 Sides</div>
              <div class="kiosk-category-tab">🥤 Drinks</div>
            </div>
            <div class="kiosk-shelf-title">All Featured Items</div>
            <div class="kiosk-cards-grid">

              <!-- Item 1 (Top-Left): Margherita Pizza (First targeted - Direct add without popup) -->
              <div class="kiosk-item-card" id="kioskPizzaCard">
                <div class="kiosk-card-photo-box">
                  <span class="food-icon">🍕</span>
                  <span class="kiosk-badge-tag">Chef Choice</span>
                </div>
                <div class="kiosk-card-content">
                  <div class="kiosk-card-item-title">Margherita Supreme</div>
                  <div class="kiosk-card-meta-row">
                    <span class="kiosk-meta-chip">⏱ 15m</span>
                    <span class="kiosk-meta-chip">🔥 620 kcal</span>
                  </div>
                  <div class="kiosk-card-action-row">
                    <span class="kiosk-card-item-price">$14.50</span>
                    <span class="kiosk-add-btn-element" id="pizzaAddBtn">ADD +</span>
                    <div class="kiosk-qty-stepper" id="pizzaQtyStepper">
                      <span class="qty-btn">−</span>
                      <span class="qty-val">1</span>
                      <span class="qty-btn">+</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Item 2 (Top-Right): Truffle Smash Burger (Second targeted - Opens Modifier Sheet) -->
              <div class="kiosk-item-card" id="kioskBurgerCard">
                <div class="kiosk-card-photo-box">
                  <span class="food-icon">🍔</span>
                  <span class="kiosk-badge-tag">Customizable</span>
                </div>
                <div class="kiosk-card-content">
                  <div class="kiosk-card-item-title">Truffle Smash Burger</div>
                  <div class="kiosk-card-meta-row">
                    <span class="kiosk-meta-chip">⏱ 12m</span>
                    <span class="kiosk-meta-chip">🔥 480 kcal</span>
                  </div>
                  <div class="kiosk-card-action-row">
                    <span class="kiosk-card-item-price">$12.90</span>
                    <span class="kiosk-add-btn-element" id="burgerAddBtn">ADD +</span>
                    <div class="kiosk-qty-stepper" id="burgerQtyStepper">
                      <span class="qty-btn">−</span>
                      <span class="qty-val">1</span>
                      <span class="qty-btn">+</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Item 3 (Bottom-Left): Sides -->
              <div class="kiosk-item-card">
                <div class="kiosk-card-photo-box">
                  <span class="food-icon">🍟</span>
                </div>
                <div class="kiosk-card-content">
                  <div class="kiosk-card-item-title">Loaded Truffle Fries</div>
                  <div class="kiosk-card-meta-row">
                    <span class="kiosk-meta-chip">⏱ 5m</span>
                    <span class="kiosk-meta-chip">🔥 340 kcal</span>
                  </div>
                  <div class="kiosk-card-action-row">
                    <span class="kiosk-card-item-price">$5.90</span>
                    <span class="kiosk-add-btn-element">ADD +</span>
                  </div>
                </div>
              </div>

              <!-- Item 4 (Bottom-Right): Drinks -->
              <div class="kiosk-item-card">
                <div class="kiosk-card-photo-box">
                  <span class="food-icon">🥤</span>
                </div>
                <div class="kiosk-card-content">
                  <div class="kiosk-card-item-title">Cold Brew Latte</div>
                  <div class="kiosk-card-meta-row">
                    <span class="kiosk-meta-chip">⏱ Instant</span>
                    <span class="kiosk-meta-chip">🔥 60 kcal</span>
                  </div>
                  <div class="kiosk-card-action-row">
                    <span class="kiosk-card-item-price">$3.90</span>
                    <span class="kiosk-add-btn-element">ADD +</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- ─ Screen 2: Customization & Upsell Sheet (Real ModifierSheet from page.tsx line 3079) ─ -->
          <div class="kiosk-view-layer kiosk-upsell-view" id="viewUpsell">
            <div class="kiosk-sheet-container" id="upsellSheetContainer">
              <div class="sheet-drag-handle"></div>
              <div class="sheet-header-box">
                <button type="button" class="sheet-close-btn" aria-label="Close">✕</button>
                <div class="sheet-thumb-icon">🍔</div>
                <div class="sheet-title-text">
                  <h4>Truffle Smash Burger</h4>
                  <p>Customize to your taste</p>
                </div>
                <div class="sheet-price-col">
                  <div class="current-price" id="sheetPriceDisplay">$12.90</div>
                </div>
              </div>

              <!-- Real Preselected Choices Banner from line 3168 of page.tsx -->
              <div class="sheet-popular-banner">
                <svg viewBox="0 0 16 16" fill="currentColor" style="width:12px;height:12px;flex-shrink:0;"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm2.8 5.3-3.5 4a.5.5 0 0 1-.74 0l-1.8-2a.5.5 0 1 1 .74-.66L7 9.2l3.1-3.6a.5.5 0 1 1 .7.7z"/></svg>
                <span>Popular choices are preselected to speed up ordering.</span>
              </div>

              <!-- Modifier Group 1: Choice of Bun (Required, Single Select) -->
              <div class="sheet-section">
                <div class="sheet-section-title">
                  <h5>Choice of Bun</h5>
                  <span class="sub">Select 1 · Required</span>
                </div>
                <div class="sheet-options-box">
                  <div class="sheet-option-row active">
                    <div class="sheet-option-left">
                      <div class="sheet-check-indicator">✓</div>
                      <div>
                        <span class="sheet-option-name">Artisan Brioche Bun</span>
                        <span class="sheet-default-tag">Default choice</span>
                      </div>
                    </div>
                    <span class="sheet-option-price">Included</span>
                  </div>
                  <div class="sheet-option-row">
                    <div class="sheet-option-left">
                      <div class="sheet-check-indicator"></div>
                      <span class="sheet-option-name">Gluten Free Seeded Bun</span>
                    </div>
                    <span class="sheet-option-price">+ $1.20</span>
                  </div>
                </div>
              </div>

              <!-- Modifier Group 2: Chef's Recommended Extra (Optional, Multi Select) -->
              <div class="sheet-section">
                <div class="sheet-section-title">
                  <h5>Chef's Recommended Extra</h5>
                  <span class="sub">Choose any optional</span>
                </div>
                <div class="sheet-options-box">
                  <div class="sheet-option-row" id="cheeseModifierTile">
                    <div class="sheet-option-left">
                      <div class="sheet-check-indicator square" id="cheeseCheckIndicator"></div>
                      <span class="sheet-option-name">🧀 Extra Truffle Cheese</span>
                    </div>
                    <span class="sheet-option-price">+ $2.50</span>
                  </div>
                  <div class="sheet-option-row">
                    <div class="sheet-option-left">
                      <div class="sheet-check-indicator square"></div>
                      <span class="sheet-option-name">🥓 Applewood Bacon</span>
                    </div>
                    <span class="sheet-option-price">+ $2.80</span>
                  </div>
                </div>
              </div>

              <!-- Sheet Sticky Footer -->
              <div class="sheet-footer-action">
                <div class="sheet-stepper-box">
                  <span>−</span>
                  <span>1</span>
                  <span>+</span>
                </div>
                <button type="button" class="sheet-confirm-btn" id="sheetAddConfirmBtn">
                  <span id="sheetConfirmBtnText">Add Item · $12.90</span>
                </button>
              </div>
            </div>
          </div>

          <!-- ─ Screen 3: Cart Review View (Real Kiosk CartScreen from page.tsx line 2516) ─ -->
          <div class="kiosk-view-layer kiosk-cart-view" id="viewCart">
            <!-- Screen Top Navigation with Back Arrow -->
            <div class="kiosk-screen-top-bar">
              <button type="button" class="kiosk-back-arrow-btn" aria-label="Go back">←</button>
              <div class="kiosk-screen-step-header">
                <h2>Your Cart</h2>
                <p>2 items selected · Total $32.29</p>
              </div>
            </div>

            <!-- Authentic Checkout Stepper from page.tsx line 2743 -->
            <div class="kiosk-real-stepper">
              <div class="stepper-tab-item active">
                <span class="stepper-badge">1</span>
                <span class="stepper-tab-label">Review</span>
              </div>
              <div class="stepper-tab-item">
                <span class="stepper-badge">2</span>
                <span class="stepper-tab-label">Payment</span>
              </div>
            </div>

            <!-- Authentic Items in Cart Card from line 2554 of page.tsx -->
            <div class="kiosk-real-card-section">
              <div class="kiosk-card-sec-head">
                <div>
                  <h3>Items in your cart</h3>
                  <p>2 items selected</p>
                </div>
                <button type="button" class="kiosk-add-more-btn">+ Add items</button>
              </div>

              <!-- Cart Item 1: Margherita Pizza -->
              <div class="kiosk-authentic-cart-item">
                <div class="cart-item-thumb">🍕</div>
                <div class="cart-item-details">
                  <h5>Margherita Supreme <span class="cart-item-tag">Pizza</span></h5>
                  <div class="cart-item-modifiers">Regular Crust · Standard</div>
                </div>
                <div class="cart-item-right">
                  <div class="cart-item-price-val">$14.50</div>
                  <span class="cart-item-qty-tag">1 × $14.50</span>
                </div>
              </div>

              <!-- Cart Item 2: Truffle Smash Burger with Modifiers -->
              <div class="kiosk-authentic-cart-item">
                <div class="cart-item-thumb">🍔</div>
                <div class="cart-item-details">
                  <h5>Truffle Smash Burger <span class="cart-item-tag">Burger</span></h5>
                  <div class="cart-item-modifiers">Brioche Bun, Extra Truffle Cheese</div>
                </div>
                <div class="cart-item-right">
                  <div class="cart-item-price-val">$15.40</div>
                  <span class="cart-item-qty-tag">1 × $15.40</span>
                </div>
              </div>
            </div>

            <!-- Authentic Order Type (Dining Mode) Card from line 2582 of page.tsx -->
            <div class="kiosk-real-card-section">
              <div class="dining-mode-head">
                <div class="icon-box">🍽️</div>
                <div>
                  <h4>Order type</h4>
                </div>
              </div>
              <div class="dining-mode-grid">
                <div class="dining-tile active">
                  <div class="dining-tile-top">
                    <div class="dining-tile-icon">🍽️</div>
                    <div class="dining-radio-dot"></div>
                  </div>
                  <div class="dining-tile-name">Dine in</div>
                  <div class="dining-tile-desc">Eat at the restaurant</div>
                </div>
                <div class="dining-tile">
                  <div class="dining-tile-top">
                    <div class="dining-tile-icon">🛍️</div>
                    <div class="dining-radio-dot"></div>
                  </div>
                  <div class="dining-tile-name">Takeaway</div>
                  <div class="dining-tile-desc">Pack to go</div>
                </div>
              </div>
            </div>

            <!-- Authentic Order Summary Card from line 2821 of page.tsx -->
            <div class="summary-panel">
              <div class="summary-panel-head">Order Summary · The Artisan Grill</div>
              <div class="summary-row"><span>Subtotal (2 items)</span><span>$27.40</span></div>
              <div class="summary-row"><span>Extras (Extra Cheese)</span><span>$2.50</span></div>
              <div class="summary-row"><span>Tax (8%)</span><span>$2.39</span></div>
              <div class="summary-row total-row"><span>Total Amount</span><span>$32.29</span></div>
            </div>
          </div>

          <!-- ─ Screen 4: Payment View (Real Kiosk Payment Screen from page.tsx line 2650) ─ -->
          <div class="kiosk-view-layer kiosk-payment-view" id="viewPayment">
            <!-- Screen Top Navigation with Back to Cart Arrow -->
            <div class="kiosk-screen-top-bar">
              <button type="button" class="kiosk-back-arrow-btn" aria-label="Back to Cart">←</button>
              <div class="kiosk-screen-step-header">
                <h2>Payment</h2>
                <p>Choose how to pay $32.29</p>
              </div>
            </div>

            <!-- Authentic Stepper with Step 1 complete from line 2735 of page.tsx -->
            <div class="kiosk-real-stepper">
              <div class="stepper-tab-item complete">
                <span class="stepper-badge">✓</span>
                <span class="stepper-tab-label">Review</span>
              </div>
              <div class="stepper-tab-item active">
                <span class="stepper-badge">2</span>
                <span class="stepper-tab-label">Payment</span>
              </div>
            </div>

            <!-- Authentic Payment Method Card from line 2650 of page.tsx -->
            <div class="payment-section-box">
              <div class="payment-sec-head">
                <div class="icon-box">💳</div>
                <div>
                  <h3>Payment method</h3>
                  <p>Choose one option to place your order</p>
                </div>
              </div>

              <div class="payment-options-grid">
                <!-- Tile 1: Card or Digital Wallet (Active) -->
                <div class="payment-method-tile active" id="payMethodTile1">
                  <div class="payment-method-icon">💳</div>
                  <div class="payment-method-info">
                    <h5>Card or Digital Wallet</h5>
                    <p>Tap card or phone on contactless reader</p>
                  </div>
                  <div class="payment-method-radio"></div>
                </div>

                <!-- Tile 2: Pay at Register -->
                <div class="payment-method-tile" id="payMethodTile2">
                  <div class="payment-method-icon">🏪</div>
                  <div class="payment-method-info">
                    <h5>Pay at Register</h5>
                    <p>Settle with cash or card upon pickup</p>
                  </div>
                  <div class="payment-method-radio"></div>
                </div>
              </div>

              <!-- Secure Payment Badge from line 2678 of page.tsx -->
              <div class="secure-payment-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Secure payment · Payment information is protected.</span>
              </div>
            </div>

            <!-- Authentic Order Info 3-Box Grid from line 2686 of page.tsx -->
            <div class="order-info-grid">
              <div class="order-info-card">
                <div class="lbl">Order ID</div>
                <div class="val">#4092</div>
              </div>
              <div class="order-info-card">
                <div class="lbl">Order Time</div>
                <div class="val" id="paymentLiveClock">10:30 AM</div>
              </div>
              <div class="order-info-card">
                <div class="lbl">Order Type</div>
                <div class="val">Dine In</div>
              </div>
            </div>

            <!-- Bill Summary Card -->
            <div class="summary-panel">
              <div class="summary-row"><span>Total Payable</span><span style="font-weight:650;font-family:var(--font-mono);font-size:12px;color:var(--mt-text-primary);">$32.29</span></div>
            </div>
          </div>

          <!-- ─ Screen 5: Success View (Real Kiosk OrderConfirmedScreen) ─ -->
          <div class="kiosk-view-layer kiosk-success-view" id="viewSuccess">
            <div class="success-confirmation-card">
              <div class="success-conic-ring">
                <div class="success-ring-white">
                  <svg class="check-emerald-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>
                </div>
              </div>
              <div class="order-token-badge">Order Token #4092</div>
              <h4>Order Placed!</h4>
              <p>Your order has been sent to the kitchen line.</p>
              <div class="confirmation-details-grid">
                <div class="conf-info-tile prep">
                  <div class="conf-tile-label">Estimated Prep</div>
                  <div class="conf-tile-value">12 to 15 mins</div>
                </div>
                <div class="conf-info-tile next">
                  <div class="conf-tile-label">Order Status</div>
                  <div class="conf-tile-value">Sent to Kitchen</div>
                </div>
              </div>
              <button type="button" class="print-slip-btn" id="printSlipBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:14px;height:14px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                <span>Print Bill Slip</span>
              </button>
              <div class="star-rating-box">
                <p>Rate your kiosk experience</p>
                <div class="star-rating-icons">★ ★ ★ ★ ★</div>
              </div>
            </div>

            <!-- ─ REALISTIC THERMAL PRINTED ORDER SLIP (PRINT BILL) ─ -->
            <div class="kiosk-printed-slip-wrapper" id="receiptSlipWrapper">
              <div class="printer-feed-slot"></div>
              <div class="thermal-receipt-chit" id="thermalReceiptChit">
                <div class="receipt-store-header">
                  <div class="receipt-store-name">THE ARTISAN GRILL</div>
                  <div class="receipt-store-meta">Terminal 01 &bull; Dine In</div>
                  <div class="receipt-order-token">TOKEN #4092</div>
                  <div class="receipt-time-stamp">Today, 10:32 AM &bull; Ticket #0841</div>
                </div>
                <div class="receipt-divider"></div>
                <div class="receipt-items-list">
                  <div class="receipt-item-row">
                    <span class="qty-name">1x Margherita Pizza</span>
                    <span class="price">$14.50</span>
                  </div>
                  <div class="receipt-item-sub">Thin Crust, Fresh Basil</div>
                  <div class="receipt-item-row">
                    <span class="qty-name">1x Truffle Smash Burger</span>
                    <span class="price">$15.40</span>
                  </div>
                  <div class="receipt-item-sub">Brioche, Truffle Cheese</div>
                </div>
                <div class="receipt-divider"></div>
                <div class="receipt-calc-table">
                  <div class="calc-row"><span>Subtotal:</span><span>$29.90</span></div>
                  <div class="calc-row"><span>Tax (8.0%):</span><span>$2.39</span></div>
                  <div class="calc-row total"><span>TOTAL:</span><span>$32.29</span></div>
                </div>
                <div class="receipt-divider"></div>
                <div class="receipt-pay-status">
                  <div>ORDER CONFIRMED · DINE IN</div>
                  <div class="sub-status">Show token #4092 at counter for pickup</div>
                </div>
                <div class="receipt-barcode-box">
                  <svg viewBox="0 0 160 38" class="barcode-svg" preserveAspectRatio="none">
                    <rect x="0" y="0" width="3" height="38" fill="#111827"/>
                    <rect x="6" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="10" y="0" width="4.5" height="38" fill="#111827"/>
                    <rect x="18" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="23" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="27" y="0" width="4" height="38" fill="#111827"/>
                    <rect x="34" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="39" y="0" width="5" height="38" fill="#111827"/>
                    <rect x="47" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="52" y="0" width="3.5" height="38" fill="#111827"/>
                    <rect x="58" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="63" y="0" width="4" height="38" fill="#111827"/>
                    <rect x="70" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="74" y="0" width="3" height="38" fill="#111827"/>
                    <rect x="80" y="0" width="4.5" height="38" fill="#111827"/>
                    <rect x="88" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="93" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="97" y="0" width="4" height="38" fill="#111827"/>
                    <rect x="104" y="0" width="2.5" height="38" fill="#111827"/>
                    <rect x="110" y="0" width="4" height="38" fill="#111827"/>
                    <rect x="117" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="121" y="0" width="3.5" height="38" fill="#111827"/>
                    <rect x="127" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="132" y="0" width="5" height="38" fill="#111827"/>
                    <rect x="140" y="0" width="2" height="38" fill="#111827"/>
                    <rect x="145" y="0" width="3" height="38" fill="#111827"/>
                    <rect x="151" y="0" width="1.5" height="38" fill="#111827"/>
                    <rect x="155" y="0" width="3" height="38" fill="#111827"/>
                  </svg>
                  <div class="barcode-num">* 4 0 9 2 *</div>
                </div>
                <button type="button" class="receipt-close-btn" id="closeReceiptBtn">&times; Close Slip</button>
                <svg class="receipt-tear-edge bottom" viewBox="0 0 120 8" preserveAspectRatio="none">
                  <polygon points="0,0 5,8 10,0 15,8 20,0 25,8 30,0 35,8 40,0 45,8 50,0 55,8 60,0 65,8 70,0 75,8 80,0 85,8 90,0 95,8 100,0 105,8 110,0 115,8 120,0 120,0 0,0" fill="#FFFFFF"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══════════════════════════════════════════════════
             PERFECT UNIFIED BOTTOM BAR (STAYS AT THE EXACT SAME SPOT)
             ═══════════════════════════════════════════════════ -->
        <div class="kiosk-bottom-dock-wrapper" id="kioskBottomDock">
          <div class="kiosk-dock-black-button" id="dockActionButton">
            <div class="dock-left-action">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:16px;height:16px;flex-shrink:0;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              <span id="dockActionLabel">View Cart</span>
            </div>
            <span class="dock-badge-pill" id="dockBadgeCount">0 items</span>
            <span class="dock-right-total" id="dockPriceTotal">$0.00</span>
          </div>
        </div>

        <!-- ═════ CLEAN POINTER HAND (EXACT USER SPECIFIED CURSOR) ═════ -->
        <div class="kiosk-hand-cursor" id="handCursor">
          <div class="touch-ripple-effect" id="touchRipple"></div>
          <!-- Precision anchored pointer: (0,0) is exactly the index fingertip -->
          <div class="hand-vector-wrapper">
            <img src="/hand-cursor-retina.png" alt="Touch Pointer" style="width:100%;height:100%;display:block;user-select:none;pointer-events:none;" />
          </div>
        </div>

      </div>
    </div>

  </div>
</section>

<!-- ═══════════════ INDUSTRY CAROUSEL ═══════════════ -->
<section id="industries" class="industries-section">
  <div class="section-header reveal">
    <div class="section-tagline">Menu Configurations</div>
    <h2 class="section-title">Configured for how your counter actually operates.</h2>
    <p class="section-subtitle">Whether you run a fast paced coffee bar, a pizzeria with custom toppings, or a burger shop with combos, Place UR Order adapts to your menu structure out of the box.</p>
  </div>
  <div class="carousel-track">
    <!-- Duplicated set for infinite glide -->
    <div class="industry-card">
      <div class="industry-card-img pizza">🍕</div>
      <div class="industry-card-body">
        <h3>Pizzerias & Slice Shops</h3>
        <p>Half and half toppings, specialty crusts, dipping sauces, and custom slice combos.</p>
        <div class="industry-features">
          <span class="industry-feat">Crust Options</span>
          <span class="industry-feat">Half & Half</span>
          <span class="industry-feat">Dip Bundles</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img coffee">☕</div>
      <div class="industry-card-body">
        <h3>Cafes & Espresso Bars</h3>
        <p>Milk alternatives, temperature toggles, syrup pumps, and extra espresso shots.</p>
        <div class="industry-features">
          <span class="industry-feat">Milk Alternatives</span>
          <span class="industry-feat">Hot or Iced</span>
          <span class="industry-feat">Syrup Pumps</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img burger">🍔</div>
      <div class="industry-card-body">
        <h3>Burgers & Fast Casual</h3>
        <p>Patty counts, bun options, meal combos with fries, and drink pairings.</p>
        <div class="industry-features">
          <span class="industry-feat">Patty Stacks</span>
          <span class="industry-feat">Meal Combos</span>
          <span class="industry-feat">Side Swaps</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img bakery">🥐</div>
      <div class="industry-card-body">
        <h3>Bakeries & Delis</h3>
        <p>Box assortments, warmed or cold options, bread choices, and scheduled pickups.</p>
        <div class="industry-features">
          <span class="industry-feat">Box Sets</span>
          <span class="industry-feat">Toasted / Cold</span>
          <span class="industry-feat">Scheduled Pickups</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img salon">✂️</div>
      <div class="industry-card-body">
        <h3>Salons & Barbershops</h3>
        <p>Service selection, staff preference, duration based pricing, and extra treatments.</p>
        <div class="industry-features">
          <span class="industry-feat">Staff Selection</span>
          <span class="industry-feat">Service Times</span>
          <span class="industry-feat">Custom Upgrades</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img retail">🛍️</div>
      <div class="industry-card-body">
        <h3>Boutique Retail</h3>
        <p>Barcode lookup, size and color variants, gift receipt options, and live inventory sync.</p>
        <div class="industry-features">
          <span class="industry-feat">Barcode Search</span>
          <span class="industry-feat">Sizes & Colors</span>
          <span class="industry-feat">Live Inventory</span>
        </div>
      </div>
    </div>

    <!-- Duplicate for infinite track -->
    <div class="industry-card">
      <div class="industry-card-img pizza">🍕</div>
      <div class="industry-card-body">
        <h3>Pizzerias & Slice Shops</h3>
        <p>Half and half toppings, specialty crusts, dipping sauces, and custom slice combos.</p>
        <div class="industry-features">
          <span class="industry-feat">Crust Options</span>
          <span class="industry-feat">Half & Half</span>
          <span class="industry-feat">Dip Bundles</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img coffee">☕</div>
      <div class="industry-card-body">
        <h3>Cafes & Espresso Bars</h3>
        <p>Milk alternatives, temperature toggles, syrup pumps, and extra espresso shots.</p>
        <div class="industry-features">
          <span class="industry-feat">Milk Alternatives</span>
          <span class="industry-feat">Hot or Iced</span>
          <span class="industry-feat">Syrup Pumps</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img burger">🍔</div>
      <div class="industry-card-body">
        <h3>Burgers & Fast Casual</h3>
        <p>Patty counts, bun options, meal combos with fries, and drink pairings.</p>
        <div class="industry-features">
          <span class="industry-feat">Patty Stacks</span>
          <span class="industry-feat">Meal Combos</span>
          <span class="industry-feat">Side Swaps</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img bakery">🥐</div>
      <div class="industry-card-body">
        <h3>Bakeries & Delis</h3>
        <p>Box assortments, warmed or cold options, bread choices, and scheduled pickups.</p>
        <div class="industry-features">
          <span class="industry-feat">Box Sets</span>
          <span class="industry-feat">Toasted / Cold</span>
          <span class="industry-feat">Scheduled Pickups</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img salon">✂️</div>
      <div class="industry-card-body">
        <h3>Salons & Barbershops</h3>
        <p>Service selection, staff preference, duration based pricing, and extra treatments.</p>
        <div class="industry-features">
          <span class="industry-feat">Staff Selection</span>
          <span class="industry-feat">Service Times</span>
          <span class="industry-feat">Custom Upgrades</span>
        </div>
      </div>
    </div>
    <div class="industry-card">
      <div class="industry-card-img retail">🛍️</div>
      <div class="industry-card-body">
        <h3>Boutique Retail</h3>
        <p>Barcode lookup, size and color variants, gift receipt options, and live inventory sync.</p>
        <div class="industry-features">
          <span class="industry-feat">Barcode Search</span>
          <span class="industry-feat">Sizes & Colors</span>
          <span class="industry-feat">Live Inventory</span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ═══════════════ HOW IT WORKS ═══════════════ -->
<section class="journey-section">
  <div class="section-header reveal">
    <div class="section-tagline">Order Flow</div>
    <h2 class="section-title">How an order moves from kiosk to kitchen.</h2>
    <p class="section-subtitle">No lost tickets, no cashier bottlenecks, and no handwriting mistakes. Orders flow straight from screen to food prep.</p>
  </div>
  <div class="journey-grid">
    <div class="journey-card reveal reveal-delay-1">
      <div class="journey-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>
      </div>
      <div class="journey-step-label">Step 01</div>
      <h3>Guest places order</h3>
      <p>Visual touch catalog with clear modifier choices. Guests customize items and pay in under 45 seconds.</p>
    </div>
    <div class="journey-card reveal reveal-delay-2">
      <div class="journey-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 21h8m-4-4v4"/></svg>
      </div>
      <div class="journey-step-label">Step 02</div>
      <h3>Kitchen receives ticket</h3>
      <p>Zero paper mixups. Orders route instantly to kitchen display screens (KDS) or standard receipt printers.</p>
    </div>
    <div class="journey-card reveal reveal-delay-3">
      <div class="journey-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      </div>
      <div class="journey-step-label">Step 03</div>
      <h3>Order called for pickup</h3>
      <p>Customer order numbers appear on pickup screens. Counter staff hand off freshly made food with zero confusion.</p>
    </div>
  </div>
</section>

<!-- ═══════════════ HARDWARE COMPATIBILITY ═══════════════ -->
<section id="hardware" class="hardware-section">
  <div class="hardware-inner">
    <div class="hardware-text reveal">
      <div class="section-tagline hardware-tagline">Hardware Compatibility</div>
      <h2 class="section-title">Runs on tablets and touchscreens you already own.</h2>
      <p>Say goodbye to expensive multiyear hardware leases. Run Place UR Order on consumer iPads, Android tablets, or commercial touch displays with full kiosk lockdown.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFFFFF;">iPadOS 15+</span>
        <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFFFFF;">Android 12+</span>
        <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFFFFF;">Windows 11 IoT</span>
        <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);color:#FFFFFF;">Elo Touch</span>
      </div>
    </div>
    <div class="hardware-cards">
      <div class="hardware-card reveal reveal-delay-1">
        <div class="hardware-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        </div>
        <div>
          <h4>Use Your Own Tablets</h4>
          <p>Already have an iPad or Android tablet? Launch Place UR Order in under 10 minutes with zero extra equipment costs.</p>
        </div>
      </div>
      <div class="hardware-card reveal reveal-delay-2">
        <div class="hardware-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </div>
        <div>
          <h4>Counter Mounts & Floor Stands</h4>
          <p>Compatible with standard tablet enclosures, swivel counter pivots, and 21" to 32" freestanding kiosks.</p>
        </div>
      </div>
      <div class="hardware-card reveal reveal-delay-3">
        <div class="hardware-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div>
          <h4>Simple Device Pairing</h4>
          <p>Enter your 6 digit store code on any device to securely connect your live menu and kitchen stations.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ═══════════════ ROI CALCULATOR ═══════════════ -->
<section id="roi" class="roi-section">
  <div class="section-header reveal">
    <div class="section-tagline">ROI Calculator</div>
    <h2 class="section-title">Estimate your monthly labor and order savings.</h2>
    <p class="section-subtitle">Adjust daily customer count and cashier wages to see your estimated monthly savings and modifier uplift update live.</p>
  </div>
  <div class="roi-calculator reveal reveal-delay-1">
    <div class="roi-slider-group">
      <div class="roi-slider-label">
        <span>Daily Customer Orders</span>
        <span class="value" id="customerCountLabel">250</span>
      </div>
      <input type="range" class="roi-slider" id="customerSlider" min="50" max="1000" value="250" step="10">
      <div class="roi-slider-scale">
        <span>50 orders / day</span>
        <span>500 orders</span>
        <span>1,000 orders / day</span>
      </div>
    </div>
    <div class="roi-slider-group">
      <div class="roi-slider-label">
        <span>Cashier Hourly Wage</span>
        <span class="value" id="wageLabel">$18 / hr</span>
      </div>
      <input type="range" class="roi-slider" id="wageSlider" min="12" max="40" value="18" step="1">
      <div class="roi-slider-scale">
        <span>$12 / hr</span>
        <span>$25 / hr</span>
        <span>$40 / hr</span>
      </div>
      <div class="roi-wage-presets">
        <button type="button" class="wage-preset-btn" data-wage="15">$15 / hr</button>
        <button type="button" class="wage-preset-btn active" data-wage="18">$18 / hr (US Avg)</button>
        <button type="button" class="wage-preset-btn" data-wage="22">$22 / hr</button>
        <button type="button" class="wage-preset-btn" data-wage="25">$25 / hr</button>
      </div>
    </div>
    <div class="roi-results">
      <div class="roi-result-card">
        <div class="roi-result-value" id="laborDollarsSaved">$2,025</div>
        <div class="roi-result-label">Monthly Labor Saved</div>
        <div class="roi-result-sub" id="laborHoursSub">112 cashier hours saved</div>
      </div>
      <div class="roi-result-card">
        <div class="roi-result-value" id="upsellProfit">+$2,880</div>
        <div class="roi-result-label">Extra Modifier Revenue</div>
        <div class="roi-result-sub">from consistent modifier prompts</div>
      </div>
      <div class="roi-result-card">
        <div class="roi-result-value" id="annualTotalGain">$58,860</div>
        <div class="roi-result-label">Estimated Annual Value</div>
        <div class="roi-result-sub">Labor savings + modifier uplift</div>
      </div>
    </div>
    <div class="roi-payback-pill">
      <div class="payback-tag">
        <span>Hardware payback estimate:</span>
        <strong style="color:var(--mt-blue);" id="paybackDays">~6 days</strong>
        <span style="color:var(--mt-text-muted);">(based on a $399 iPad setup)</span>
      </div>
    </div>
  </div>
</section>

<!-- ═══════════════ FAQ ═══════════════ -->
<section class="faq-section">
  <div class="section-header reveal">
    <div class="section-tagline">Frequently Asked Questions</div>
    <h2 class="section-title">Everything you need to know.</h2>
  </div>
  <div class="faq-list reveal reveal-delay-1">
    <div class="faq-item open">
      <button class="faq-question" type="button" aria-expanded="true">
        <span>Can we run Place UR Order on tablets we already have?</span>
        <span class="faq-toggle">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="3" x2="8" y2="13"></line>
            <line x1="3" y1="8" x2="13" y2="8"></line>
          </svg>
        </span>
      </button>
      <div class="faq-answer">
        <p>Yes. Place UR Order runs on standard iPads (iPadOS 15+), Android tablets (v12+), and commercial Elo or Windows touch displays. You don't need to purchase proprietary terminals or sign multiyear hardware leases.</p>
      </div>
    </div>
    <div class="faq-item">
      <button class="faq-question" type="button" aria-expanded="false">
        <span>How do payments work? Can customers still pay with cash?</span>
        <span class="faq-toggle">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="3" x2="8" y2="13"></line>
            <line x1="3" y1="8" x2="13" y2="8"></line>
          </svg>
        </span>
      </button>
      <div class="faq-answer">
        <p>Yes. You can connect a card reader for tap, chip, and Apple Pay/Google Pay directly on the kiosk, or enable "Pay at Counter". With Pay at Counter, guests get a printed ticket and settle with your cashier using cash or card.</p>
      </div>
    </div>
    <div class="faq-item">
      <button class="faq-question" type="button" aria-expanded="false">
        <span>What happens if our internet connection drops during a rush?</span>
        <span class="faq-toggle">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="3" x2="8" y2="13"></line>
            <line x1="3" y1="8" x2="13" y2="8"></line>
          </svg>
        </span>
      </button>
      <div class="faq-answer">
        <p>Place UR Order caches your full menu, modifiers, and pricing locally on each tablet. If your WiFi drops, the kiosk continues accepting orders offline and syncs with your kitchen displays the moment connectivity returns.</p>
      </div>
    </div>
    <div class="faq-item">
      <button class="faq-question" type="button" aria-expanded="false">
        <span>How quickly can we 86 an item or change prices?</span>
        <span class="faq-toggle">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="3" x2="8" y2="13"></line>
            <line x1="3" y1="8" x2="13" y2="8"></line>
          </svg>
        </span>
      </button>
      <div class="faq-answer">
        <p>Instantly. When you update an item price or mark an ingredient 86'd in your merchant dashboard, every connected kiosk screen updates in real time without needing a manual restart.</p>
      </div>
    </div>
  </div>
</section>

<!-- ═══════════════ FINAL CTA ═══════════════ -->
<section class="cta-section reveal">
  <h2>Ready to speed up your counter service?</h2>
  <p>Set up your first kiosk on an iPad or tablet in under 10 minutes. No long term contracts, no proprietary hardware.</p>
  <a href="/auth/sign-up" class="btn-cta-large">
    Start Your 14 Day Free Trial
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
  </a>
  <div class="cta-guarantee-row">
    <span>✓ No Credit Card Required</span>
    <span>✓ Works with Existing Tablets</span>
    <span>✓ Cancel Anytime</span>
  </div>
</section>

<!-- ═══════════════ FOOTER ═══════════════ -->
<footer class="footer">
  <div class="footer-brand-row" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <a href="/" class="footer-logo" aria-label="PlaceURorder home"><img src="/place-ur-order-logo.png" alt="Place UR Order" style="height:36px;width:auto;object-fit:contain;display:block;" /></a>
    <span>&copy; 2026 Place UR Order. All rights reserved.</span>
  </div>
  <div>Built for fast casual restaurants, cafes, and hospitality counters.</div>
  <nav class="footer-links" aria-label="Footer navigation">
    <a href="#demo">Live Demo</a>
    <a href="#industries">Menu Setups</a>
    <a href="#hardware">Hardware</a>
    <a href="#roi">Savings Calculator</a>
    <a href="/auth/sign-in">Sign In</a>
  </nav>
</footer>

<!-- ═══════════════ JAVASCRIPT: 100% PRECISE LOGICAL CHOREOGRAPHY ═══════════════ -->`;
