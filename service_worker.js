/**
 * service_worker.js — Joshua Terminal PWA
 *
 * Minimal stub: its presence is enough for Chrome/Edge to offer
 * "Install app".  No offline caching — Joshua Terminal is a
 * localhost app and always has a live server behind it.
 */

const CACHE_NAME = 'joshua-terminal-v1';

// Install: activate immediately, no pre-caching needed
self.addEventListener('install', () => self.skipWaiting());

// Activate: claim all clients right away
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Fetch: pass everything straight through to the network
// (no offline caching — the local Flask server is always present)
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
