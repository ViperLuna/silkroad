// Pure data helpers: default seed data, id generation, and the road graph.
// No DOM code lives here so it can be reasoned about (and tested) on its own.

export function defaultState() {
  return {
    cities: [{ id: 'tyre', name: 'Tyre', traits: '', category: 'major' }],
    roads: [],
    traders: [],
    items: [],
    listings: [],
  };
}

// A location is a "minor" waypoint only if explicitly marked so; anything
// else (including older data saved before this field existed) counts as
// a major city.
export function isMinor(city) {
  return !!city && city.category === 'minor';
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

// Shortest-path search over the road graph, where arriving at a major city
// costs 1 and arriving at a minor waypoint costs 0 — so passing through a
// waypoint on the way to a major city doesn't inflate the hop count.
// Weights are only ever 0 or 1, so a 0-1 BFS (a deque instead of a plain
// queue) finds shortest paths in linear time, correctly across branches,
// forks, and loops — there's no notion of "direction," so a way back
// around a loop is found just as readily as the "forward" way.
// Returns { dist, prev }: dist maps cityId -> hop count from `fromCityId`
// (unreachable cities are simply absent), prev maps cityId -> the city
// stepped from on some shortest path to it, for reconstructing a route.
function shortestPaths(fromCityId, roads, cities) {
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const adj = buildAdjacency(roads);
  const dist = new Map([[fromCityId, 0]]);
  const prev = new Map();
  const deque = [fromCityId];
  while (deque.length) {
    const cur = deque.shift();
    const d = dist.get(cur);
    for (const next of adj.get(cur) || []) {
      const weight = isMinor(cityById.get(next)) ? 0 : 1;
      const nd = d + weight;
      if (!dist.has(next) || nd < dist.get(next)) {
        dist.set(next, nd);
        prev.set(next, cur);
        if (weight === 0) deque.unshift(next);
        else deque.push(next);
      }
    }
  }
  return { dist, prev };
}

export function hopsFrom(fromCityId, roads, cities) {
  return shortestPaths(fromCityId, roads, cities).dist;
}

// The actual sequence of cities on a shortest route from `fromCityId` to
// `toCityId` (inclusive of both ends), or null if there's no path at all.
// Ties are broken arbitrarily — any shortest route is equally valid.
export function routeTo(fromCityId, toCityId, roads, cities) {
  if (fromCityId === toCityId) {
    const city = cities.find((c) => c.id === fromCityId);
    return city ? [city] : null;
  }
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const { dist, prev } = shortestPaths(fromCityId, roads, cities);
  if (!dist.has(toCityId)) return null;
  const pathIds = [toCityId];
  let cur = toCityId;
  while (cur !== fromCityId) {
    cur = prev.get(cur);
    pathIds.push(cur);
  }
  pathIds.reverse();
  return pathIds.map((id) => cityById.get(id));
}

// Finds the major cities that bound a minor waypoint — walking outward
// through any chain of other minor waypoints until a major city is hit on
// each branch, and stopping there (majors act as walls, not pass-throughs).
// Used to describe a waypoint as "Between Tyre and Damascus".
export function nearbyMajors(cityId, roads, cities) {
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const adj = buildAdjacency(roads);
  const foundIds = new Set();
  const visitedMinors = new Set([cityId]);
  const queue = [...(adj.get(cityId) || [])];
  while (queue.length) {
    const cur = queue.shift();
    const city = cityById.get(cur);
    if (!city) continue;
    if (!isMinor(city)) {
      foundIds.add(cur);
      continue;
    }
    if (visitedMinors.has(cur)) continue;
    visitedMinors.add(cur);
    for (const next of adj.get(cur) || []) {
      if (!visitedMinors.has(next)) queue.push(next);
    }
  }
  return [...foundIds].map((id) => cityById.get(id)).filter(Boolean);
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// A human label for a location: just its name for a major city; for a
// minor waypoint, "Name (Between X and Y)" when it sits between two or
// more major cities, or "Name (Near X)" when only one side of the road has
// been mapped so far (e.g. a dead end, or the next city just hasn't been
// discovered/added yet).
export function locationLabel(city, roads, cities) {
  if (!city || !isMinor(city)) return city ? city.name : '';
  const majors = nearbyMajors(city.id, roads, cities).map((c) => c.name).sort();
  if (majors.length === 0) return city.name;
  if (majors.length === 1) return `${city.name} (Near ${majors[0]})`;
  return `${city.name} (Between ${joinNames(majors)})`;
}

export function formatPrice(value) {
  if (value === null || value === undefined || value === 0 || value === '') return '—';
  return Number(value).toLocaleString('en-US');
}
