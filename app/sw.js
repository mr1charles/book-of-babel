const V='babel-v1',F=['./','index.html','style.css','app.js','core.js','store.js','icon.svg','manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const k=r.clone();caches.open(V).then(c=>c.put(e.request,k));return r}).catch(()=>caches.match(e.request)))});
