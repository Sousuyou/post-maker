/*
 * 起動スクリプト（CSP対応の手本）。
 * CSP（script-src 'self'）ではインライン<script>が動かないため、起動処理は必ず外部ファイルに置く。
 * アプリ独自の処理もこのファイル、または別の.jsに分けて読み込むこと。
 */
(function () {
  "use strict";

  // Service Worker 登録（アプリ化・オフライン対応）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }
})();
