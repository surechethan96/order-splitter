// Small console for the Order Splitter API. Plain JavaScript, no build step.
const API = '/api/v1/orders';
const PAGE_SIZE = 10;
const $ = (id) => document.getElementById(id);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

let historyOffset = 0;
let pendingKey = null; // reused when the same form is retried after a network error

// ---------- small DOM helpers ----------
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach((child) => node.append(child));
  return node;
}

function marketTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone, timeZoneName: 'short',
  }).format(new Date(iso));
}

// ---------- holdings editor ----------
function addHolding(holding = {}) {
  const symbol = el('input', { type: 'text', placeholder: 'AAPL', value: holding.symbol ?? '', maxLength: 10 });
  const weight = el('input', { type: 'number', min: '0.01', max: '100', step: '0.01', value: holding.weight ?? '' });
  const price = el('input', { type: 'number', min: '0.01', step: '0.01', placeholder: 'default $100', value: holding.price ?? '' });
  symbol.setAttribute('aria-label', 'Symbol');
  weight.setAttribute('aria-label', 'Weight in percent');
  price.setAttribute('aria-label', 'Market price, optional');
  const remove = el('button', { type: 'button', className: 'remove', textContent: '✕', title: 'Remove stock' });
  const row = el('div', { className: 'holding' }, [symbol, weight, price, remove]);
  remove.addEventListener('click', () => { row.remove(); updateWeightTotal(); });
  weight.addEventListener('input', updateWeightTotal);
  $('holdings').append(row);
  updateWeightTotal();
}

function setHoldings(list) {
  $('holdings').replaceChildren();
  list.forEach(addHolding);
}

function readHoldings() {
  return [...$('holdings').children].map((row) => {
    const [symbol, weight, price] = row.querySelectorAll('input');
    const holding = { symbol: symbol.value.trim(), weight: Number(weight.value) };
    if (price.value !== '') holding.price = Number(price.value);
    return holding;
  });
}

function updateWeightTotal() {
  // Work in hundredths so 0.1 + 0.2 style sums stay exact.
  const hundredths = readHoldings().reduce((sum, h) => sum + Math.round(h.weight * 100), 0);
  const pill = $('weight-total');
  pill.textContent = `Total ${hundredths / 100}%`;
  pill.classList.toggle('bad', hundredths !== 10000);
}

// ---------- API calls ----------
async function call(url, options = {}) {
  const headers = { ...options.headers };
  if ($('apiKey').value) headers['x-api-key'] = $('apiKey').value;
  const started = performance.now();
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body, ms: performance.now() - started };
}

function showError(body, status) {
  const box = $('form-error');
  box.replaceChildren(el('strong', { textContent: body.message || `Request failed (${status})` }));
  if (Array.isArray(body.details)) {
    box.append(el('ul', {}, body.details.map((text) => el('li', { textContent: text }))));
  }
  box.hidden = false;
}

async function submitOrder(event) {
  event.preventDefault();
  $('form-error').hidden = true;
  $('submit').disabled = true;

  const payload = {
    orderType: document.querySelector('input[name="orderType"]:checked').value,
    totalAmount: Number($('totalAmount').value),
    portfolio: readHoldings(),
  };
  if ($('portfolioName').value.trim()) payload.portfolioName = $('portfolioName').value.trim();

  const headers = { 'Content-Type': 'application/json' };
  if ($('useIdempotency').checked) {
    pendingKey = pendingKey || crypto.randomUUID();
    headers['Idempotency-Key'] = pendingKey;
  }

  try {
    const { ok, status, body, ms } = await call(API, { method: 'POST', headers, body: JSON.stringify(payload) });
    pendingKey = null; // the server answered, so the next submit is a new order
    if (!ok) return showError(body, status);
    showResult(body, `Server answered in ${ms.toFixed(0)} ms (round trip). Order id ${body.id}`);
    historyOffset = 0;
    await loadHistory();
  } catch {
    // No answer from the server: keep the key so a retry cannot create a duplicate.
    showError({ message: 'Could not reach the server. It is safe to press the button again.' });
  } finally {
    $('submit').disabled = false;
  }
}

// ---------- result ----------
function showResult(order, meta) {
  const { execution } = order;
  const when = marketTime(execution.executeAt, execution.timezone);
  const banner = $('execution');
  banner.className = execution.marketOpenNow ? 'banner' : 'banner scheduled';
  banner.replaceChildren(
    execution.marketOpenNow ? 'Market is open: execute now' : `Market is closed: execute on ${when}`,
    el('small', { textContent: `${order.orderType} · ${execution.note} (${execution.executeAt} UTC)` }),
  );

  const stats = [
    ['Total', usd.format(order.totalAmount)],
    ['Allocated', usd.format(order.allocatedAmount)],
    ['Not allocated', usd.format(order.unallocatedAmount)],
    ['Share decimals', order.quantityDecimals],
  ];
  $('summary').replaceChildren(
    ...stats.map(([label, value]) => el('div', {}, [el('dt', { textContent: label }), el('dd', { textContent: value })])),
  );

  $('result-lines').replaceChildren(
    ...order.orders.map((line) =>
      el('tr', {}, [
        el('td', { textContent: line.symbol }),
        el('td', { className: 'num', textContent: `${line.weight}%` }),
        el('td', { className: 'num' }, [
          usd.format(line.price),
          el('small', { textContent: line.priceSource === 'PARTNER' ? 'partner price' : 'fixed default' }),
        ]),
        el('td', { className: 'num', textContent: usd.format(line.targetAmount) }),
        el('td', { className: 'num', textContent: line.quantity.toFixed(order.quantityDecimals) }),
        el('td', { className: 'num', textContent: usd.format(line.amount) }),
      ]),
    ),
  );
  $('result-meta').textContent = meta;
  $('result-empty').hidden = true;
  $('result').hidden = false;
}

// ---------- history ----------
async function loadHistory() {
  const filter = $('history-filter').value;
  const query = `?limit=${PAGE_SIZE}&offset=${historyOffset}${filter ? `&orderType=${filter}` : ''}`;
  let result;
  try {
    result = await call(API + query);
  } catch {
    return;
  }
  if (!result.ok) return showError(result.body, result.status);
  const { data, meta } = result.body;

  $('history-rows').replaceChildren(
    ...data.map((order) => {
      const row = el('tr', { className: 'clickable', title: 'Show this order in the result panel' }, [
        el('td', { textContent: new Date(order.createdAt).toLocaleString() }),
        el('td', {}, [el('span', { className: `tag ${order.orderType}`, textContent: order.orderType })]),
        el('td', { textContent: order.portfolioName || '—' }),
        el('td', { className: 'num', textContent: usd.format(order.totalAmount) }),
        el('td', { textContent: order.orders.map((line) => line.symbol).join(', ') }),
        el('td', { textContent: marketTime(order.execution.executeAt, order.execution.timezone) }),
      ]);
      row.addEventListener('click', () => showResult(order, `Order id ${order.id}`));
      return row;
    }),
  );

  $('history-empty').hidden = meta.total > 0;
  $('history-wrap').hidden = meta.total === 0;
  const last = Math.min(meta.offset + meta.limit, meta.total);
  $('history-page').textContent = meta.total ? `${meta.offset + 1}–${last} of ${meta.total}` : '';
  $('history-prev').disabled = meta.offset === 0;
  $('history-next').disabled = last >= meta.total;
}

// ---------- wiring ----------
$('order-form').addEventListener('submit', submitOrder);
$('order-form').addEventListener('input', () => { pendingKey = null; });
$('add-holding').addEventListener('click', () => addHolding());
$('preset-example').addEventListener('click', () =>
  setHoldings([{ symbol: 'AAPL', weight: 60 }, { symbol: 'TSLA', weight: 40 }]));
$('preset-prices').addEventListener('click', () =>
  setHoldings([
    { symbol: 'AAPL', weight: 50, price: 187.53 },
    { symbol: 'MSFT', weight: 30, price: 412.1 },
    { symbol: 'TSLA', weight: 20 },
  ]));
$('history-filter').addEventListener('change', () => { historyOffset = 0; loadHistory(); });
$('history-refresh').addEventListener('click', loadHistory);
$('history-prev').addEventListener('click', () => { historyOffset = Math.max(0, historyOffset - PAGE_SIZE); loadHistory(); });
$('history-next').addEventListener('click', () => { historyOffset += PAGE_SIZE; loadHistory(); });

setHoldings([{ symbol: 'AAPL', weight: 60 }, { symbol: 'TSLA', weight: 40 }]);
loadHistory();
