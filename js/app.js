import { CONFIG } from './config.js';
import { getCachedState, setCachedState } from './db.js';
import * as GH from './github.js';
import {
  defaultState, slugify, uniqueId, roadId, listingId, hopsFrom, formatPrice,
} from './state.js';
import Fuse from './vendor/fuse.mjs';

const els = {
  search: document.getElementById('search-input'),
  banner: document.getElementById('banner'),
  viewCity: document.getElementById('view-city'),
  viewLookup: document.getElementById('view-lookup'),
  viewMap: document.getElementById('view-map'),
  citySelect: document.getElementById('city-select'),
  traitsCityName: document.getElementById('traits-city-name'),
  traitsText: document.getElementById('traits-text'),
  traitsTextarea: document.getElementById('traits-textarea'),
  traitsEditActions: document.getElementById('traits-edit-actions'),
  btnEditTraits: document.getElementById('btn-edit-traits'),
  btnClearTraits: document.getElementById('btn-clear-traits'),
  btnSaveTraits: document.getElementById('btn-save-traits'),
  btnCancelTraits: document.getElementById('btn-cancel-traits'),
  listingBody: document.getElementById('listing-body'),
  btnAddListing: document.getElementById('btn-add-listing'),
  btnMap: document.getElementById('btn-map'),
  btnCityView: document.getElementById('btn-city-view'),
  btnSettings: document.getElementById('btn-settings'),
  lookupTitle: document.getElementById('lookup-title'),
  lookupWrap: document.getElementById('lookup-table-wrap'),
  btnBackFromLookup: document.getElementById('btn-back-from-lookup'),
  btnBackFromMap: document.getElementById('btn-back-from-map'),
  cityList: document.getElementById('city-list'),
  roadList: document.getElementById('road-list'),
  btnAddCity: document.getElementById('btn-add-city'),
  btnAddRoad: document.getElementById('btn-add-road'),
  modalOverlay: document.getElementById('modal-overlay'),
  modal: document.getElementById('modal'),
};

const DIRTY_KEY = 'sr_dirty';

const App = {
  state: defaultState(),
  currentCityId: null,
  dirty: localStorage.getItem(DIRTY_KEY) === '1',
  sort: {
    city: { key: 'item', dir: 'asc' },
    lookup: { key: 'buy', dir: 'desc' },
  },
};

function setDirty(value) {
  App.dirty = value;
  if (value) localStorage.setItem(DIRTY_KEY, '1');
  else localStorage.removeItem(DIRTY_KEY);
}

// ---------- boot ----------

async function boot() {
  const cached = await getCachedState();
  if (cached) {
    App.state = cached;
    restoreCurrentCity();
    renderAll();
  }

  // If this browser has edits that haven't been pushed to GitHub yet, the
  // cached copy IS the source of truth right now — pulling fresh public
  // data here would silently overwrite them.
  if (App.dirty) {
    updateBanner();
    return;
  }

  try {
    const fresh = await GH.fetchPublicData();
    App.state = fresh;
    restoreCurrentCity();
    await setCachedState(App.state);
    renderAll();
  } catch (e) {
    if (!cached) {
      App.state = defaultState();
      restoreCurrentCity();
      renderAll();
    }
  }

  updateBanner();
}

function restoreCurrentCity() {
  const saved = localStorage.getItem(CONFIG.currentCityStorageKey);
  const exists = saved && App.state.cities.some((c) => c.id === saved);
  App.currentCityId = exists ? saved : (App.state.cities[0] && App.state.cities[0].id) || null;
}

function setCurrentCity(cityId) {
  App.currentCityId = cityId;
  localStorage.setItem(CONFIG.currentCityStorageKey, cityId);
}

// ---------- persistence ----------

async function persist(message) {
  await setCachedState(App.state);
  if (!GH.hasToken()) {
    setDirty(true);
    updateBanner();
    return;
  }
  try {
    await GH.saveState(App.state, message);
    setDirty(false);
  } catch (e) {
    setDirty(true);
  }
  updateBanner();
}

function updateBanner() {
  if (!App.dirty) {
    els.banner.hidden = true;
    return;
  }
  els.banner.hidden = false;
  if (!GH.hasToken()) {
    els.banner.innerHTML = 'Changes are saved on this device only. <button id="banner-settings">Add a GitHub token</button> to sync them for real.';
    document.getElementById('banner-settings').onclick = openSettingsModal;
  } else {
    els.banner.innerHTML = 'Could not sync to GitHub. <button id="banner-retry">Retry sync</button>';
    document.getElementById('banner-retry').onclick = async () => {
      await persist('Retry sync');
      renderAll();
    };
  }
}

// ---------- lookups ----------

function getCity(id) { return App.state.cities.find((c) => c.id === id); }
function getTrader(id) { return App.state.traders.find((t) => t.id === id); }
function getItem(id) { return App.state.items.find((i) => i.id === id); }

function cityListingRows(cityId) {
  const traderIds = new Set(App.state.traders.filter((t) => t.cityId === cityId).map((t) => t.id));
  return App.state.listings
    .filter((l) => traderIds.has(l.traderId))
    .map((l) => ({
      listing: l,
      trader: getTrader(l.traderId),
      item: getItem(l.itemId),
    }))
    .filter((r) => r.trader && r.item);
}

function itemListingRows(itemId) {
  return App.state.listings
    .filter((l) => l.itemId === itemId)
    .map((l) => {
      const trader = getTrader(l.traderId);
      if (!trader) return null;
      const city = getCity(trader.cityId);
      if (!city) return null;
      return { listing: l, trader, city };
    })
    .filter(Boolean);
}

function sortRows(rows, key, dir, getters) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getters[key](a);
    const bv = getters[key](b);
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  });
}

// ---------- rendering: city view ----------

function renderCitySelect() {
  const sorted = [...App.state.cities].sort((a, b) => a.name.localeCompare(b.name));
  els.citySelect.innerHTML = sorted.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  els.citySelect.value = App.currentCityId || '';
}

function renderTraits() {
  const city = getCity(App.currentCityId);
  if (!city) return;
  els.traitsCityName.textContent = city.name;
  els.traitsText.textContent = city.traits && city.traits.trim() ? city.traits : 'No notes yet.';
}

function renderListingTable() {
  const rows = cityListingRows(App.currentCityId);
  const { key, dir } = App.sort.city;
  const getters = {
    vendor: (r) => r.trader.name.toLowerCase(),
    item: (r) => r.item.name.toLowerCase(),
    buy: (r) => Number(r.listing.buyPrice) || -1,
    sell: (r) => Number(r.listing.sellPrice) || -1,
  };
  const sorted = sortRows(rows, key, dir, getters);

  els.listingBody.innerHTML = sorted.map((r) => `
    <tr data-listing-id="${r.listing.id}" data-trader-id="${r.trader.id}">
      <td>${escapeHtml(r.trader.name)}</td>
      <td class="item-link" data-item-id="${r.item.id}">${escapeHtml(r.item.name)}</td>
      <td>${formatPrice(r.listing.buyPrice)}</td>
      <td>${formatPrice(r.listing.sellPrice)}</td>
      <td>${r.listing.isLocal ? 'Local' : 'Imported'}</td>
      <td class="row-actions">
        <button class="icon-btn" data-edit-listing="${r.listing.id}" title="Edit">✏️</button>
        <button class="icon-btn" data-delete-listing="${r.listing.id}" title="Delete">🗑️</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-row">Nothing recorded here yet.</td></tr>';

  document.querySelectorAll('.listing-table thead th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === key);
    th.classList.toggle('asc', th.dataset.sort === key && dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === key && dir === 'desc');
  });
}

function renderCityView() {
  renderCitySelect();
  renderTraits();
  renderListingTable();
}

// ---------- rendering: lookup view ----------

function showView(name) {
  els.viewCity.hidden = name !== 'city';
  els.viewLookup.hidden = name !== 'lookup';
  els.viewMap.hidden = name !== 'map';
  els.btnCityView.classList.toggle('active', name === 'city');
  els.btnMap.classList.toggle('active', name === 'map');
}

function openItemLookup(itemId) {
  const item = getItem(itemId);
  if (!item) return;
  showView('lookup');
  els.lookupTitle.textContent = `Best places to trade: ${item.name}`;

  const rows = itemListingRows(itemId);
  const hops = hopsFrom(App.currentCityId, App.state.roads);
  const withHops = rows.map((r) => ({ ...r, hops: hops.has(r.city.id) ? hops.get(r.city.id) : Infinity }));

  const { key, dir } = App.sort.lookup;
  const getters = {
    buy: (r) => Number(r.listing.buyPrice) || -1,
    sell: (r) => Number(r.listing.sellPrice) || -1,
    hops: (r) => r.hops,
  };
  const sorted = sortRows(withHops, key, dir, getters);

  els.lookupWrap.innerHTML = `
    <thead>
      <tr>
        <th data-lookup-sort="hops" class="${key === 'hops' ? 'sorted ' + dir : ''}">Hops</th>
        <th>City</th>
        <th>Vendor</th>
        <th data-lookup-sort="buy" class="${key === 'buy' ? 'sorted ' + dir : ''}">Buy Price</th>
        <th data-lookup-sort="sell" class="${key === 'sell' ? 'sorted ' + dir : ''}">Sell Price</th>
      </tr>
    </thead>
    <tbody>
      ${sorted.map((r) => `
        <tr>
          <td>${r.hops === Infinity ? '—' : r.hops}</td>
          <td class="vendor-link" data-jump-city="${r.city.id}">${escapeHtml(r.city.name)}</td>
          <td class="vendor-link" data-jump-trader="${r.trader.id}" data-jump-city="${r.city.id}">${escapeHtml(r.trader.name)}</td>
          <td>${formatPrice(r.listing.buyPrice)}</td>
          <td>${formatPrice(r.listing.sellPrice)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="empty-row">No one trades this yet.</td></tr>'}
    </tbody>
  `;

  els.lookupWrap.querySelectorAll('[data-lookup-sort]').forEach((th) => {
    th.onclick = () => {
      const k = th.dataset.lookupSort;
      if (App.sort.lookup.key === k) App.sort.lookup.dir = App.sort.lookup.dir === 'asc' ? 'desc' : 'asc';
      else App.sort.lookup = { key: k, dir: k === 'hops' ? 'asc' : 'desc' };
      openItemLookup(itemId);
    };
  });
  els.lookupWrap.querySelectorAll('[data-jump-trader]').forEach((td) => {
    td.onclick = () => jumpToCity(td.dataset.jumpCity, td.dataset.jumpTrader);
  });
}

function jumpToCity(cityId, highlightTraderId) {
  setCurrentCity(cityId);
  showView('city');
  renderCityView();
  if (highlightTraderId) {
    const row = els.listingBody.querySelector(`tr[data-trader-id="${highlightTraderId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('highlight');
      setTimeout(() => row.classList.remove('highlight'), 2000);
    }
  }
}

// ---------- rendering: map view ----------

function renderMapView() {
  els.cityList.innerHTML = App.state.cities.map((c) => `
    <li>
      <span>${escapeHtml(c.name)}</span>
      <span class="entity-actions">
        <button class="icon-btn" data-edit-city="${c.id}" title="Rename">✏️</button>
        <button class="icon-btn" data-delete-city="${c.id}" title="Delete">🗑️</button>
      </span>
    </li>
  `).join('');

  els.roadList.innerHTML = App.state.roads.map((r) => `
    <li>
      <span>${escapeHtml(getCity(r.a)?.name || '?')} ↔ ${escapeHtml(getCity(r.b)?.name || '?')}</span>
      <span class="entity-actions">
        <button class="icon-btn" data-delete-road="${r.id}" title="Delete">🗑️</button>
      </span>
    </li>
  `).join('') || '<li class="empty-row">No roads yet.</li>';
}

function renderAll() {
  renderCityView();
  renderMapView();
}

// ---------- modal helpers ----------

function openModal(html) {
  els.modal.innerHTML = html;
  els.modalOverlay.hidden = false;
}
function closeModal() {
  els.modalOverlay.hidden = true;
  els.modal.innerHTML = '';
}
function confirmDialog(message) {
  return new Promise((resolve) => {
    openModal(`
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button id="confirm-yes" class="danger">Yes</button>
        <button id="confirm-no">No</button>
      </div>
    `);
    document.getElementById('confirm-yes').onclick = () => { closeModal(); resolve(true); };
    document.getElementById('confirm-no').onclick = () => { closeModal(); resolve(false); };
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- mutations ----------

function addCity(name) {
  const ids = new Set(App.state.cities.map((c) => c.id));
  const id = uniqueId(slugify(name), ids);
  App.state.cities.push({ id, name, traits: '' });
  return id;
}

function addTrader(name, cityId) {
  const ids = new Set(App.state.traders.map((t) => t.id));
  const id = uniqueId(slugify(name), ids);
  App.state.traders.push({ id, name, cityId });
  return id;
}

function addItem(name) {
  const ids = new Set(App.state.items.map((i) => i.id));
  const id = uniqueId(slugify(name), ids);
  App.state.items.push({ id, name });
  return id;
}

function upsertListing({ id, traderId, itemId, buyPrice, sellPrice, isLocal }) {
  const lid = id || listingId(traderId, itemId);
  const existing = App.state.listings.find((l) => l.id === lid);
  const now = new Date().toISOString();
  if (existing) {
    if (existing.buyPrice !== buyPrice || existing.sellPrice !== sellPrice) {
      existing.history = existing.history || [];
      existing.history.push({ buyPrice: existing.buyPrice, sellPrice: existing.sellPrice, at: existing.updatedAt });
    }
    existing.buyPrice = buyPrice;
    existing.sellPrice = sellPrice;
    existing.isLocal = isLocal;
    existing.updatedAt = now;
  } else {
    App.state.listings.push({ id: lid, traderId, itemId, buyPrice, sellPrice, isLocal, updatedAt: now, history: [] });
  }
}

// ---------- event wiring: traits ----------

els.btnEditTraits.onclick = () => {
  const city = getCity(App.currentCityId);
  els.traitsText.hidden = true;
  els.traitsTextarea.hidden = false;
  els.traitsTextarea.value = city.traits || '';
  els.traitsEditActions.hidden = false;
  els.traitsTextarea.focus();
};

els.btnCancelTraits.onclick = () => {
  els.traitsText.hidden = false;
  els.traitsTextarea.hidden = true;
  els.traitsEditActions.hidden = true;
};

els.btnSaveTraits.onclick = async () => {
  const city = getCity(App.currentCityId);
  city.traits = els.traitsTextarea.value;
  els.traitsText.hidden = false;
  els.traitsTextarea.hidden = true;
  els.traitsEditActions.hidden = true;
  renderTraits();
  await persist(`Update ${city.name} traits`);
};

els.btnClearTraits.onclick = async () => {
  const city = getCity(App.currentCityId);
  const ok = await confirmDialog(`Clear the notes for ${city.name}?`);
  if (!ok) return;
  city.traits = '';
  renderTraits();
  await persist(`Clear ${city.name} traits`);
};

// ---------- event wiring: city select & sorting ----------

els.citySelect.onchange = () => {
  setCurrentCity(els.citySelect.value);
  renderCityView();
};

document.querySelectorAll('.listing-table thead th[data-sort]').forEach((th) => {
  th.onclick = () => {
    const k = th.dataset.sort;
    if (App.sort.city.key === k) App.sort.city.dir = App.sort.city.dir === 'asc' ? 'desc' : 'asc';
    else App.sort.city = { key: k, dir: 'asc' };
    renderListingTable();
  };
});

els.listingBody.addEventListener('click', async (e) => {
  const itemLink = e.target.closest('.item-link');
  if (itemLink) { openItemLookup(itemLink.dataset.itemId); return; }

  const editBtn = e.target.closest('[data-edit-listing]');
  if (editBtn) { openListingModal(editBtn.dataset.editListing); return; }

  const delBtn = e.target.closest('[data-delete-listing]');
  if (delBtn) {
    const ok = await confirmDialog('Delete this listing?');
    if (!ok) return;
    App.state.listings = App.state.listings.filter((l) => l.id !== delBtn.dataset.deleteListing);
    renderListingTable();
    await persist('Delete listing');
  }
});

// ---------- listing modal ----------

function openListingModal(existingId) {
  const existing = existingId ? App.state.listings.find((l) => l.id === existingId) : null;
  const trader = existing ? getTrader(existing.traderId) : null;
  const item = existing ? getItem(existing.itemId) : null;

  const cityTraders = App.state.traders.filter((t) => t.cityId === App.currentCityId);
  const vendorField = existing
    ? `<p><strong>Vendor:</strong> ${escapeHtml(trader.name)}</p>`
    : `
      <label>Vendor
        <select id="f-vendor">
          ${cityTraders.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          <option value="__new__">+ New Vendor</option>
        </select>
      </label>
      <input id="f-vendor-new" type="text" placeholder="New vendor name" hidden>
    `;
  const itemField = existing
    ? `<p><strong>Item:</strong> ${escapeHtml(item.name)}</p>`
    : `
      <label>Item
        <select id="f-item">
          ${App.state.items.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
          <option value="__new__">+ New Item</option>
        </select>
      </label>
      <input id="f-item-new" type="text" placeholder="New item name" hidden>
    `;

  openModal(`
    <h3>${existing ? 'Edit listing' : 'Add item to this city'}</h3>
    ${vendorField}
    ${itemField}
    <label>Buy Price (what they pay you)
      <input id="f-buy" type="number" min="0" step="any" value="${existing ? existing.buyPrice ?? '' : ''}" placeholder="leave blank if not offered">
    </label>
    <label>Sell Price (what they charge you)
      <input id="f-sell" type="number" min="0" step="any" value="${existing ? existing.sellPrice ?? '' : ''}" placeholder="leave blank if not offered">
    </label>
    <label class="radio-row">
      <span><input type="radio" name="f-local" value="1" ${!existing || existing.isLocal ? 'checked' : ''}> Local</span>
      <span><input type="radio" name="f-local" value="0" ${existing && !existing.isLocal ? 'checked' : ''}> Imported</span>
    </label>
    <div class="modal-actions">
      <button id="f-save">Save</button>
      <button id="f-cancel">Cancel</button>
    </div>
  `);

  if (!existing) {
    const vSel = document.getElementById('f-vendor');
    const vNew = document.getElementById('f-vendor-new');
    vSel.onchange = () => { vNew.hidden = vSel.value !== '__new__'; };
    const iSel = document.getElementById('f-item');
    const iNew = document.getElementById('f-item-new');
    iSel.onchange = () => { iNew.hidden = iSel.value !== '__new__'; };
  }

  document.getElementById('f-cancel').onclick = closeModal;
  document.getElementById('f-save').onclick = async () => {
    let traderId = existing ? existing.traderId : document.getElementById('f-vendor').value;
    if (!existing && traderId === '__new__') {
      const name = document.getElementById('f-vendor-new').value.trim();
      if (!name) return;
      traderId = addTrader(name, App.currentCityId);
    }
    let itemId = existing ? existing.itemId : document.getElementById('f-item').value;
    if (!existing && itemId === '__new__') {
      const name = document.getElementById('f-item-new').value.trim();
      if (!name) return;
      itemId = addItem(name);
    }
    const buyRaw = document.getElementById('f-buy').value;
    const sellRaw = document.getElementById('f-sell').value;
    const isLocal = document.querySelector('input[name="f-local"]:checked').value === '1';
    upsertListing({
      id: existing ? existing.id : undefined,
      traderId,
      itemId,
      buyPrice: buyRaw === '' ? 0 : Number(buyRaw),
      sellPrice: sellRaw === '' ? 0 : Number(sellRaw),
      isLocal,
    });
    closeModal();
    renderListingTable();
    await persist(existing ? 'Update listing' : 'Add listing');
  };
}

els.btnAddListing.onclick = () => openListingModal(null);

// ---------- navigation ----------

els.btnCityView.onclick = () => showView('city');
els.btnMap.onclick = () => { showView('map'); renderMapView(); };
els.btnBackFromLookup.onclick = () => showView('city');
els.btnBackFromMap.onclick = () => showView('city');

// ---------- map view: cities & roads ----------

function cityUsageCounts(cityId) {
  const traders = App.state.traders.filter((t) => t.cityId === cityId);
  const traderIds = new Set(traders.map((t) => t.id));
  const listings = App.state.listings.filter((l) => traderIds.has(l.traderId));
  const roads = App.state.roads.filter((r) => r.a === cityId || r.b === cityId);
  return { traders: traders.length, listings: listings.length, roads: roads.length };
}

els.btnAddCity.onclick = () => {
  openModal(`
    <h3>Add city</h3>
    <label>Name <input id="f-city-name" type="text"></label>
    <div class="modal-actions">
      <button id="f-save">Save</button>
      <button id="f-cancel">Cancel</button>
    </div>
  `);
  document.getElementById('f-cancel').onclick = closeModal;
  document.getElementById('f-save').onclick = async () => {
    const name = document.getElementById('f-city-name').value.trim();
    if (!name) return;
    const id = addCity(name);
    closeModal();
    renderMapView();
    renderCitySelect();
    await persist(`Add city ${name}`);
    void id;
  };
};

els.cityList.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit-city]');
  if (editBtn) {
    const city = getCity(editBtn.dataset.editCity);
    openModal(`
      <h3>Rename city</h3>
      <label>Name <input id="f-city-name" type="text" value="${escapeHtml(city.name)}"></label>
      <div class="modal-actions">
        <button id="f-save">Save</button>
        <button id="f-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('f-cancel').onclick = closeModal;
    document.getElementById('f-save').onclick = async () => {
      const name = document.getElementById('f-city-name').value.trim();
      if (!name) return;
      city.name = name;
      closeModal();
      renderMapView();
      renderCityView();
      await persist(`Rename city to ${name}`);
    };
    return;
  }
  const delBtn = e.target.closest('[data-delete-city]');
  if (delBtn) {
    const id = delBtn.dataset.deleteCity;
    const city = getCity(id);
    const counts = cityUsageCounts(id);
    const ok = await confirmDialog(
      `Delete ${city.name}? This also removes ${counts.traders} vendor(s), ${counts.listings} listing(s), and ${counts.roads} road(s) connected to it.`,
    );
    if (!ok) return;
    const traderIds = new Set(App.state.traders.filter((t) => t.cityId === id).map((t) => t.id));
    App.state.listings = App.state.listings.filter((l) => !traderIds.has(l.traderId));
    App.state.traders = App.state.traders.filter((t) => t.cityId !== id);
    App.state.roads = App.state.roads.filter((r) => r.a !== id && r.b !== id);
    App.state.cities = App.state.cities.filter((c) => c.id !== id);
    if (App.currentCityId === id) {
      App.currentCityId = (App.state.cities[0] && App.state.cities[0].id) || null;
      if (App.currentCityId) setCurrentCity(App.currentCityId);
    }
    renderAll();
    await persist(`Delete city ${city.name}`);
  }
});

els.btnAddRoad.onclick = () => {
  const options = App.state.cities.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  openModal(`
    <h3>Add road</h3>
    <label>From
      <select id="f-road-a">${options}<option value="__new__">+ New City</option></select>
    </label>
    <input id="f-road-a-new" type="text" placeholder="New city name" hidden>
    <label>To
      <select id="f-road-b">${options}<option value="__new__">+ New City</option></select>
    </label>
    <input id="f-road-b-new" type="text" placeholder="New city name" hidden>
    <div class="modal-actions">
      <button id="f-save">Save</button>
      <button id="f-cancel">Cancel</button>
    </div>
  `);
  const aSel = document.getElementById('f-road-a');
  const aNew = document.getElementById('f-road-a-new');
  aSel.onchange = () => { aNew.hidden = aSel.value !== '__new__'; };
  const bSel = document.getElementById('f-road-b');
  const bNew = document.getElementById('f-road-b-new');
  bSel.onchange = () => { bNew.hidden = bSel.value !== '__new__'; };

  document.getElementById('f-cancel').onclick = closeModal;
  document.getElementById('f-save').onclick = async () => {
    let a = aSel.value;
    if (a === '__new__') {
      const name = aNew.value.trim();
      if (!name) return;
      a = addCity(name);
    }
    let b = bSel.value;
    if (b === '__new__') {
      const name = bNew.value.trim();
      if (!name) return;
      b = addCity(name);
    }
    if (a === b) return;
    const id = roadId(a, b);
    if (!App.state.roads.some((r) => r.id === id)) {
      App.state.roads.push({ id, a, b });
    }
    closeModal();
    renderMapView();
    renderCitySelect();
    await persist('Add road');
  };
};

els.roadList.addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-delete-road]');
  if (!delBtn) return;
  const ok = await confirmDialog('Remove this road?');
  if (!ok) return;
  App.state.roads = App.state.roads.filter((r) => r.id !== delBtn.dataset.deleteRoad);
  renderMapView();
  await persist('Delete road');
});

// ---------- settings modal ----------

function openSettingsModal() {
  openModal(`
    <h3>GitHub Sync Settings</h3>
    <p class="hint">Paste a fine-grained personal access token scoped to <code>${CONFIG.owner}/${CONFIG.repo}</code> with contents read/write. It's stored only in this browser.</p>
    <input id="f-token" type="password" name="github-token" autocomplete="current-password" placeholder="github_pat_..." value="${GH.hasToken() ? GH.getToken() : ''}">
    <p id="f-token-status"></p>
    <div class="modal-actions">
      <button id="f-save">Save token</button>
      <button id="f-clear" class="danger">Clear token</button>
      <button id="f-cancel">Close</button>
    </div>
  `);
  document.getElementById('f-cancel').onclick = closeModal;
  document.getElementById('f-clear').onclick = () => {
    GH.setToken('');
    document.getElementById('f-token').value = '';
    document.getElementById('f-token-status').textContent = 'Token cleared.';
  };
  document.getElementById('f-save').onclick = async () => {
    const token = document.getElementById('f-token').value.trim();
    GH.setToken(token);
    const status = document.getElementById('f-token-status');
    status.textContent = 'Checking…';
    const ok = await GH.verifyToken();
    status.textContent = ok ? 'Token looks good.' : 'Could not verify this token against the repo.';
    if (ok && App.dirty) {
      await persist('Sync pending changes');
    }
    updateBanner();
  };
}

els.btnSettings.onclick = openSettingsModal;

// ---------- search ----------

function buildSearchIndex() {
  const entries = [
    ...App.state.items.map((i) => ({ type: 'item', id: i.id, name: i.name })),
    ...App.state.traders.map((t) => ({ type: 'trader', id: t.id, name: t.name, cityId: t.cityId })),
  ];
  return new Fuse(entries, { keys: ['name'], threshold: 0.5, ignoreLocation: true });
}

els.search.addEventListener('input', () => {
  const q = els.search.value.trim();
  if (!q) { renderCityView(); showView('city'); return; }
  // Dataset is small (a personal reference tool), so rebuilding on every
  // keystroke keeps results always current with no cache-invalidation logic.
  const results = buildSearchIndex().search(q).slice(0, 20);
  showView('lookup');
  els.lookupTitle.textContent = `Search results for "${q}"`;
  els.lookupWrap.innerHTML = `
    <tbody>
      ${results.map((r) => {
        const it = r.item;
        if (it.type === 'item') {
          return `<tr><td>🔹</td><td class="vendor-link" data-search-item="${it.id}">${escapeHtml(it.name)}</td><td>item</td></tr>`;
        }
        return `<tr><td>👤</td><td class="vendor-link" data-search-trader="${it.id}" data-search-city="${it.cityId}">${escapeHtml(it.name)}</td><td>vendor — ${escapeHtml(getCity(it.cityId)?.name || '')}</td></tr>`;
      }).join('') || '<tr><td class="empty-row" colspan="3">No matches.</td></tr>'}
    </tbody>
  `;
  els.lookupWrap.querySelectorAll('[data-search-item]').forEach((td) => {
    td.onclick = () => { els.search.value = ''; openItemLookup(td.dataset.searchItem); };
  });
  els.lookupWrap.querySelectorAll('[data-search-trader]').forEach((td) => {
    td.onclick = () => { els.search.value = ''; jumpToCity(td.dataset.searchCity, td.dataset.searchTrader); };
  });
});

boot();
