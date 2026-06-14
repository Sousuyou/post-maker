/*
 * 営業投稿メーカー 本体
 * -------------------------------------------------------------
 * Bar Soutsuの定型フォーマットでLINE投稿文を組み立てる入力補助ツール。
 *   文頭に「〇〇です。（投稿者）」＋お礼 → 季節の一言(任意) → 本日の営業時間
 *   → 今日紹介するお酒（名前を強調＋説明） → 空席/予約(任意) → 締め
 * - お酒の名前・説明は「在庫カタログ（/gin-stock/gins.json）」から検索して引き込める（同一ドメイン）。
 * - 言い回しは「シード（乱数の種）」で決める。入力を変えても種が同じなら言い回しは安定し、
 *   「言い回しを変える」ボタンで種が変わると表現が一新される。
 * - 文章は「落ち着いた大人」トーン固定。入力内容は端末（localStorage）に自動保存（try-catch）。
 * - CSP（script-src 'self' / connect-src 'self'）下。同一ドメインのgins.jsonはfetch可。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "soutsu_post_v3";

  function $(id) { return document.getElementById(id); }
  var el = {
    pShop: $("p-shop"), pHours: $("p-hours"), pClosed: $("p-closed"),
    pTel: $("p-tel"), pStaff: $("p-staff"),
    gDate: $("g-date"), gWeather: $("g-weather"), gSeason: $("g-season"),
    rType: $("r-type"), rName: $("r-name"), rDesc: $("r-desc"),
    catSearch: $("cat-search"), catResults: $("cat-results"), descstyleRow: $("descstyle-row"),
    hSeat: $("h-seat"), hReserve: $("h-reserve"), hShowHours: $("h-showhours"),
    eText: $("e-text"),
    tGreeting: $("t-greeting"), tRecommend: $("t-recommend"), tHours: $("t-hours"),
    tEvent: $("t-event"), tClosing: $("t-closing"),
    output: $("output"), charCount: $("char-count"),
    btnCopy: $("btn-copy"), btnShuffle: $("btn-shuffle"), btnClear: $("btn-clear"),
    staffRow: $("staff-row"),
  };

  var DEFAULTS = {
    "p-shop": "Bar Soutsu",
    "p-hours": "19:00〜翌2:00",
    "p-staff": "小野寺, 眞家",
  };

  var state = { seed: 1, staff: "", descSource: "manual", descStyle: "A", catData: null };

  // ---- 乱数（シード固定）---------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1);
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  // ---- 文面の素材プール（落ち着いた大人トーン）----------------------------
  // {shop}=店名 / {day}=曜日 / {hours}=営業時間 / {tel}=電話番号 / {w}=お酒の種別語
  var THANKS = [
    "いつも{shop}をご利用いただきまして、誠にありがとうございます。",
    "いつも{shop}をご愛顧いただき、誠にありがとうございます。",
    "本日も{shop}をご覧いただき、ありがとうございます。",
    "いつも{shop}にお越しいただき、心より感謝申し上げます。",
  ];

  var WEATHER = {
    "晴れ": ["気持ちよく晴れた{day}ですね。", "青空が広がる{day}になりました。", "よく晴れて気持ちのいい{day}です。"],
    "くもり": ["やわらかな曇り空の{day}です。", "少し雲の多い{day}ですね。"],
    "雨": ["雨模様の{day}になりました。", "あいにくの雨の{day}ですね。", "しっとりと雨の降る{day}です。"],
    "雪": ["雪のちらつく{day}になりました。", "冷え込みの厳しい雪の{day}ですね。"],
    "暑い": ["暑さの続く{day}ですね。", "汗ばむ陽気の{day}になりました。"],
    "蒸し暑い": ["蒸し暑い{day}になりました。", "じめっとした蒸し暑い{day}ですね。"],
    "寒い": ["冷え込む{day}になりました。", "寒さの身にしみる{day}です。"],
    "肌寒い": ["少し肌寒い{day}ですね。", "肌寒さを感じる{day}になりました。"],
    "涼しい": ["涼やかで心地よい{day}ですね。", "過ごしやすい涼しい{day}です。"],
    "風": ["風の強い{day}になりました。", "吹く風の冷たい{day}ですね。"],
  };
  var SEASON = {
    "春": ["春らしい陽気の{day}ですね。", "やわらかな春の{day}になりました。"],
    "初夏": ["初夏のさわやかな{day}ですね。", "新緑のまぶしい{day}になりました。"],
    "梅雨": ["梅雨らしいお天気の{day}ですね。", "雨の多い季節の{day}です。"],
    "夏": ["夏本番の{day}ですね。", "暑さの続く{day}になりました。"],
    "秋": ["秋の深まる{day}ですね。", "過ごしやすい秋の{day}になりました。"],
    "冬": ["冬の冷え込む{day}ですね。", "寒さの増す{day}になりました。"],
    "年末年始": ["今年も残りわずかとなった{day}ですね。", "新たな年を迎える{day}です。"],
  };

  var HOURS_LINE = [
    "本日の営業時間は{hours}です。",
    "本日は{hours}で営業しております。",
    "本日の営業は{hours}でございます。",
  ];
  var SEAT = {
    open: ["ただいまお席にゆとりがございます。", "ただいま空席がございます。"],
    few: ["残席わずかとなっております。", "お席が埋まりつつあります。"],
    reserve: ["混み合う時間帯はご予約がおすすめです。", "ご予約いただくと確実です。"],
    full: ["おかげさまで満席に近い状況です。", "ありがたいことに混み合っております。"],
  };
  var RESERVE = {
    line: ["ご予約はこのLINEからお気軽にどうぞ。", "このLINEからご予約を承ります。"],
    tel_with: ["ご予約はお電話（{tel}）にて承ります。", "お電話（{tel}）でのご予約も承ります。"],
    tel_no: ["ご予約はお電話にて承ります。"],
    both_with: ["ご予約はLINE・お電話（{tel}）どちらでも承ります。"],
    both_no: ["ご予約はLINE・お電話どちらでも承ります。"],
  };

  var TYPE_WORD = { gin: "ジン", cocktail: "カクテル", bottle: "ボトル", osusume: "お酒" };
  var RECO_LEAD = ["今日紹介する{w}は", "本日ご紹介する{w}は", "本日のおすすめ{w}は"];

  var EVENT_INTRO = ["お知らせです。", "《イベント情報》", "【お知らせ】"];

  var CLOSING = [
    "皆様のご来店を心よりお待ちしております。",
    "ご来店を心よりお待ち申し上げております。",
    "本日も皆様のお越しをお待ちしております。",
  ];

  // ---- 日付まわり ----------------------------------------------------------
  var DOW = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  function getDate() {
    var v = el.gDate.value;
    return v ? new Date(v + "T00:00:00") : new Date();
  }
  function autoSeason(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    if ((m === 12 && day >= 25) || (m === 1 && day <= 5)) return "年末年始";
    if (m === 12 || m === 1 || m === 2) return "冬";
    if (m >= 3 && m <= 4) return "春";
    if (m === 5) return "初夏";
    if (m === 6) return "梅雨";
    if (m >= 7 && m <= 8) return "夏";
    return "秋";
  }

  function fill(s, map) {
    return s.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
  }
  function shopName() { return el.pShop.value.trim() || DEFAULTS["p-shop"]; }

  // ---- 各段落の組み立て ----------------------------------------------------
  function buildOpener() {
    var line = "";
    if (state.staff) line += state.staff + "です。";
    line += fill(pick(THANKS), { shop: shopName() });
    return line;
  }
  function buildSeason() {
    var d = getDate(), day = DOW[d.getDay()], weather = el.gWeather.value, s;
    if (weather && WEATHER[weather]) {
      s = pick(WEATHER[weather]);
    } else {
      var season = el.gSeason.value === "auto" ? autoSeason(d) : el.gSeason.value;
      s = pick(SEASON[season] || SEASON["春"]);
    }
    return fill(s, { day: day });
  }
  function buildHours() {
    var parts = [];
    if (el.hShowHours.checked) {
      var hours = el.pHours.value.trim() || DEFAULTS["p-hours"];
      parts.push(fill(pick(HOURS_LINE), { hours: hours }));
    }
    if (el.hSeat.value && SEAT[el.hSeat.value]) parts.push(pick(SEAT[el.hSeat.value]));
    var rv = el.hReserve.value, tel = el.pTel.value.trim();
    if (rv === "line") parts.push(pick(RESERVE.line));
    else if (rv === "tel") parts.push(fill(pick(tel ? RESERVE.tel_with : RESERVE.tel_no), { tel: tel }));
    else if (rv === "both") parts.push(fill(pick(tel ? RESERVE.both_with : RESERVE.both_no), { tel: tel }));
    return parts.join("");
  }
  function buildRecommend() {
    var name = el.rName.value.trim();
    if (!name) return "";
    var w = TYPE_WORD[el.rType.value] || "お酒";
    var block = fill(pick(RECO_LEAD), { w: w }) + "\n\n“" + name + "”\n\nです。";
    var desc = el.rDesc.value.trim();
    if (desc) {
      // B（カタログ解説そのまま）のときだけ「だ・である調」をラベルで囲って“紹介メモ”として見せる。
      // A（短くまとめる＝敬体）や手入力は、本文と地続きでそのまま入れる。
      if (state.descSource === "catalog" && state.descStyle === "B") block += "\n\n【このお酒について】\n" + desc;
      else block += "\n\n" + desc;
    }
    return block;
  }
  function buildEvent() {
    var txt = el.eText.value.trim();
    if (!txt) return "";
    return pick(EVENT_INTRO) + "\n" + txt;
  }
  function buildClosing() { return pick(CLOSING); }

  // ---- 生成本体 ------------------------------------------------------------
  function generate() {
    rng = mulberry32(state.seed);
    var blocks = [];
    blocks.push(buildOpener());                            // 投稿者＋お礼（常時・先頭）
    if (el.tGreeting.checked) blocks.push(buildSeason());  // 季節・天気の一言（お礼の後）
    if (el.tHours.checked) blocks.push(buildHours());
    if (el.tRecommend.checked) blocks.push(buildRecommend());
    if (el.tEvent.checked) blocks.push(buildEvent());
    if (el.tClosing.checked) blocks.push(buildClosing());
    el.output.value = blocks.filter(Boolean).join("\n\n");
    updateCount();
  }
  function updateCount() { el.charCount.textContent = el.output.value.length + " 文字"; }

  // ---- 表示の同期 ----------------------------------------------------------
  function syncParts() {
    setVis("body-greeting", el.tGreeting.checked);
    setVis("body-recommend", el.tRecommend.checked);
    setVis("body-hours", el.tHours.checked);
    setVis("body-event", el.tEvent.checked);
  }
  function setVis(id, on) { var n = $(id); if (n) n.style.display = on ? "" : "none"; }

  // ---- 在庫カタログ連携 ----------------------------------------------------
  // /gin-stock/gins.json（同一ドメイン）を遅延読み込みし、名前・カナ等で検索。
  var catalog = null, catState = "idle", catShown = [];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function catStatus(msg) {
    el.catResults.style.display = "block";
    el.catResults.innerHTML = '<div class="cat-status">' + esc(msg) + "</div>";
  }
  function loadCatalog(cb) {
    if (catState === "ready") { cb(); return; }
    if (catState === "loading") return;
    catState = "loading";
    catStatus("カタログを読み込み中…");
    fetch("/gin-stock/gins.json", { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
      .then(function (d) {
        var gins = (d && d.gins) || [];
        catalog = gins.map(function (g) {
          return {
            name: g.name || "", kana: g.kana || "", note: g.note || "",
            country: g.country || "", botanicals: g.botanicals || "", abv: g.abv,
            hay: ((g.name || "") + " " + (g.kana || "") + " " + (g.country || "") + " " + (g.botanicals || "")).toLowerCase(),
          };
        });
        catState = "ready"; cb();
      })
      .catch(function () {
        catState = "error";
        catStatus("カタログを読み込めませんでした。名前と説明は手入力できます。");
      });
  }
  function renderCat(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) { el.catResults.style.display = "none"; el.catResults.innerHTML = ""; return; }
    if (catState !== "ready") return; // 読み込み中はstatus表示のまま
    catShown = catalog.filter(function (g) { return g.hay.indexOf(q) >= 0; }).slice(0, 30);
    el.catResults.style.display = "block";
    if (!catShown.length) {
      el.catResults.innerHTML = '<div class="cat-status">「' + esc(q) + "」に一致する銘柄は見つかりませんでした。</div>";
      return;
    }
    el.catResults.innerHTML = catShown.map(function (g, i) {
      var sub = [g.name && g.kana ? g.kana : "", g.country].filter(Boolean).join(" ・ ");
      return '<button type="button" class="cat-item" data-i="' + i + '">' +
        '<span class="cat-name">' + esc(g.name || g.kana) + "</span>" +
        (sub ? '<span class="cat-sub">' + esc(sub) + "</span>" : "") + "</button>";
    }).join("");
  }
  function pickCat(i) {
    var g = catShown[i];
    if (!g) return;
    el.rName.value = g.kana || g.name; // 投稿はカナ表記を優先（無ければ英名）
    state.catData = { name: g.name, kana: g.kana, note: g.note, botanicals: g.botanicals, country: g.country, abv: g.abv };
    state.descSource = "catalog";
    applyDescToField(); // 選択中のスタイル(A/B)で説明欄を埋める
    el.catSearch.value = "";
    el.catResults.style.display = "none";
    el.catResults.innerHTML = "";
    if (!el.tRecommend.checked) { el.tRecommend.checked = true; syncParts(); }
    saveAll(); generate();
  }

  // 説明スタイル A=短い敬体の要約 / B=カタログ解説そのまま
  function buildShortDesc(c) {
    var bits = [];
    var bots = String(c.botanicals || "").split(/[、,]/)
      .map(function (s) { return s.replace(/（.*?）/g, "").trim(); })
      .filter(Boolean)
      .filter(function (b) { return !/ジュニパー|juniper/i.test(b); });
    if (bots.length) bits.push(bots.slice(0, 3).join("・") + "などのボタニカルが香ります。");
    if (c.country) bits.push(c.country + "生まれの一本です。");
    if (c.abv != null && c.abv !== "") {
      var a = Number(c.abv);
      if (!isNaN(a)) bits.push("アルコール度数は" + a + "%です。");
    }
    return bits.join("");
  }
  function applyDescToField() {
    if (state.descSource !== "catalog" || !state.catData) return;
    el.rDesc.value = state.descStyle === "A" ? buildShortDesc(state.catData) : (state.catData.note || "");
  }
  function applyDescStyle() {
    if (!el.descstyleRow) return;
    el.descstyleRow.querySelectorAll(".chip").forEach(function (c) {
      var on = c.getAttribute("data-ds") === state.descStyle;
      c.classList.toggle("active", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // ---- 投稿者チップ --------------------------------------------------------
  function staffList() {
    return el.pStaff.value.split(/[,、]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function renderStaffChips() {
    var list = staffList();
    if (list.indexOf(state.staff) < 0) state.staff = list[0] || "";
    el.staffRow.innerHTML = list.map(function (name) {
      var on = name === state.staff;
      return '<button type="button" class="chip' + (on ? " active" : "") +
        '" data-staff="' + esc(name) + '" role="radio" aria-checked="' + (on ? "true" : "false") + '">' +
        esc(name) + "</button>";
    }).join("");
  }

  // ---- 保存・読み込み ------------------------------------------------------
  var SAVE_IDS = ["p-shop", "p-hours", "p-closed", "p-tel", "p-staff",
    "g-weather", "g-season", "r-type", "r-name", "r-desc", "h-seat", "h-reserve"];
  var CHECK_IDS = ["t-greeting", "t-recommend", "t-hours", "t-event", "t-closing", "h-showhours"];

  function saveAll() {
    try {
      var data = { staff: state.staff, descSource: state.descSource, descStyle: state.descStyle, catData: state.catData };
      SAVE_IDS.forEach(function (id) { data[id] = $(id).value; });
      CHECK_IDS.forEach(function (id) { data[id] = $(id).checked; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* 保存不可でも動作継続 */ }
  }
  function loadAll() {
    var data = {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw) || {};
    } catch (e) { data = {}; }
    SAVE_IDS.forEach(function (id) {
      if (data[id] != null) $(id).value = data[id];
      else if (DEFAULTS[id]) $(id).value = DEFAULTS[id];
    });
    CHECK_IDS.forEach(function (id) {
      if (typeof data[id] === "boolean") $(id).checked = data[id];
    });
    if (data.staff) state.staff = data.staff;
    if (data.descSource) state.descSource = data.descSource;
    if (data.descStyle) state.descStyle = data.descStyle;
    if (data.catData) state.catData = data.catData;
    el.gDate.value = todayISO();
    renderStaffChips();
    applyDescStyle();
  }
  function todayISO() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  // ---- コピー / シャッフル / クリア ---------------------------------------
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg; btn.disabled = true;
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1400);
  }
  function copyOut() {
    var text = el.output.value;
    if (!text) { flash(el.btnCopy, "内容がありません"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { flash(el.btnCopy, "コピーしました ✓"); })
        .catch(legacyCopy);
    } else { legacyCopy(); }
    function legacyCopy() {
      el.output.focus(); el.output.select();
      try { document.execCommand("copy"); flash(el.btnCopy, "コピーしました ✓"); }
      catch (e) { flash(el.btnCopy, "コピーできませんでした"); }
    }
  }
  function newSeed() { state.seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1; }
  function clearInputs() {
    if (!window.confirm("本日紹介するお酒・天気・空席などの入力を消去します。店舗プロフィールと投稿者は残ります。よろしいですか？")) return;
    el.rName.value = ""; el.rDesc.value = ""; el.eText.value = "";
    el.gWeather.value = ""; el.gSeason.value = "auto";
    el.hSeat.value = ""; el.hReserve.value = "";
    el.catSearch.value = ""; el.catResults.style.display = "none";
    saveAll(); newSeed(); generate();
  }

  // ---- 配線 ----------------------------------------------------------------
  function onChange(e) {
    if (e.target === el.output) { updateCount(); return; }
    if (e.target === el.catSearch) return; // 検索欄は専用ハンドラで処理
    if (e.target === el.rDesc) state.descSource = "manual"; // 手で書き換えたら地続きの敬体扱い
    if (e.target === el.pStaff) renderStaffChips();
    saveAll(); syncParts(); generate();
  }

  function init() {
    loadAll();
    syncParts();

    document.addEventListener("input", onChange);
    document.addEventListener("change", onChange);

    el.staffRow.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.staff = chip.getAttribute("data-staff");
      renderStaffChips(); saveAll(); generate();
    });
    el.descstyleRow.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.descStyle = chip.getAttribute("data-ds");
      applyDescStyle();
      applyDescToField(); // カタログ由来の説明を選んだスタイルで入れ直す
      saveAll(); generate();
    });

    // カタログ検索
    el.catSearch.addEventListener("focus", function () {
      loadCatalog(function () { renderCat(el.catSearch.value); });
    }, { once: true });
    el.catSearch.addEventListener("input", function () {
      loadCatalog(function () { renderCat(el.catSearch.value); });
    });
    el.catResults.addEventListener("click", function (e) {
      var item = e.target.closest(".cat-item");
      if (!item) return;
      pickCat(parseInt(item.getAttribute("data-i"), 10));
    });

    el.btnCopy.addEventListener("click", copyOut);
    el.btnShuffle.addEventListener("click", function () { newSeed(); generate(); });
    el.btnClear.addEventListener("click", clearInputs);

    newSeed(); generate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
