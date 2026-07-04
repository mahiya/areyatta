"use strict";

const CACHE_NAME = "areyatta-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 同一オリジンの GET リクエストのみ処理する。
// キャッシュを即座に返しつつ、裏でネットワークから更新する (stale-while-revalidate)。
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ネットワーク取得とキャッシュ書き込みは waitUntil で SW の寿命を延長して完遂させる
  const fetchAndCache = fetch(request).then(async (response) => {
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(fetchAndCache.then(() => undefined, () => undefined));

  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === "navigate" }).then((cached) =>
      cached ||
      fetchAndCache.catch(() => {
        // オフライン時：ナビゲーションはキャッシュ済みの index.html にフォールバック
        if (request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return undefined;
      }),
    ),
  );
});
