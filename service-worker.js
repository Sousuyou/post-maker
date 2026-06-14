// Bar Soutsu 共通Service Worker（ひな形）
// 方針: ページ本体(HTML)とデータ(.json/.js)は「ネットワーク優先」で常に最新を取得し、
//   オフライン時のみキャッシュを使う。画像・CSSは「キャッシュ優先」で高速表示。
//   → この方式なら、更新しても基本オンラインで即反映される（版数の上げ忘れ事故が起きにくい）。
//   ※ アプリごとに CACHE 名を変える（例: "myapp-v1"）。ASSETS も実ファイルに合わせる。
var CACHE = "postmaker-v3";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./boot.js",
  "./manifest.json",
  "./assets/icon.svg",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var accept = req.headers.get("accept") || "";
  // 本体HTML・データ(.json/.js)は常に最新を取りに行く
  var fresh =
    req.mode === "navigate" ||
    accept.indexOf("text/html") !== -1 ||
    /\.(json|js)$/.test(url.pathname);

  if (fresh) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match("./index.html"); });
      })
    );
  } else {
    // 画像・CSSはキャッシュ優先（高速）
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
  }
});
