/* ============================================================
   app.js — التوجيه، الأحداث، وربط كل شي مع بعض
   ============================================================ */

(function (CS) {
  'use strict';

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var LIM = CS.config.limits;

  /* مخزن مؤقت للعناصر المعروضة عشان نرجع لها بسرعة */
  var itemCache = {};

  function remember(list) {
    (list || []).forEach(function (it) {
      if (it) itemCache[CS.ui.itemKey(it)] = it;
    });
  }

  /* ============================================================
     العرض: الرئيسية
     ============================================================ */

  function showView(name) {
    CS.state.view = name;
    $('#view-home').hidden    = name !== 'home';
    $('#view-results').hidden = name !== 'results';
    $('#view-fav').hidden     = name !== 'fav';
  }

  function renderHome() {
    showView('home');
    var wrap = $('#home-rows');

    if (!CS.hasKey()) {
      wrap.innerHTML =
        '<div class="empty"><b>🟡 وضع محدود</b>' +
        '<p>حاليًا البحث يشتغل على ويكيبيديا فقط — يعني تقدر تبحث بوصف القصة وتطلع لك النتائج، بس بدون بوسترات وتقييمات وأعمال مشابهة.</p>' +
        '<p style="margin-top:.8rem">أضف مفتاح TMDB المجاني (دقيقتين) عشان يفتح الموقع بالكامل.</p>' +
        '<div style="margin-top:1.2rem"><button class="btn" id="empty-open-settings">افتح الإعدادات</button></div></div>';
      var b = $('#empty-open-settings');
      if (b) b.addEventListener('click', openSettings);
      return;
    }

    wrap.innerHTML = '<div class="grid">' + CS.ui.skeletons(12) + '</div>';

    Promise.all([
      CS.tmdb.trending('week'),
      CS.tmdb.nowPlaying(),
      CS.tmdb.topRated('movie'),
      CS.tmdb.airingToday()
    ]).then(function (r) {
      remember(r[0]); remember(r[1]); remember(r[2]); remember(r[3]);
      var html =
        CS.ui.row('🔥 <span>الأكثر رواجًا</span> هذا الأسبوع', 'أفلام ومسلسلات', r[0].slice(0, 18)) +
        CS.ui.row('🎟️ في <span>السينما</span> الآن', CS.state.region, r[1].slice(0, 18)) +
        CS.ui.row('📺 <span>مسلسلات</span> تُعرض حاليًا', '', r[3].slice(0, 18)) +
        CS.ui.row('🏆 <span>أعلى الأفلام</span> تقييمًا', 'على مرّ التاريخ', r[2].slice(0, 18));

      wrap.innerHTML = html || '<div class="empty"><b>🔴 ما وصلني شي من TMDB</b>' +
        '<p>تأكد من المفتاح في الإعدادات ومن اتصالك بالإنترنت. البحث بوصف القصة (ويكيبيديا) شغّال على أي حال.</p></div>';
    }).catch(function () {
      wrap.innerHTML = '<div class="empty">🔴 ما قدرت أجيب بيانات TMDB. تأكد من المفتاح ومن الاتصال.</div>';
    });
  }

  /* ============================================================
     العرض: النتائج
     ============================================================ */

  /* هروب آمن لقيمة داخل محدِّد سمة */
  function attrEsc(v) { return String(v).replace(/(["\\])/g, '\\$1'); }

  function currentFilters() {
    var active = $('.chip.is-active[data-filter-type]');
    return {
      type: active ? active.dataset.filterType : 'all',
      sort: $('#sort-by').value,
      minRating: +$('#min-rating').value || 0,
      yearFrom: +$('#year-from').value || 0,
      yearTo: +$('#year-to').value || 0
    };
  }

  function applyFilters(list) {
    var f = currentFilters();
    var out = list.filter(function (it) {
      if (f.type !== 'all' && it.type !== f.type) return false;
      if (f.minRating && (it.rating || 0) < f.minRating) return false;
      if (f.yearFrom && (!it.year || it.year < f.yearFrom)) return false;
      if (f.yearTo && (!it.year || it.year > f.yearTo)) return false;
      return true;
    });

    var sorters = {
      relevance:  function (a, b) { return (b.score || 0) - (a.score || 0); },
      rating:     function (a, b) { return (b.rating || 0) - (a.rating || 0); },
      popularity: function (a, b) { return (b.popularity || 0) - (a.popularity || 0); },
      newest:     function (a, b) { return (b.year || 0) - (a.year || 0); },
      oldest:     function (a, b) { return (a.year || 9999) - (b.year || 9999); }
    };
    return out.sort(sorters[f.sort] || sorters.relevance);
  }

  function paintResults() {
    var filtered = applyFilters(CS.state.results.slice());
    var grid = $('#results-grid');
    var empty = $('#results-empty');
    var more = $('#loadmore-wrap');

    if (!filtered.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = CS.state.results.length
        ? '<b>🟡 الفلاتر ضيّقة</b><p>ما فيه نتيجة تطابق الفلاتر الحالية. اضغط «تصفير».</p>'
        : CS.ui.emptyHtml(CS.state.query, CS.state.meta || {});
      more.hidden = true;
      return;
    }

    empty.hidden = true;

    var slice = filtered.slice(0, CS.state.shown);
    grid.innerHTML = CS.ui.cards(slice);
    more.hidden = filtered.length <= CS.state.shown;

    $('#results-meta').textContent = buildMetaText(filtered.length);
  }

  function buildMetaText(count) {
    var m = CS.state.meta || {};
    var bits = [count + ' نتيجة'];
    var names = { title: 'بالاسم', plot: 'بوصف القصة', theme: 'بالثيمة' };
    if (m.engines && m.engines.length) {
      bits.push('محركات: ' + m.engines.map(function (e) { return names[e] || e; }).join(' + '));
    }
    if (m.translated) bits.push('ترجمة البحث: ' + m.translated);
    if (m.relatedOf) bits.push('+ أعمال قريبة من «' + m.relatedOf + '»');
    return bits.join(' · ');
  }

  function doSearch(query, mode, skipHash) {
    query = String(query || '').trim();
    if (!query) return;

    mode = mode || CS.state.mode || 'auto';
    CS.state.query = query;
    CS.state.mode = mode;
    CS.store.set(CS.KEYS.mode, mode);
    CS.history.push(query);

    $('#q').value = query;
    setModeChip(mode);
    suggestOff = true;           // ما نبي الاقتراحات ترجع تفتح بعد البحث
    hideSuggest();
    showView('results');
    $('#results-title').textContent = '«' + query + '»';
    $('#results-meta').textContent = 'يدور…';
    $('#results-grid').innerHTML = CS.ui.skeletons(12);
    $('#results-empty').hidden = true;
    $('#loadmore-wrap').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!skipHash) {
      var h = '#/s/' + mode + '/' + encodeURIComponent(query);
      if (location.hash !== h) { suppressRoute = true; location.hash = h; }
    }

    var token = ++searchToken;

    CS.search.run(query, mode).then(function (res) {
      if (token !== searchToken) return;
      CS.state.results = res.items;
      CS.state.meta = res.meta;
      CS.state.shown = LIM.pageSize;
      remember(res.items);
      paintResults();
    }).catch(function (err) {
      if (token !== searchToken) return;
      $('#results-grid').innerHTML = '';
      $('#results-empty').hidden = false;
      $('#results-empty').innerHTML = '<b>🔴 صار خطأ في البحث</b><p>' +
        CS.util.esc(err && err.message === 'BAD_KEY' ? 'مفتاح TMDB غير صالح — عدّله من الإعدادات.' : 'تحقق من اتصالك وجرّب مرة ثانية.') + '</p>';
    });
  }

  var searchToken = 0;

  /* ============================================================
     العرض: المفضلة
     ============================================================ */

  function renderFav() {
    showView('fav');
    var list = CS.favorites.all();
    remember(list);
    $('#fav-grid').innerHTML = CS.ui.cards(list);
    $('#fav-empty').hidden = list.length > 0;
    $('#fav-meta').textContent = list.length ? list.length + ' عمل محفوظ' : '';
    updateFavCount();
  }

  function updateFavCount() {
    var n = CS.favorites.all().length;
    var el = $('#fav-count');
    el.textContent = n;
    el.hidden = n === 0;
  }

  /* ============================================================
     لوحة التفاصيل
     ============================================================ */

  var detailToken = 0;

  function openSheet() {
    $('#detail').hidden = false;
    document.body.classList.add('is-locked');
  }

  function closeSheet() {
    $('#detail').hidden = true;
    $('#detail-panel').innerHTML = '';
    document.body.classList.remove('is-locked');
    /* نرجع للمسار السابق بدون ما نفتح التفاصيل من جديد */
    var back = CS.state.listRoute || '#/';
    if (location.hash !== back) { suppressRoute = true; location.hash = back; }
  }

  function openDetail(type, id) {
    var token = ++detailToken;
    openSheet();
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();
    panel.scrollTop = 0;
    panel.focus();

    if (!CS.hasKey()) {
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🟡 محتاج مفتاح TMDB</b>' +
        '<p>صفحة التفاصيل الكاملة (بوستر، تريلر، طاقم، مشابهات) تحتاج مفتاح TMDB المجاني.</p></div></div>';
      return;
    }

    CS.tmdb.details(type, id).then(function (d) {
      if (token !== detailToken) return;

      var jobs = [];
      /* وصف بديل بالإنجليزي لو العربي فاضي */
      jobs.push(!d.overview ? CS.tmdb.overviewFallback(type, id) : Promise.resolve(''));

      return Promise.all(jobs).then(function (r) {
        if (token !== detailToken) return;
        var extra = { overviewEn: r[0] };
        panel.innerHTML = CS.ui.detail(d, extra);
        remember([d]);
        remember(d.similar);
        remember(d.recommendations);
        panel.scrollTop = 0;

        /* القصة الكاملة من ويكيبيديا — تُضاف بعدين بدون ما تعطّل العرض */
        attachWikiPlot(d, extra, token);
      });
    }).catch(function (err) {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty"><b>🔴 ما قدرت أفتح التفاصيل</b><p>' +
        CS.util.esc(err && err.message === 'BAD_KEY' ? 'مفتاح TMDB غير صالح.' : 'جرّب مرة ثانية.') + '</p></div></div>';
    });
  }

  function attachWikiPlot(d, extra, token) {
    var probe = (d.originalTitle || d.title) + (d.year ? ' ' + d.year : '');
    var lang = CS.util.isArabic(d.title) ? 'ar' : 'en';

    var known = d.wikiTitle
      ? Promise.resolve({ wikiLang: d.wikiLang || lang, wikiTitle: d.wikiTitle })
      : CS.wiki.findWorks(lang, probe, 4).then(function (works) {
          var hit = works.filter(function (w) {
            return CS.search.similarity(w.cleanTitle, d.originalTitle || d.title) > .6 &&
                   (!w.year || !d.year || Math.abs(w.year - d.year) <= 1);
          })[0];
          return hit ? { wikiLang: hit.wikiLang, wikiTitle: hit.wikiTitle, wikiUrl: hit.wikiUrl } : null;
        });

    known.then(function (w) {
      if (!w || token !== detailToken) return;
      return CS.wiki.fullPlot(w.wikiLang, w.wikiTitle).then(function (plot) {
        if (!plot || token !== detailToken) return;
        d.wikiUrl = d.wikiUrl || w.wikiUrl;
        extra.fullPlot = plot;

        /* نحدّث قسم القصة لحاله عشان ما يعيد تحميل التريلر */
        var sec = $('#dt-story');
        if (sec) sec.innerHTML = CS.ui.storySection(d, extra);
      });
    }).catch(function () { /* القصة الكاملة اختيارية */ });
  }

  function openWikiDetail(lang, title) {
    var token = ++detailToken;
    openSheet();
    var panel = $('#detail-panel');
    panel.innerHTML = CS.ui.detailSkeleton();

    var cached = itemCache['w/' + lang + '/' + title];

    CS.wiki.fullPlot(lang, title).then(function (plot) {
      if (token !== detailToken) return;
      var d = cached || {
        id: 'w', type: 'movie', title: CS.util.cleanTitle(title), year: null,
        poster: '', source: 'wiki', overview: '',
        wikiLang: lang, wikiTitle: title,
        wikiUrl: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title)
      };
      panel.innerHTML = CS.ui.detail(d, { fullPlot: plot });
      panel.scrollTop = 0;
    }).catch(function () {
      if (token !== detailToken) return;
      panel.innerHTML = '<div class="dt__body"><div class="empty">🔴 ما قدرت أجيب المقالة من ويكيبيديا.</div></div>';
    });
  }

  /* ============================================================
     الإعدادات
     ============================================================ */

  function openSettings() {
    $('#api-key').value = CS.state.apiKey || '';
    $('#set-lang').value = CS.state.lang;
    $('#set-region').value = CS.state.region;
    $('#key-state').className = 'keystate';
    $('#settings').hidden = false;
    document.body.classList.add('is-locked');
    setTimeout(function () { $('#api-key').focus(); }, 60);
  }

  function closeSettings() {
    $('#settings').hidden = true;
    if ($('#detail').hidden) document.body.classList.remove('is-locked');
  }

  function saveSettings() {
    var key = $('#api-key').value.trim();
    var lang = $('#set-lang').value;
    var region = $('#set-region').value;
    var state = $('#key-state');

    CS.state.lang = CS.store.set(CS.KEYS.lang, lang);
    CS.state.region = CS.store.set(CS.KEYS.region, region);
    $('#lang-label').textContent = lang === 'ar' ? 'ع' : 'EN';

    if (!key) {
      CS.state.apiKey = '';
      CS.store.remove(CS.KEYS.apiKey);
      state.className = 'keystate is-bad';
      state.textContent = '🟡 حفظت الإعدادات بدون مفتاح — الموقع بيشتغل بوضع ويكيبيديا فقط.';
      refreshKeyNotice();
      renderHome();
      return;
    }

    state.className = 'keystate is-wait';
    state.textContent = '⏳ أختبر المفتاح…';

    CS.tmdb.testKey(key).then(function () {
      CS.state.apiKey = CS.store.set(CS.KEYS.apiKey, key);
      state.className = 'keystate is-ok';
      state.textContent = '🟢 المفتاح شغّال. كل المزايا مفتوحة الحين.';
      refreshKeyNotice();
      return CS.tmdb.loadGenres();
    }).then(function () {
      setTimeout(function () {
        closeSettings();
        CS.ui.toast('🟢 تم الحفظ');
        if (CS.state.query) doSearch(CS.state.query, CS.state.mode, true);
        else renderHome();
      }, 700);
    }).catch(function (err) {
      state.className = 'keystate is-bad';
      state.textContent = err && err.message === 'BAD_KEY'
        ? '🔴 المفتاح مرفوض من TMDB. تأكد إنك ناسخ مفتاح v3 أو توكن v4 كامل.'
        : '🔴 ما قدرت أتحقق من المفتاح — تحقق من الاتصال.';
    });
  }

  function refreshKeyNotice() {
    var off = CS.store.get(CS.KEYS.noticeOff, false);
    $('#key-notice').hidden = CS.hasKey() || off;
  }

  /* ============================================================
     الاقتراحات الفورية
     ============================================================ */

  var suggestToken = 0;
  var suggestOff = false;

  function hideSuggest() {
    suggestToken++;              // يلغي أي طلب اقتراحات طائر
    var s = $('#suggest');
    s.hidden = true;
    s.innerHTML = '';
  }

  var runSuggest = CS.util.debounce(function (q) {
    if (suggestOff || q.length < 2 || !CS.hasKey()) return hideSuggest();
    var token = ++suggestToken;

    CS.search.suggest(q).then(function (list) {
      if (token !== suggestToken || !list.length) return hideSuggest();
      remember(list);
      var s = $('#suggest');
      s.innerHTML = list.map(function (it) {
        var img = it.poster
          ? '<img src="' + CS.util.esc(it.poster) + '" alt="" loading="lazy">'
          : '<span class="sug__ph">' + (it.type === 'tv' ? '📺' : '🎬') + '</span>';
        return '<button type="button" class="sug" data-open="' + CS.util.esc(CS.ui.itemKey(it)) + '">' + img +
          '<span class="sug__t"><b>' + CS.util.esc(it.title) + '</b>' +
          '<span>' + [it.year, CS.ui.TYPE_AR[it.type]].filter(Boolean).join(' · ') + '</span></span></button>';
      }).join('');
      s.hidden = false;
    }).catch(hideSuggest);
  }, 320);

  /* ============================================================
     التوجيه (Routing)
     ============================================================ */

  var suppressRoute = false;

  function parseHash() {
    var h = location.hash.slice(1).replace(/^\//, '');
    if (!h) return { name: 'home' };
    var parts = h.split('/');

    if (parts[0] === 's' && parts.length >= 3) {
      return { name: 'search', mode: parts[1], query: decodeURIComponent(parts.slice(2).join('/')) };
    }
    if ((parts[0] === 'movie' || parts[0] === 'tv') && parts[1]) {
      return { name: 'detail', type: parts[0], id: parts[1] };
    }
    if (parts[0] === 'w' && parts.length >= 3) {
      return { name: 'wiki', lang: parts[1], title: decodeURIComponent(parts.slice(2).join('/')) };
    }
    if (parts[0] === 'fav') return { name: 'fav' };
    return { name: 'home' };
  }

  function onRoute() {
    if (suppressRoute) { suppressRoute = false; return; }
    var r = parseHash();

    if (r.name === 'detail' || r.name === 'wiki') {
      if (r.name === 'detail') openDetail(r.type, r.id);
      else openWikiDetail(r.lang, r.title);
      return;
    }

    /* أي مسار غير التفاصيل يقفل اللوحة */
    if (!$('#detail').hidden) {
      $('#detail').hidden = true;
      $('#detail-panel').innerHTML = '';
      document.body.classList.remove('is-locked');
    }

    CS.state.listRoute = location.hash || '#/';

    if (r.name === 'search') { doSearch(r.query, r.mode, true); return; }
    if (r.name === 'fav')    { renderFav(); return; }
    renderHome();
  }

  function goDetail(key) {
    suggestOff = true;
    hideSuggest();
    CS.state.listRoute = location.hash && parseHash().name !== 'detail' && parseHash().name !== 'wiki'
      ? location.hash : (CS.state.listRoute || '#/');
    location.hash = '#/' + key;
  }

  /* ============================================================
     أوضاع البحث
     ============================================================ */

  function setModeChip(mode) {
    $$('.chip[data-mode]').forEach(function (c) {
      var on = c.dataset.mode === mode;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ============================================================
     ربط الأحداث
     ============================================================ */

  function bind() {

    /* --- نموذج البحث --- */
    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#q').value.trim();
      if (q) doSearch(q, CS.state.mode);
    });

    $('#q').addEventListener('input', function () {
      var v = this.value.trim();
      $('#search-clear').hidden = !v;
      suggestOff = false;
      runSuggest(v);
    });

    $('#q').addEventListener('focus', function () {
      if (this.value.trim().length >= 2) runSuggest(this.value.trim());
    });

    $('#search-clear').addEventListener('click', function () {
      $('#q').value = '';
      this.hidden = true;
      hideSuggest();
      $('#q').focus();
    });

    $$('.chip[data-mode]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        CS.state.mode = chip.dataset.mode;
        CS.store.set(CS.KEYS.mode, CS.state.mode);
        setModeChip(CS.state.mode);
        var q = $('#q').value.trim();
        if (q) doSearch(q, CS.state.mode);
      });
    });

    /* --- أمثلة الرئيسية --- */
    $('#hero-examples').addEventListener('click', function (e) {
      var b = e.target.closest('[data-example]');
      if (!b) return;
      doSearch(b.dataset.example, 'plot');
    });

    /* --- الفلاتر --- */
    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter-type]');
      if (!b) return;
      $$('[data-filter-type]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      CS.state.shown = LIM.pageSize;
      paintResults();
    });

    ['#sort-by', '#min-rating', '#year-from', '#year-to'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        CS.state.shown = LIM.pageSize;
        paintResults();
      });
    });

    $('#btn-reset-filters').addEventListener('click', function () {
      $$('[data-filter-type]').forEach(function (x) { x.classList.toggle('is-active', x.dataset.filterType === 'all'); });
      $('#sort-by').value = 'relevance';
      $('#min-rating').value = '0';
      $('#year-from').value = '';
      $('#year-to').value = '';
      CS.state.shown = LIM.pageSize;
      paintResults();
    });

    $('#btn-loadmore').addEventListener('click', function () {
      CS.state.shown += LIM.pageSize;
      paintResults();
    });

    /* --- النقر على البطاقات والقلوب (تفويض عام) --- */
    document.addEventListener('click', function (e) {
      var open = e.target.closest('[data-open]');
      if (open) { goDetail(open.dataset.open); return; }

      var fav = e.target.closest('[data-fav]');
      if (fav) {
        e.preventDefault();
        var item = itemCache[fav.dataset.fav];
        if (!item) return;
        var added = CS.favorites.toggle(item);
        CS.ui.toast(added ? '❤️ انحفظ في قائمتك' : '🤍 انشال من قائمتك');
        updateFavCount();

        /* نحدّث كل الأزرار المرتبطة بنفس العمل */
        $$('[data-fav="' + attrEsc(fav.dataset.fav) + '"]').forEach(function (btn) {
          if (btn.classList.contains('card__fav')) {
            btn.classList.toggle('is-on', added);
            btn.setAttribute('aria-pressed', added ? 'true' : 'false');
          } else {
            btn.classList.toggle('btn--ghost', !added);
            btn.textContent = added ? '❤️ محفوظ في قائمتي' : '🤍 احفظ في قائمتي';
          }
        });
        if (CS.state.view === 'fav') renderFav();
        return;
      }

      var share = e.target.closest('[data-share]');
      if (share) {
        var url = location.origin + location.pathname + '#/' + share.dataset.share;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { CS.ui.toast('🔗 انتسخ الرابط'); });
        } else {
          CS.ui.toast(url);
        }
        return;
      }

      if (e.target.closest('[data-close-detail]')) { closeSheet(); return; }
      if (e.target.closest('[data-close-settings]')) { closeSettings(); return; }
      if (e.target.closest('[data-route-home]')) { location.hash = '#/'; return; }

      /* إخفاء الاقتراحات عند النقر خارج البحث */
      if (!e.target.closest('#search-form')) hideSuggest();
    });

    /* --- أزرار الهيدر --- */
    $('#btn-fav').addEventListener('click', function () { location.hash = '#/fav'; });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#notice-open-settings').addEventListener('click', openSettings);

    $('#notice-dismiss').addEventListener('click', function () {
      CS.store.set(CS.KEYS.noticeOff, true);
      $('#key-notice').hidden = true;
    });

    $('#btn-lang').addEventListener('click', function () {
      CS.state.lang = CS.store.set(CS.KEYS.lang, CS.state.lang === 'ar' ? 'en' : 'ar');
      $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
      CS.ui.toast(CS.state.lang === 'ar' ? '🟢 لغة المحتوى: العربية' : '🟢 Content language: English');
      CS.tmdb.loadGenres().then(function () {
        if (CS.state.view === 'results' && CS.state.query) doSearch(CS.state.query, CS.state.mode, true);
        else if (CS.state.view === 'home') renderHome();
      });
    });

    $('#btn-back-home').addEventListener('click', function () { location.hash = '#/'; });
    $('#btn-fav-back').addEventListener('click', function () { location.hash = '#/'; });

    /* --- الإعدادات --- */
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-clear-key').addEventListener('click', function () {
      $('#api-key').value = '';
      CS.state.apiKey = '';
      CS.store.remove(CS.KEYS.apiKey);
      refreshKeyNotice();
      $('#key-state').className = 'keystate is-bad';
      $('#key-state').textContent = '🟡 انحذف المفتاح. الموقع بوضع ويكيبيديا فقط.';
    });

    /* --- الاختصارات --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#settings').hidden) return closeSettings();
        if (!$('#detail').hidden) return closeSheet();
        hideSuggest();
        return;
      }
      var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    });

    window.addEventListener('hashchange', onRoute);
  }

  /* ============================================================
     الإقلاع
     ============================================================ */

  function boot() {
    $('#lang-label').textContent = CS.state.lang === 'ar' ? 'ع' : 'EN';
    setModeChip(CS.state.mode);
    updateFavCount();
    refreshKeyNotice();
    bind();

    var start = CS.hasKey() ? CS.tmdb.loadGenres().catch(function () {}) : Promise.resolve();
    start.then(onRoute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.CS);
