/*
 * 営業投稿メーカー 本体
 * -------------------------------------------------------------
 * 入力補助型ジェネレーター。各項目の入力をもとに、LINE投稿文を組み立てる。
 * - 言い回しは「シード（乱数の種）」で決める。入力を変えても種が同じなら言い回しは安定し、
 *   「言い回しを変える」ボタンを押すと種が変わって文章の表現が一新される。
 * - 入力内容は端末（localStorage）に自動保存する（file://でも落ちないよう try-catch で保護）。
 * - CSP（script-src 'self'）下なので、イベントは addEventListener で配線する（on* 属性は使わない）。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "soutsu_post_v1";

  // ---- 要素の取得 ----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  var el = {
    // 店舗プロフィール
    pShop: $("p-shop"), pHours: $("p-hours"), pClosed: $("p-closed"),
    pTel: $("p-tel"), pTags: $("p-tags"),
    // 挨拶
    gDate: $("g-date"), gWeather: $("g-weather"), gSeason: $("g-season"),
    // おすすめ
    rType: $("r-type"), rItems: $("r-items"),
    // 営業案内
    hSeat: $("h-seat"), hReserve: $("h-reserve"), hShowHours: $("h-showhours"),
    // イベント
    eText: $("e-text"),
    // トグル
    tGreeting: $("t-greeting"), tRecommend: $("t-recommend"), tHours: $("t-hours"),
    tEvent: $("t-event"), tClosing: $("t-closing"), tTags: $("t-tags"),
    // 出力・操作
    output: $("output"), charCount: $("char-count"),
    btnCopy: $("btn-copy"), btnShuffle: $("btn-shuffle"), btnClear: $("btn-clear"),
    toneRow: $("tone-row"),
  };

  // 初期値（保存が無いときに入れる）
  var DEFAULTS = {
    "p-shop": "Bar Soutsu",
    "p-hours": "18:00〜翌2:00",
    "p-tags": "#BarSoutsu #バー創通 #本日も営業",
  };

  var state = { tone: "friendly", seed: 1 };

  // ---- 乱数（シード固定）---------------------------------------------------
  // mulberry32: 種が同じなら毎回まったく同じ順序の乱数列を返す（言い回しの安定に使う）
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
  // {day}=曜日 / {hours}=営業時間 / {tel}=電話番号 を後で差し込む
  var WEATHER = {
    "晴れ": ["気持ちよく晴れた{day}ですね。", "青空が広がる{day}になりました。", "よく晴れて気持ちのいい{day}です。", "日差しのやわらかな{day}ですね。"],
    "くもり": ["やわらかな曇り空の{day}です。", "少し雲の多い{day}ですね。", "曇り空の落ち着いた{day}になりました。"],
    "雨": ["雨模様の{day}になりました。", "あいにくの雨の{day}ですね。", "しっとりと雨の降る{day}です。", "雨脚の気になる{day}ですが、こんな夜こそ一杯を。"],
    "雪": ["雪のちらつく{day}になりました。", "冷え込みの厳しい雪の{day}ですね。"],
    "暑い": ["暑さの続く{day}ですね。", "汗ばむ陽気の{day}になりました。", "今日も暑い{day}です。"],
    "蒸し暑い": ["蒸し暑い{day}になりました。", "じめっとした蒸し暑い{day}ですね。"],
    "寒い": ["冷え込む{day}になりました。", "底冷えのする{day}ですね。", "寒さの身にしみる{day}です。"],
    "肌寒い": ["少し肌寒い{day}ですね。", "肌寒さを感じる{day}になりました。"],
    "涼しい": ["涼やかで心地よい{day}ですね。", "過ごしやすい涼しい{day}です。"],
    "風": ["風の強い{day}になりました。", "吹く風の冷たい{day}ですね。"],
  };
  var SEASON = {
    "春": ["春らしい陽気の{day}ですね。", "やわらかな春の{day}になりました。", "桜の便りも届くころの{day}です。"],
    "初夏": ["初夏のさわやかな{day}ですね。", "新緑のまぶしい{day}になりました。"],
    "梅雨": ["梅雨らしいお天気の{day}ですね。", "雨の多い季節の{day}です。"],
    "夏": ["夏本番の{day}ですね。", "暑さの続く{day}になりました。"],
    "秋": ["秋の深まる{day}ですね。", "過ごしやすい秋の{day}になりました。"],
    "冬": ["冬の冷え込む{day}ですね。", "寒さの増す{day}になりました。"],
    "年末年始": ["今年も残りわずかとなった{day}ですね。", "新たな年を迎える{day}です。"],
  };
  var DAYLINE = {
    weekend: ["週末の夜、ゆっくりお過ごしください。", "華やぐ週末、当店で過ごしませんか。", "週末のひととき、お待ちしています。"],
    sunday: ["週末の締めくくりに、ほっとひと息いかがですか。", "明日に備えて、静かな一杯もおすすめです。"],
    monday: ["新しい一週間のはじまり、お疲れさまです。", "今週もどうぞよろしくお願いします。"],
    midweek: ["週の半ば、ひと息つきにいらっしゃいませんか。", "お仕事帰りの一杯にぴったりの夜です。"],
  };

  var RECO_INTRO = {
    osusume: ["本日のおすすめはこちらです。", "今夜のおすすめをご紹介します。", "本日のおすすめ。"],
    new: ["新しく仲間入りした顔ぶれです。", "新入荷のご案内です。", "あらたに入荷しました。"],
    limited: ["数量限定でご用意しています。", "数に限りがございます、お早めに。", "本日限りの数量限定です。"],
    season: ["季節限定でお出ししています。", "この時期だけの季節限定です。", "旬を味わう季節限定。"],
  };
  var RECO_SINGLE = {
    osusume: ["本日のおすすめは{item}です。", "今夜は{item}をおすすめします。"],
    new: ["{item}が新たに入荷しました。", "あらたに{item}が仲間入りしています。"],
    limited: ["{item}を数量限定でご用意しています。", "{item}は数に限りがございます。"],
    season: ["{item}を季節限定でお出ししています。", "この時期だけの{item}をどうぞ。"],
  };

  var HOURS_LINE = ["本日の営業は{hours}です。", "本日は{hours}で営業しております。", "{hours}でお待ちしております。"];
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
  var EVENT_INTRO = ["お知らせです。", "《イベント情報》", "【お知らせ】"];
  var CLOSING = {
    calm: ["本日も皆様のお越しを心よりお待ちしております。", "ごゆっくりお過ごしいただけましたら幸いです。", "皆様のご来店をお待ちしております。"],
    friendly: ["今夜も素敵な一杯をご用意してお待ちしています。", "お気軽にお立ち寄りください。", "皆様のお越しをお待ちしています。"],
    lively: ["今夜もお待ちしてます！", "素敵な一杯を用意してお待ちしてます！", "ぜひ遊びにいらしてください！"],
  };

  var EMOJI = {
    greeting: ["🌙", "✨", "🌃", "🍃"],
    drink: ["🍸", "🥃", "🍹", "🍷"],
    closing: ["🍸", "✨", "😊", "🌙", "🙇"],
    event: ["📣", "🎉", "✨"],
  };
  // トーンごとの絵文字の出やすさ（0=まったく出さない / 1=必ず出す）
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
    return "秋"; // 9〜11月
  }

  // ---- 各段落の組み立て ----------------------------------------------------
  function fill(s, map) {
    return s.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
  }

  function buildGreeting() {
    var d = getDate();
    var day = DOW[d.getDay()];
    var weather = el.gWeather.value;
    var opener;
    if (weather && WEATHER[weather]) {
      opener = pick(WEATHER[weather]);
    } else {
      var season = el.gSeason.value === "auto" ? autoSeason(d) : el.gSeason.value;
      opener = pick(SEASON[season] || SEASON["春"]);
    }
    opener = fill(opener, { day: day });

    // 曜日に応じた一言（7割の確率で添える）
    var dayLine = "";
    if (chance(0.7)) {
      var dow = d.getDay();
      var key = dow === 0 ? "sunday" : dow === 1 ? "monday" : (dow === 5 || dow === 6) ? "weekend" : "midweek";
      dayLine = pick(DAYLINE[key]);
    }
    return (opener + (dayLine ? " " + dayLine : "")).trim() + deco("greeting");
  }

  // 「名前｜ひとこと」を分解。区切りは ｜ | ／ / ： : 、 のいずれか
  function parseItem(line) {
    var m = line.split(/\s*[｜|／\/：:、]\s*/);
    var name = (m[0] || "").trim();
    var desc = (m[1] || "").trim();
    return { name: name, desc: desc };
  }
  function itemText(it) {
    return it.desc ? it.name + "（" + it.desc + "）" : "「" + it.name + "」";
  }

  function buildRecommend() {
    var raw = el.rItems.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!raw.length) return "";
    var type = el.rType.value;
    var items = raw.map(parseItem).filter(function (it) { return it.name; });
    if (!items.length) return "";

    if (items.length === 1) {
      var line = fill(pick(RECO_SINGLE[type]), { item: itemText(items[0]) });
      return line + deco("drink");
    }
    var intro = pick(RECO_INTRO[type]) + deco("drink");
    var list = items.map(function (it) {
      return "・" + (it.desc ? it.name + "（" + it.desc + "）" : it.name);
    }).join("\n");
    return intro + "\n" + list;
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

  function buildEvent() {
    var txt = el.eText.value.trim();
    if (!txt) return "";
    return pick(EVENT_INTRO) + deco("event") + "\n" + txt;
  }

  function buildClosing() {
    return pick(CLOSING[state.tone] || CLOSING.friendly) + deco("closing");
  }

  function buildTags() {
    var tags = el.pTags.value.trim();
    return tags;
  }

  // ---- 生成本体 ------------------------------------------------------------
  function generate() {
    rng = mulberry32(state.seed); // 種をリセット＝同じ入力なら同じ言い回しに
    var blocks = [];
    if (el.tGreeting.checked) blocks.push(buildGreeting());
    if (el.tRecommend.checked) blocks.push(buildRecommend());
    if (el.tHours.checked) blocks.push(buildHours());
    if (el.tEvent.checked) blocks.push(buildEvent());
    if (el.tClosing.checked) blocks.push(buildClosing());
    if (el.tTags.checked) blocks.push(buildTags());

    var text = blocks.filter(Boolean).join("\n\n");
    el.output.value = text;
    updateCount();
  }

  function updateCount() {
    var n = el.output.value.length;
    el.charCount.textContent = n + " 文字";
  }

  // ---- 表示の同期（チェックを外したら入力欄を隠す）-------------------------
  function syncParts() {
    setVis("body-greeting", el.tGreeting.checked);
    setVis("body-recommend", el.tRecommend.checked);
    setVis("body-hours", el.tHours.checked);
    setVis("body-event", el.tEvent.checked);
  }
  function setVis(id, on) {
    var node = $(id);
    if (node) node.style.display = on ? "" : "none";
  }

  // ---- 保存・読み込み ------------------------------------------------------
  var SAVE_IDS = ["p-shop", "p-hours", "p-closed", "p-tel", "p-tags",
    "g-weather", "g-season", "r-type", "r-items", "h-seat", "h-reserve"];
  var CHECK_IDS = ["t-greeting", "t-recommend", "t-hours", "t-event", "t-closing", "t-tags", "h-showhours"];

  function saveAll() {
    try {
      var data = { tone: state.tone };
      SAVE_IDS.forEach(function (id) { data[id] = $(id).value; });
      CHECK_IDS.forEach(function (id) { data[id] = $(id).checked; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* プライベートモード等で保存不可でも動作は継続 */ }
  }

  function loadAll() {
    var data = {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw) || {};
    } catch (e) { data = {}; }

    // 値の復元（無ければ初期値）
    SAVE_IDS.forEach(function (id) {
      if (data[id] != null) $(id).value = data[id];
      else if (DEFAULTS[id]) $(id).value = DEFAULTS[id];
    });
    CHECK_IDS.forEach(function (id) {
      if (typeof data[id] === "boolean") $(id).checked = data[id];
    });
    if (data.tone) state.tone = data.tone;

    // 日付は常に今日を初期表示（保存対象外）
    el.gDate.value = todayISO();
    applyTone();
  }

  function todayISO() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  // ---- トーン（チップ）-----------------------------------------------------
  function applyTone() {
    var chips = el.toneRow.querySelectorAll(".chip");
    chips.forEach(function (c) {
      var on = c.getAttribute("data-tone") === state.tone;
      c.classList.toggle("active", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // ---- コピー / シャッフル / クリア ---------------------------------------
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    btn.disabled = true;
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1400);
  }

  function copyOut() {
    var text = el.output.value;
    if (!text) { flash(el.btnCopy, "内容がありません"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { flash(el.btnCopy, "コピーしました ✓"); })
        .catch(function () { legacyCopy(); });
    } else { legacyCopy(); }
    function legacyCopy() {
      el.output.focus(); el.output.select();
      try { document.execCommand("copy"); flash(el.btnCopy, "コピーしました ✓"); }
      catch (e) { flash(el.btnCopy, "コピーできませんでした"); }
    }
  }

  function newSeed() {
    state.seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
  }

  function clearInputs() {
    if (!window.confirm("入力内容（おすすめ・天気・空席など）を消去します。店舗プロフィールは残ります。よろしいですか？")) return;
    el.rItems.value = "";
    el.eText.value = "";
    el.gWeather.value = "";
    el.gSeason.value = "auto";
    el.hSeat.value = "";
    el.hReserve.value = "";
    saveAll();
    newSeed();
    generate();
  }

  // ---- 配線 ----------------------------------------------------------------
  function onChange(e) {
    if (e.target === el.output) { updateCount(); return; }
    saveAll();
    syncParts();
    generate();
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
      applyTone();
      saveAll();
      generate();
    });

    el.btnCopy.addEventListener("click", copyOut);
    el.btnShuffle.addEventListener("click", function () { newSeed(); generate(); });
    el.btnClear.addEventListener("click", clearInputs);

    newSeed();
    generate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
