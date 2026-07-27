/* AgeLens service worker.
   Keep VERSION in step with APP_VERSION in index.html — it names the caches, so
   bumping it is what retires the previous release's files. */
const VERSION = "1.0.0";
const SHELL_CACHE = "agelens-shell-v" + VERSION;
const MODEL_CACHE = "agelens-models-v1";   // weights are immutable; survives app updates

// Relative so the app works from a GitHub Pages subpath as happily as from a root domain.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

// Hosts serving the model weights and library bundles.
const MODEL_HOSTS = ["cdn.jsdelivr.net", "unpkg.com", "raw.githubusercontent.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is all-or-nothing; one 404 would leave the app with no offline shell at all
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: "reload" })); }
      catch (err) { console.warn("[sw] shell miss:", url, err); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, MODEL_CACHE];
    for (const name of await caches.keys()) {
      if (name.startsWith("agelens-") && !keep.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // never cache errors or opaque responses — a cached 404 is worse than no cache
  if (res && res.ok && res.type !== "opaque") {
    try { await cache.put(request, res.clone()); }
    catch (err) { console.warn("[sw] cache put failed (quota?):", err); }
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Model weights and library bundles: immutable and large, so cache-first. This is what
  // lets a second visit skip the ~9MB download entirely, and work with no connection.
  if (MODEL_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, MODEL_CACHE).catch(() => caches.match(req)));
    return;
  }

  if (url.origin !== self.location.origin) return;   // leave anything else alone

  // Navigations: network-first so a deploy is picked up, cache as the offline fallback.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put("./index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        return (await caches.match(req)) ||
               (await caches.match("./index.html")) ||
               Response.error();
      }
    })());
    return;
  }

  event.respondWith(cacheFirst(req, SHELL_CACHE).catch(() => caches.match(req)));
});
