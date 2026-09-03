// Pure data helpers: default seed data, id generation, and the road graph.
// No DOM code lives here so it can be reasoned about (and tested) on its own.

export function defaultState() {
  return {
    cities: [{ id: 'tyre', name: 'Tyre', traits: '' }],
    roads: [],
    traders: [],
    items: [],
    listings: [],
  };
}

export function slugify(name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'x';
}

export function uniqueId(base, existingIds) {
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

export function roadId(a, b) {
  return [a, b].sort().join('__');
}

export function listingId(traderId, itemId) {
  return `${traderId}__${itemId}`;
}

function buildAdjacency(roads) {
  const adj = new Map();
  for (const r of roads) {
    if (!adj.has(r.a)) adj.set(r.a, new Set());
    if (!adj.has(r.b)) adj.set(r.b, new Set());
    adj.get(r.a).add(r.b);
    adj.get(r.b).add(r.a);
  }
  return adj;
}

// Breadth-first search over the road graph. Returns a Map of cityId -> hop
// count from `fromCityId`. Cities with no known route are simply absent.
export function hopsFrom(fromCityId, roads) {
  const adj = buildAdjacency(roads);
  const dist = new Map([[fromCityId, 0]]);
  const queue = [fromCityId];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    for (const next of adj.get(cur) || []) {
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

export function formatPrice(value) {
  return value === null || value === undefined || value === 0 || value === '' ? '—' : String(value);
}
