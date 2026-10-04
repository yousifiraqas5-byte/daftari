/* =========================================================
   DAFTARI - Service Worker
========================================================= */

const CACHE_NAME = "daftari-v8";

const ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./firebase-config.js",
    "./firestore-sync.js",
    "./manifest.json",
    "./icon-180.png",
    "./icon-192.png",
    "./icon-512.png"
];

self.addEventListener(
    "install",
    (event) => {

        event.waitUntil(
            caches
                .open(CACHE_NAME)
                .then((cache) => cache.addAll(ASSETS))
                .then(() => self.skipWaiting())
        );

    }
);

self.addEventListener(
    "activate",
    (event) => {

        event.waitUntil(
            caches
                .keys()
                .then((keys) => Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME)
                        .map((key) => caches.delete(key))
                ))
                .then(() => self.clients.claim())
        );

    }
);

self.addEventListener(
    "fetch",
    (event) => {

        if (event.request.method !== "GET") {
            return;
        }

        /*
            Firebase/Auth/Firestore traffic must never be cached -
            only the app shell and the Firebase SDK bundles are.
        */

        const url = new URL(event.request.url);

        const isSameOrigin = url.origin === self.location.origin;
        const isSdkBundle =
            url.hostname === "www.gstatic.com" &&
            url.pathname.indexOf("/firebasejs/") === 0;

        if (!isSameOrigin && !isSdkBundle) {
            return;
        }

        event.respondWith(
            caches
                .match(event.request)
                .then((cached) => {

                    const network = fetch(event.request)
                        .then((response) => {

                            if (response && response.ok) {
                                const copy = response.clone();

                                caches
                                    .open(CACHE_NAME)
                                    .then((cache) => cache.put(event.request, copy));
                            }

                            return response;

                        })
                        .catch(() => cached);

                    return cached || network;

                })
        );

    }
);
