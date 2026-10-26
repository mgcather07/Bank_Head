// Overpass query with retries and a mirror fallback (the public servers return 502/504 under load).
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export async function overpass(query, { tries = 6 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const url = MIRRORS[i % MIRRORS.length];
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'User-Agent': 'BankheadHuntIntel/1.0 (rehtac)', 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(240000) });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      console.warn(`overpass attempt ${i + 1} failed: ${e.message}`);
      await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
    }
  }
  throw last;
}
