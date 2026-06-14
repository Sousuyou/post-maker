/*
 * 営業投稿メーカー 本体
 * -------------------------------------------------------------
 * Bar Soutsuの定型フォーマットをベースにLINE投稿文を組み立てる入力補助ツール。
 *   文頭に「〇〇です。（投稿者）」＋お礼 → 季節の一言(任意) → 本日の営業時間
 *   → 今日紹介するお酒（名前を強調＋説明） → 空席/予約(任意) → 締め → タグ
 * - 言い回しは「シード（乱数の種）」で決める。入力を変えても種が同じなら言い回しは安定し、
 *   「言い回しを変える」ボタンで種が変わると表現が一新される。
 * - 入力内容は端末（localStorage）に自動保存（file://でも落ちないよう try-catch で保護）。
 * - CSP（script-src 'self'）下なので、イベントは addEventListener で配線する。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "soutsu_post_v2";

  function $(id) { return document.getElementById(id); }
  var el = {
    pShop: $("p-shop"), pHours: $("p-hours"), pClosed: $("p-closed"),
    pTel: $("p-tel"), pStaff: $("p-staff"), pTags: $("p-tags"),
    gDate: $("g-date"), gWeather: $("g-weather"), gSeason: $("g-season"),
    rType: $("r-type"), rName: $("r-name"), rDesc: $("r-desc"),
    hSeat: $("h-seat"), hReserve: $("h-reserve"), hShowHours: $("h-showhours"),
    eText: $("e-text"),
    tGreeting: $("t-greeting"), tRecommend: $("t-recommend"), tHours: $("t-hours"),
    tEvent: $("t-event"), tClosing: $("t-closing"), tTags: $("t-tags"),
    output: $("output"), charCount: $("char-count"),
    btnCopy: $("btn-copy"), btnShuffle: $("btn-shuffle"), btnClear: $("btn-clear"),
    toneRow: $("tone-row"), staffRow: $("staff-row"),
  };

  // 保存が無いときの初期値
  var DEFAULTS = {
    "p-shop": "Bar Soutsu",
    "p-hours": "19:00〜翌2:00",
    "p-staff": "小野寺, 眞家",
    "p-tags": "#BarSoutsu #バー創通 #本日も営業",
  };

  var state = { tone: "calm", seed: 1, staff: "" };

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
  function chance(p) { return rng() < p; }

  // ---- 文面の素材プール ----------------------------------------------------
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

  // 今日紹介するお酒：種別語＋導入フレーズ
  var TYPE_WORD = { gin: "ジン", cocktail: "カクテル", bottle: "ボトル", osusume: "お酒" };
  var RECO_LEAD = [
    "今日紹介する{w}は",
    "本日ご紹介する{w}は",
    "本日のおすすめ{w}は",
  ];

  var EVENT_INTRO = ["お知らせです。", "《イベント情報》", "【お知らせ】"];

  var CLOSING = {
    calm: [
      "皆様のご来店を心よりお待ちしております。",
      "ご来店を心よりお待ち申し上げております。",
      "本日も皆様のお越しをお待ちしております。",
    ],
    friendly: [
      "皆様のご来店を心よりお待ちしております！",
      "ぜひお気軽にお立ち寄りください。お待ちしております！",
      "皆様のお越しを楽しみにお待ちしています。",
    ],
    lively: [
      "皆様のご来店を心よりお待ちしております！",
      "ぜひ遊びにいらしてください！お待ちしてます！",
      "今夜も素敵な一杯をご用意してお待ちしてます！",
    ],
  };

  var EMOJI = {
    greeting: ["🌙", "✨", "🌃", "🍃"],
    drink: ["🍸", "🥃", "🍹", "🍷"],
    closing: ["🍸", "✨", "😊", "🌙", "🙇"],
    event: ["📣", "🎉", "✨"],
  };
  var EMOJI_RATE = { calm: 0, friendly: 0.7, lively: 1 };

  function deco(slot) {
    var rate = EMOJI_RATE[state.tone] || 0;
    if (!chance(rate)) return "";
    var s = " " + pick(EMOJI[slot]);
    if (state.tone === "lively" && chance(0.4)) s += pick(EMOJI[slot]);
    return s;
  }

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
  // 文頭：投稿者＋お礼（常に入る）
  function buildOpener() {
    var line = "";
    if (state.staff) line += state.staff + "です。";
    line += fill(pick(THANKS), { shop: shopName() });
    return line;
  }

  // 季節・天気の一言（任意）
  function buildSeason() {
    var d = getDate();
    var day = DOW[d.getDay()];
    var weather = el.gWeather.value;
    var s;
    if (weather && WEATHER[weather]) {
      s = pick(WEATHER[weather]);
    } else {
      var season = el.gSeason.value === "auto" ? autoSeason(d) : el.gSeason.value;
      s = pick(SEASON[season] || SEASON["春"]);
    }
    return fill(s, { day: day }) + deco("greeting");
  }

  // 本日の営業時間（＋空席・予約）
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

  // 今日紹介するお酒（名前を強調＋説明）
  function buildRecommend() {
    var name = el.rName.value.trim();
    if (!name) return "";
    var w = TYPE_WORD[el.rType.value] || "お酒";
    var lead = fill(pick(RECO_LEAD), { w: w });
    var block = lead + deco("drink") + "\n\n“" + name + "”\n\nです。";
    var desc = el.rDesc.value.trim();
    if (desc) block += "\n\n" + desc;
    return block;
  }

  function buildEvent() {
    var txt = el.eText.value.trim();
    if (!txt) return "";
    return pick(EVENT_INTRO) + deco("event") + "\n" + txt;
  }

  function buildClosing() {
    return pick(CLOSING[state.tone] || CLOSING.calm) + deco("closing");
  }

  function buildTags() { return el.pTags.value.trim(); }

  // ---- 生成本体 ------------------------------------------------------------
  function generate() {
    rng = mulberry32(state.seed);
    var blocks = [];
    if (el.tGreeting.checked) blocks.push(buildSeason()); // 季節の一言（任意・先頭）
    blocks.push(buildOpener());                           // 投稿者＋お礼（常時）
    if (el.tHours.checked) blocks.push(buildHours());
    if (el.tRecommend.checked) blocks.push(buildRecommend());
    if (el.tEvent.checked) blocks.push(buildEvent());
    if (el.tClosing.checked) blocks.push(buildClosing());
    if (el.tTags.checked) blocks.push(buildTags());

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
        '" data-staff="' + name.replace(/"/g, "&quot;") + '" role="radio" aria-checked="' +
        (on ? "true" : "false") + '">' + name + "</button>";
    }).join("");
  }

  // ---- トーン --------------------------------------------------------------
  function applyTone() {
    el.toneRow.querySelectorAll(".chip").forEach(function (c) {
      var on = c.getAttribute("data-tone") === state.tone;
      c.classList.toggle("active", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // ---- 保存・読み込み ------------------------------------------------------
  var SAVE_IDS = ["p-shop", "p-hours", "p-closed", "p-tel", "p-staff", "p-tags",
    "g-weather", "g-season", "r-type", "r-name", "r-desc", "h-seat", "h-reserve"];
  var CHECK_IDS = ["t-greeting", "t-recommend", "t-hours", "t-event", "t-closing", "t-tags", "h-showhours"];

  function saveAll() {
    try {
      var data = { tone: state.tone, staff: state.staff };
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
    if (data.tone) state.tone = data.tone;
    if (data.staff) state.staff = data.staff;

    el.gDate.value = todayISO(); // 日付は常に今日
    applyTone();
    renderStaffChips();
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
    saveAll(); newSeed(); generate();
  }

  // ---- 配線 ----------------------------------------------------------------
  function onChange(e) {
    if (e.target === el.output) { updateCount(); return; }
    if (e.target === el.pStaff) renderStaffChips();
    saveAll(); syncParts(); generate();
  }

  function init() {
    loadAll();
    syncParts();

    document.addEventListener("input", onChange);
    document.addEventListener("change", onChange);

    el.toneRow.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.tone = chip.getAttribute("data-tone");
      applyTone(); saveAll(); generate();
    });
    el.staffRow.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.staff = chip.getAttribute("data-staff");
      renderStaffChips(); saveAll(); generate();
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
