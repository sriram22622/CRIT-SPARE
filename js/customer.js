import { api } from './api.js';

const ROLE_KEY = 'crit-spare.role';
const SEEN_KEY = 'crit-spare.gateway-seen';
const CART_KEY = 'crit-spare.cart';
const PROFILE_KEY = 'crit-spare.customer-profile';
const BILLS_KEY = 'crit-spare.customer-bills';

export function getRole() {
  return localStorage.getItem(ROLE_KEY) || 'shopkeeper';
}

export function setRole(role) {
  localStorage.setItem(ROLE_KEY, role);
  document.body.dataset.role = role;
  document.body.classList.toggle('role--customer', role === 'customer');
  document.body.classList.toggle('role--shopkeeper', role === 'shopkeeper');
  updateRolePills();
  updateCartBadge();
}

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartBadge();
  renderCartDrawerItems();
}

export function addToCart(part, qty = 1) {
  const cart = getCart();
  const existing = cart.find(item => item.partId === part.id);
  const maxStock = Number(part.qty) || 999;
  if (existing) {
    existing.qty = Math.min(maxStock, existing.qty + qty);
  } else {
    cart.push({
      partId: part.id,
      name: part.name,
      sku: part.sku,
      bin: part.bin || 'A-01',
      unitPrice: Number(part.unitPrice || 0),
      qty: Math.min(maxStock, Math.max(1, qty)),
      maxQty: maxStock
    });
  }
  saveCart(cart);
  document.dispatchEvent(new CustomEvent('app:toast', {
    detail: `Added "${part.name}" to cart.`
  }));
}

export function updateCartQty(partId, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter(item => item.partId !== partId);
  } else {
    const item = cart.find(i => i.partId === partId);
    if (item) item.qty = Math.min(item.maxQty || 999, qty);
  }
  saveCart(cart);
}

export function removeFromCart(partId) {
  const cart = getCart().filter(item => item.partId !== partId);
  saveCart(cart);
}

export function clearCart() {
  saveCart([]);
}

export function getCartSummary() {
  const cart = getCart();
  const subtotal = Number(cart.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0).toFixed(2));
  const tax = Number((subtotal * 0.18).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  return { cart, subtotal, tax, total, count };
}

export function getCustomerProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return JSON.parse(raw) || {
      name: 'Valued Customer',
      phone: '+91 98765 43210',
      email: 'customer@crit-spare.local',
      tier: 'Verified Customer',
      joined: 'Active client'
    };
  } catch {
    return {
      name: 'Valued Customer',
      phone: '+91 98765 43210',
      email: 'customer@crit-spare.local',
      tier: 'Verified Customer',
      joined: 'Active client'
    };
  }
}

export function saveCustomerProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Customer profile updated.' }));
}

export function getCustomerBills() {
  try {
    const raw = localStorage.getItem(BILLS_KEY);
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomerBill(invoice) {
  const bills = getCustomerBills();
  bills.unshift({
    id: invoice.id,
    number: invoice.number || invoice.id,
    createdAt: invoice.createdAt || new Date().toISOString(),
    shopName: invoice.shopName || 'CRIT-SPARE Station',
    station: invoice.station || 'Dock-04',
    items: invoice.items || [],
    subtotal: invoice.subtotal || 0,
    tax: invoice.tax || 0,
    total: invoice.total || 0
  });
  localStorage.setItem(BILLS_KEY, JSON.stringify(bills));
}

export function updateRolePills() {
  if (typeof document === 'undefined') return;
  const role = getRole();
  const isCustomer = role === 'customer';
  document.querySelectorAll('[data-action="switch-role"]').forEach(pill => {
    pill.classList.toggle('role-pill--customer', isCustomer);
    const label = pill.querySelector('[data-role-label]');
    if (label) label.textContent = isCustomer ? 'Customer' : 'Shopkeeper';
    const icon = pill.querySelector('.role-pill__icon');
    if (icon) icon.textContent = isCustomer ? 'person' : 'storefront';
    pill.title = isCustomer ? 'Customer Mode (Click to switch to Shopkeeper)' : 'Shopkeeper Mode (Click to switch to Customer)';
  });

  // Toggle customer cart button visibility
  document.querySelectorAll('[data-customer-cart-trigger]').forEach(btn => {
    btn.hidden = !isCustomer;
  });

  // Toggle operator-only elements
  document.querySelectorAll('[data-operator-only]').forEach(el => {
    el.hidden = isCustomer;
  });

  // Update customer portal on homepage
  const portal = document.getElementById('customer-portal');
  if (portal) portal.hidden = !isCustomer;
}

export function updateCartBadge() {
  if (typeof document === 'undefined') return;
  const { count } = getCartSummary();
  document.querySelectorAll('[data-cart-count]').forEach(node => {
    node.textContent = String(count);
  });
  document.querySelectorAll('[data-cart-badge]').forEach(node => {
    node.hidden = count === 0;
  });
}

export function openCartDrawer() {
  const drawer = document.getElementById('customer-cart-drawer');
  if (!drawer) return;
  renderCartDrawerItems();
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('cart-drawer--open'));
}

export function closeCartDrawer() {
  const drawer = document.getElementById('customer-cart-drawer');
  if (!drawer) return;
  drawer.classList.remove('cart-drawer--open');
  setTimeout(() => {
    if (!drawer.classList.contains('cart-drawer--open')) drawer.hidden = true;
  }, 300);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderCartDrawerItems() {
  if (typeof document === 'undefined') return;
  const container = document.querySelector('[data-cart-items-container]');
  const totalNode = document.querySelector('[data-cart-total-display]');
  const taxNode = document.querySelector('[data-cart-tax-display]');
  const subtotalNode = document.querySelector('[data-cart-subtotal-display]');
  const checkoutBtn = document.querySelector('[data-action="cart-checkout"]');
  if (!container) return;

  const { cart, subtotal, tax, total, count } = getCartSummary();

  if (totalNode) totalNode.textContent = `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  if (taxNode) taxNode.textContent = `₹${tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  if (subtotalNode) subtotalNode.textContent = `₹${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  if (checkoutBtn) checkoutBtn.disabled = count === 0;

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:var(--muted);">
        <span class="material-symbols-outlined" style="font-size:48px;color:rgba(255,255,255,0.15);margin-bottom:8px;display:block;">shopping_cart</span>
        <p style="font-size:14px;color:var(--foreground);font-weight:600;margin:0 0 4px;">Your cart is empty</p>
        <span style="font-size:12px;">Browse the shop inventory to add spare parts.</span>
      </div>
    `;
    return;
  }

  let html = '';
  cart.forEach(item => {
    const itemTotal = Number((item.qty * item.unitPrice).toFixed(2));
    html += `
      <div class="cart-item-card">
        <div class="cart-item-card__info">
          <strong>${esc(item.name)}</strong>
          <small>SKU: ${esc(item.sku)} • Bin: ${esc(item.bin)}</small>
          <div class="cart-item-card__rate">₹${Number(item.unitPrice).toLocaleString()} / unit</div>
        </div>
        <div class="cart-item-card__actions">
          <div class="quantity-stepper">
            <button type="button" data-action="cart-minus" data-id="${esc(item.partId)}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-action="cart-plus" data-id="${esc(item.partId)}">＋</button>
          </div>
          <div class="cart-item-card__subtotal">₹${itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          <button type="button" class="icon-button" data-action="cart-remove" data-id="${esc(item.partId)}" aria-label="Remove item">×</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

export function ensureCustomerCartDrawer() {
  if (document.getElementById('customer-cart-drawer')) return;
  const drawer = document.createElement('div');
  drawer.id = 'customer-cart-drawer';
  drawer.className = 'cart-drawer';
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="cart-drawer__backdrop" data-action="close-cart"></div>
    <aside class="cart-drawer__panel" aria-label="Shopping Cart">
      <header class="cart-drawer__header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="material-symbols-outlined" style="color:var(--green);font-size:24px;">shopping_cart</span>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--white);">Customer Cart</h3>
            <small style="color:var(--muted);font-size:11px;">Selected spare parts for billing</small>
          </div>
        </div>
        <button class="entry-gateway__close" type="button" data-action="close-cart" aria-label="Close cart">✕</button>
      </header>
      <div class="cart-drawer__items" data-cart-items-container></div>
      <footer class="cart-drawer__footer">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;color:var(--muted);">
          <span>Subtotal</span>
          <b data-cart-subtotal-display style="color:var(--foreground);">₹0.00</b>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;color:var(--muted);">
          <span>GST (18%)</span>
          <b data-cart-tax-display style="color:var(--foreground);">₹0.00</b>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:16px;color:var(--white);font-weight:800;border-top:1px dashed var(--line);padding-top:10px;">
          <span>Grand Total</span>
          <strong data-cart-total-display style="color:var(--gold);font-family:'JetBrains Mono',monospace;">₹0.00</strong>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="button button--glass button--small" type="button" data-action="cart-clear" style="flex:1;">Clear</button>
          <a class="button button--gold button--small" href="invoice.html?fromCart=1" data-action="cart-checkout" style="flex:2;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
            <span class="material-symbols-outlined" style="font-size:16px;">receipt_long</span> Checkout &amp; Bill
          </a>
        </div>
      </footer>
    </aside>
  `;
  document.body.append(drawer);

  drawer.addEventListener('click', e => {
    if (e.target.closest('[data-action="close-cart"]')) closeCartDrawer();
    if (e.target.closest('[data-action="cart-clear"]')) {
      clearCart();
      document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Cart cleared.' }));
    }
    const minus = e.target.closest('[data-action="cart-minus"]');
    if (minus) {
      const id = minus.dataset.id;
      const item = getCart().find(i => i.partId === id);
      if (item) updateCartQty(id, item.qty - 1);
    }
    const plus = e.target.closest('[data-action="cart-plus"]');
    if (plus) {
      const id = plus.dataset.id;
      const item = getCart().find(i => i.partId === id);
      if (item) updateCartQty(id, item.qty + 1);
    }
    const remove = e.target.closest('[data-action="cart-remove"]');
    if (remove) {
      removeFromCart(remove.dataset.id);
    }
  });
}

export function ensureEntryGateway() {
  let gateway = document.getElementById('entry-gateway');
  if (!gateway) {
    gateway = document.createElement('div');
    gateway.id = 'entry-gateway';
    gateway.className = 'entry-gateway';
    gateway.setAttribute('role', 'dialog');
    gateway.setAttribute('aria-modal', 'true');
    gateway.setAttribute('aria-labelledby', 'gateway-title');
    gateway.hidden = true;
    gateway.innerHTML = `
      <div class="entry-gateway__warp" aria-hidden="true">
        <div class="entry-gateway__grid"></div>
        <div class="entry-gateway__aperture"></div>
      </div>
      <div class="entry-gateway__backdrop-fx" data-action="close-gateway"></div>
      <div class="entry-gateway__panel">
        <button class="entry-gateway__close" type="button" data-action="close-gateway" aria-label="Close portal">✕</button>
        <div class="entry-gateway__hud">
          <span class="status-dot status-dot--green"></span>
          <span>&gt;&gt; CRIT-SPARE WEB PORTAL ONLINE</span>
        </div>
        <h2 class="entry-gateway__title" id="gateway-title">Welcome to <em>CRIT-SPARE</em></h2>
        <p class="entry-gateway__desc">Select your portal role below to unlock your tailored workspace — just like Google Classroom dual mode.</p>
        
        <div class="entry-gateway__cards">
          <!-- Shopkeeper Workspace Option -->
          <article class="role-card role-card--shopkeeper" data-select-role="shopkeeper" tabindex="0" role="button" aria-label="Enter as Shopkeeper">
            <div class="role-card__icon"><span class="material-symbols-outlined">storefront</span></div>
            <span class="role-card__pill">OPERATOR &amp; SHOP OWNER</span>
            <h3>I am a Shopkeeper</h3>
            <p>Manage shop inventory, issue parts, record restocks, conduct multi-bin audits, and run thermal billing.</p>
            <ul class="role-card__bullets">
              <li><span class="material-symbols-outlined">check_circle</span> Multi-bin inventory &amp; shelf management</li>
              <li><span class="material-symbols-outlined">check_circle</span> Hardware receipt printer &amp; operator bill dispenser</li>
              <li><span class="material-symbols-outlined">check_circle</span> Shift telemetry, station alerts &amp; discrepancy logs</li>
            </ul>
            <button class="button button--gold button--full" type="button">Enter Shopkeeper Workspace <span class="material-symbols-outlined">arrow_forward</span></button>
          </article>

          <!-- Customer Storefront Option -->
          <article class="role-card role-card--customer" data-select-role="customer" tabindex="0" role="button" aria-label="Enter as Customer">
            <div class="role-card__icon"><span class="material-symbols-outlined">person</span></div>
            <span class="role-card__pill">CLIENT &amp; BUYER</span>
            <h3>I am a Customer</h3>
            <p>Browse shop parts, check real-time availability and pricing, add parts to cart, checkout, and view digital thermal bills.</p>
            <ul class="role-card__bullets">
              <li><span class="material-symbols-outlined">check_circle</span> Browse available spares &amp; live prices</li>
              <li><span class="material-symbols-outlined">check_circle</span> Shopping cart with 1-click self-checkout</li>
              <li><span class="material-symbols-outlined">check_circle</span> Instant thermal receipt slip &amp; bill history</li>
            </ul>
            <button class="button button--green button--full" type="button" style="background:rgba(0,230,118,0.15);border-color:rgba(0,230,118,0.3);color:var(--green);font-weight:700;">Enter Customer Storefront <span class="material-symbols-outlined">arrow_forward</span></button>
          </article>
        </div>
      </div>
    `;
    document.body.append(gateway);
  }

  const openGateway = () => {
    gateway.hidden = false;
    requestAnimationFrame(() => gateway.classList.add('entry-gateway--active'));
    document.body.style.overflow = 'hidden';
    const firstCard = gateway.querySelector('.role-card');
    if (firstCard) firstCard.focus();
  };

  const closeGateway = () => {
    gateway.classList.remove('entry-gateway--active');
    document.body.style.overflow = '';
    sessionStorage.setItem(SEEN_KEY, 'true');
    setTimeout(() => {
      if (!gateway.classList.contains('entry-gateway--active')) gateway.hidden = true;
    }, 400);
  };

  gateway.querySelectorAll('[data-action="close-gateway"]').forEach(el => el.addEventListener('click', closeGateway));

  gateway.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeGateway();
  });

  gateway.querySelectorAll('[data-select-role]').forEach(card => {
    const handleSelect = () => {
      const selected = card.dataset.selectRole;
      setRole(selected);
      closeGateway();
      document.dispatchEvent(new CustomEvent('app:toast', {
        detail: selected === 'customer'
          ? 'Switched to Customer Mode: Spares catalog, cart, and billing active.'
          : 'Switched to Shopkeeper Mode: Operator workstation and inventory controls active.'
      }));
      // If on inventory or dashboard, refresh the view
      const page = document.body.dataset.page;
      if (page === 'inventory') {
        const filterInput = document.querySelector('[data-filter-parts]');
        filterInput?.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (page === 'dashboard') {
        renderCustomerDashboard();
      }
    };
    card.addEventListener('click', handleSelect);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });
  });

  // Attach switch-role triggers
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="switch-role"]')) {
      e.preventDefault();
      openGateway();
    }
    if (e.target.closest('[data-customer-cart-trigger]')) {
      e.preventDefault();
      openCartDrawer();
    }
  });

  // Auto-trigger gateway on initial entrance if not seen in this session
  if (!sessionStorage.getItem(SEEN_KEY)) {
    setTimeout(openGateway, 400);
  }
}

export function injectTopbarControls() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  // Ensure role-pill button exists
  if (!topbar.querySelector('[data-action="switch-role"]')) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'role-pill';
    pill.dataset.action = 'switch-role';
    pill.title = 'Switch role (Shopkeeper / Customer)';
    pill.innerHTML = `
      <span class="role-pill__icon material-symbols-outlined">storefront</span>
      <span class="role-pill__text" data-role-label>Shopkeeper</span>
      <span class="material-symbols-outlined" style="font-size:14px;opacity:0.6;">expand_more</span>
    `;
    const searchbox = topbar.querySelector('.searchbox');
    if (searchbox) topbar.insertBefore(pill, searchbox);
    else topbar.prepend(pill);
  }

  // Ensure cart pill button exists for customers
  if (!topbar.querySelector('[data-customer-cart-trigger]')) {
    const actions = topbar.querySelector('.topbar__actions') || topbar;
    const cartBtn = document.createElement('button');
    cartBtn.type = 'button';
    cartBtn.className = 'cart-pill';
    cartBtn.dataset.customerCartTrigger = '';
    cartBtn.innerHTML = `
      <span class="material-symbols-outlined">shopping_cart</span>
      <span>Cart (<b data-cart-count>0</b>)</span>
    `;
    actions.prepend(cartBtn);
  }

  updateRolePills();
  updateCartBadge();
}

export function renderCustomerDashboard() {
  const role = getRole();
  if (role !== 'customer') return;

  const main = document.querySelector('.dashboard-main');
  if (!main) return;

  // In customer mode, hide operator panels
  document.querySelectorAll('.planetarium, .chart-wrap, [data-chart], [data-timeline], [data-shift-log]').forEach(el => {
    const panel = el.closest('.dashboard-panel, .timeline-panel, .shift-panel');
    if (panel) panel.hidden = true;
  });

  // Welcome panel update
  const welcomeTitle = document.querySelector('.welcome-panel__copy h1');
  if (welcomeTitle) welcomeTitle.innerHTML = 'Welcome, <em>Customer.</em>';
  const welcomeDesc = document.querySelector('.welcome-panel__copy p');
  if (welcomeDesc) welcomeDesc.textContent = 'View your spare part orders, verify thermal bills, and manage your account.';

  // Welcome actions update
  const welcomeActions = document.querySelector('.welcome-actions');
  if (welcomeActions) {
    welcomeActions.innerHTML = `
      <a class="button button--gold" href="inventory.html"><span class="material-symbols-outlined">storefront</span> Browse Spares Catalog</a>
      <a class="button button--glass" href="invoice.html"><span class="material-symbols-outlined">receipt_long</span> My Cart &amp; Bills</a>
      <button class="button button--glass" type="button" data-customer-cart-trigger><span class="material-symbols-outlined">shopping_cart</span> View Cart (<b data-cart-count>0</b>)</button>
    `;
  }

  // Inject or update Customer Profile & Order History section
  let customerSection = document.getElementById('customer-dashboard-section');
  if (!customerSection) {
    customerSection = document.createElement('section');
    customerSection.id = 'customer-dashboard-section';
    customerSection.className = 'customer-dashboard-section';
    const firstPanel = document.querySelector('.welcome-panel');
    if (firstPanel && firstPanel.nextSibling) {
      main.insertBefore(customerSection, firstPanel.nextSibling);
    } else {
      main.append(customerSection);
    }
  }

  const profile = getCustomerProfile();
  const bills = getCustomerBills();
  const totalSpent = bills.reduce((sum, b) => sum + (Number(b.total) || 0), 0);

  let billsHtml = '';
  if (bills.length === 0) {
    billsHtml = `
      <div style="text-align:center;padding:32px;color:var(--muted);background:rgba(255,255,255,0.02);border:1px dashed var(--line);border-radius:14px;">
        <span class="material-symbols-outlined" style="font-size:36px;color:var(--gold);margin-bottom:6px;display:block;">receipt</span>
        <p style="margin:0 0 4px;font-weight:600;color:var(--white);">No orders placed yet</p>
        <span style="font-size:12px;">Add parts to your cart and checkout to generate your first thermal bill.</span>
      </div>
    `;
  } else {
    bills.forEach(bill => {
      const itemsList = (bill.items || []).map(i => `${esc(i.name)} × ${i.qty}`).join(', ') || 'Spare parts';
      const dateStr = bill.createdAt ? new Date(bill.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
      billsHtml += `
        <div class="customer-bill-item card-glass" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-radius:14px;margin-bottom:12px;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <strong style="font-family:'JetBrains Mono',monospace;color:var(--gold);font-size:14px;">${esc(bill.number || bill.id)}</strong>
              <span class="pill pill--green" style="font-size:10px;">✓ Verified Slip</span>
              <span style="font-size:12px;color:var(--muted);">${dateStr}</span>
            </div>
            <p style="margin:0;font-size:12px;color:var(--ink);">${esc(itemsList)}</p>
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <strong style="font-size:16px;color:var(--white);font-family:'JetBrains Mono',monospace;">₹${Number(bill.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
            <a href="invoice.html?id=${encodeURIComponent(bill.id || bill.number)}" class="button button--glass button--small" style="text-decoration:none;">View Slip ↗</a>
          </div>
        </div>
      `;
    });
  }

  customerSection.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:24px;">
      <div class="card-glass" style="padding:22px;border-radius:18px;">
        <span class="eyebrow" style="color:var(--green);">CLIENT PROFILE</span>
        <h3 style="font-size:18px;margin:6px 0 10px;color:var(--white);">${esc(profile.name)}</h3>
        <p style="margin:0 0 6px;font-size:12px;color:var(--muted);">Phone: <strong style="color:var(--foreground);">${esc(profile.phone)}</strong></p>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted);">Email: <strong style="color:var(--foreground);">${esc(profile.email)}</strong></p>
        <span class="pill pill--green">${esc(profile.tier || 'Verified Client')}</span>
      </div>
      <div class="card-glass" style="padding:22px;border-radius:18px;">
        <span class="eyebrow" style="color:var(--gold);">ORDERS &amp; EXPENDITURE</span>
        <div style="font-size:28px;font-weight:800;color:var(--gold);font-family:'JetBrains Mono',monospace;margin:6px 0;">₹${totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        <p style="margin:0;font-size:12px;color:var(--muted);">${bills.length} total orders completed with instant thermal slips.</p>
      </div>
    </div>

    <div class="card-glass" style="padding:24px;border-radius:18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;font-size:18px;color:var(--white);">My Thermal Bills &amp; Receipts</h3>
          <p style="margin:2px 0 0;font-size:12px;color:var(--muted);">All dispensed digital slips associated with your customer session.</p>
        </div>
        <a href="invoice.html" class="button button--gold button--small" style="text-decoration:none;">New Bill Slip</a>
      </div>
      <div class="customer-bills-list">${billsHtml}</div>
    </div>
  `;
}
