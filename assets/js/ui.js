/* ============================================================
   ui.js — بناء الواجهة: البطاقات، الصفوف، لوحة التفاصيل
   ============================================================ */

(function (CS) {
  'use strict';

  var esc = CS.util.esc;

  var TYPE_AR = { movie: 'فيلم', tv: 'مسلسل' };

  var WHY_CLASS = {
    plot: 'is-plot',
    theme: 'is-theme',
    related: 'is-theme',
    person: '',
    title: ''
  };

  /* ---------- التوست ---------- */

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------- هياكل التحميل ---------- */

  function skeletons(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="skel"><div class="skel__poster"></div><div class="skel__line"></div><div class="skel__line"></div></div>';
    }
    return out;
  }

  /* ---------- البطاقة ---------- */

  function itemKey(item) {
    if (item.source === 'wiki') {
      return 'w/' + (item.wikiLang || 'ar') + '/' + encodeURIComponent(item.wikiTitle || '');
    }
    return item.type + '/' + item.id;
  }

  function posterHtml(item, size) {
    if (item.poster) {
      return '<img src="' + esc(item.poster) + '" alt="بوستر ' + esc(item.title) + '" loading="lazy" decoding="async">';
    }
    return '<div class="card__ph"><b>' + (item.type === 'tv' ? '📺' : '🎬') + '</b><span>' + esc(item.title) + '</span></div>';
  }

  function scoreClass(r) { return r >= 7.5 ? 'is-high' : r > 0 && r < 5.5 ? 'is-low' : ''; }

  /* شارة التصنيف العمري فوق البوستر */
  function certBadge(item) {
    var info = CS.certs.cachedFor(item);
    if (!info) return '';
    var t = CS.certs.tierInfo(info.tier);
    var text = info.tier === 5 ? '🔥' : (t.emoji + ' ' + t.short);
    var title = info.tier === 5 ? 'محتوى إباحي صريح'
              : t.label + (info.cert ? ' · ' + info.cert + (info.country ? ' (' + info.country + ')' : '') : '');
    return '<span class="card__cert" style="border-color:' + esc(t.color) + '55;color:' + esc(t.color) +
           '" title="' + esc(title) + '">' + text + '</span>';
  }

  function voteBar(item, big) {
    var v = CS.taste.verdict(item);
    var k = esc(itemKey(item));
    var cls = big ? ' vote--big' : '';
    return '' +
      '<div class="vote' + cls + '">' +
        '<button class="vote__b vote__up' + (v === 1 ? ' is-on' : '') + '" data-vote="1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === 1 ? 'true' : 'false') + '" aria-label="عجبني" ' +
          'title="عجبني — يظهر في الاستكشاف">' +
          '<span aria-hidden="true">👍</span>' + (big ? '<b>عجبني</b>' : '') + '</button>' +
        '<button class="vote__b vote__down' + (v === -1 ? ' is-on' : '') + '" data-vote="-1" data-item="' + k + '" ' +
          'aria-pressed="' + (v === -1 ? 'true' : 'false') + '" aria-label="ما عجبني" ' +
          'title="ما عجبني — ما يتكرر لك">' +
          '<span aria-hidden="true">👎</span>' + (big ? '<b>ما عجبني</b>' : '') + '</button>' +
      '</div>';
  }

  function card(item) {
    var sub = [];
    if (item.year) sub.push(item.year);
    sub.push(TYPE_AR[item.type] || '');
    if (item.source === 'wiki') sub.push('ويكيبيديا');

    var why = item.whyText
      ? '<span class="card__why ' + (WHY_CLASS[item.why] || '') + '">' + esc(item.whyText) + '</span>'
      : '';

    var href = '#/work/' + itemKey(item);

    return '' +
      '<article class="card" data-key="' + esc(itemKey(item)) + '">' +
        '<a class="card__link" href="' + esc(href) + '" data-open="' + esc(itemKey(item)) + '">' +
          '<div class="card__poster">' + posterHtml(item) +
            (item.rating ? '<span class="card__score ' + scoreClass(item.rating) + '">' + item.rating.toFixed(1) + '</span>' : '') +
            '<span class="card__type">' + (TYPE_AR[item.type] || '') + '</span>' +
            certBadge(item) +
          '</div>' +
          '<div class="card__body">' +
            '<h3 class="card__title">' + esc(item.title) + '</h3>' +
            '<p class="card__sub">' + esc(sub.filter(Boolean).join(' · ')) + '</p>' +
            why +
          '</div>' +
        '</a>' +
        voteBar(item, false) +
      '</article>';
  }

  function cards(list) { return list.map(card).join(''); }

  /* ---------- صف أفقي في الرئيسية ---------- */

  function row(title, hint, list) {
    if (!list || !list.length) return '';
    return '' +
      '<section class="row">' +
        '<div class="row__head">' +
          '<h2 class="row__title">' + title + '</h2>' +
          (hint ? '<span class="row__hint">' + esc(hint) + '</span>' : '') +
        '</div>' +
        '<div class="rail">' + cards(list) + '</div>' +
      '</section>';
  }

  /* ---------- الروابط الخارجية ---------- */

  function linksHtml(item) {
    var list = CS.links.build(item);
    return '<h3 class="sec__title">ابحث عنه في كل المواقع</h3>' +
      '<div class="links">' + list.map(function (l) {
      return '<a class="linkbtn" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="linkbtn__dot" style="background:' + esc(l.color) + '"></span>' +
        esc(l.label) +
        (l.exact ? '' : '<span class="linkbtn__x">بحث</span>') +
      '</a>';
    }).join('') + '</div>';
  }

  /* ---------- منصات المشاهدة ---------- */

  function providersHtml(p) {
    if (!p) return '';
    var groups = [
      ['اشتراك', p.flatrate],
      ['إيجار', p.rent],
      ['شراء', p.buy]
    ].filter(function (g) { return g[1] && g[1].length; });

    if (!groups.length) return '';

    return '<div class="prov">' + groups.map(function (g) {
      return '<div class="prov__g"><span class="prov__lbl">' + g[0] + '</span>' +
        g[1].map(function (x) {
          return '<img src="' + esc(x.logo) + '" alt="' + esc(x.name) + '" title="' + esc(x.name) + '" loading="lazy">';
        }).join('') + '</div>';
    }).join('') + '</div>';
  }

  /* ---------- جدول المعلومات ---------- */

  function metaRow(label, value) {
    if (!value) return '';
    return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function metaTable(d) {
    var rows = '';
    rows += metaRow('الإخراج', (d.directors || []).join('، '));
    rows += metaRow('صنّاع العمل', (d.creators || []).join('، '));
    rows += metaRow('الكتابة', (d.writers || []).join('، '));
    rows += metaRow('المدة', CS.util.minutes(d.runtime));
    rows += metaRow('المواسم', d.seasons ? d.seasons + ' موسم · ' + d.episodes + ' حلقة' : '');
    rows += metaRow('الحالة', d.status);
    rows += metaRow('الشبكة', (d.networks || []).join('، '));
    rows += metaRow('الإنتاج', (d.companies || []).slice(0, 2).join('، '));
    rows += metaRow('الدولة', (d.countries || []).slice(0, 3).join('، '));
    rows += metaRow('الميزانية', CS.util.money(d.budget));
    rows += metaRow('الإيرادات', CS.util.money(d.revenue));
    rows += metaRow('عدد التقييمات', d.votes ? d.votes.toLocaleString('en-US') : '');
    return rows ? '<div class="metatable">' + rows + '</div>' : '';
  }

  /* ---------- لوحة التفاصيل ---------- */

  function detailSkeleton() {
    return '' +
      '<div class="dt__hero"><div class="dt__backdrop"></div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button></div>' +
      '<div class="dt__top">' +
        '<div class="dt__poster skel__poster"></div>' +
        '<div class="dt__headings"><div class="skel__line" style="height:26px;width:60%"></div>' +
        '<div class="skel__line" style="width:35%"></div></div>' +
      '</div>' +
      '<div class="dt__body"><div class="skel__line"></div><div class="skel__line"></div><div class="skel__line"></div></div>';
  }

  /* قسم القصة — منفصل عشان نقدر نحدّثه لحاله لما توصل قصة ويكيبيديا */
  function storySection(d, extra) {
    extra = extra || {};

    /* الملخص القصير: عربي رسمي ← ترجمة آلية ← إنجليزي */
    var short = extra.summary || '';
    var plot  = extra.plotArabic || extra.fullPlot || '';

    var story = short;
    if (plot) {
      var head = CS.search.norm(short).slice(0, 60);
      if (!story) story = plot;
      else if (!head || CS.search.norm(plot).indexOf(head) === -1) story += '\n\n' + plot;
    }

    var html = story
      ? '<p class="overview">' + esc(story) + '</p>'
      : '<p class="overview overview--empty">ما لقيت ملخصًا لهالعمل — لا في TMDB ولا في ويكيبيديا. افتح روابط المواقع تحت.</p>';

    /* نحكم على لغة القصة من نصها نفسه، لا من ويكي أي لغة جبناها —
       فيه مقالات عربية مقاطعها إنجليزية والعكس */
    var plotIsArabic = extra.fullPlot ? CS.util.isArabic(extra.fullPlot) : false;

    /* مصدر كل جزء بالوضوح */
    var src = [];
    if (short) src.push(extra.summarySource || 'الملخص من TMDB');
    if (extra.plotArabic) src.push('القصة من ويكيبيديا (ترجمة آلية)');
    else if (extra.fullPlot) src.push('القصة من ويكيبيديا (' + (plotIsArabic ? 'عربي' : 'إنجليزي') + ')');
    if (src.length) html += '<p class="overview__src">🔸 ' + src.join(' · ') + '</p>';

    /* قصة ويكيبيديا بالإنجليزي والواجهة عربية ← نعرض زر ترجمة يدوي */
    if (extra.fullPlot && !extra.plotArabic && !plotIsArabic && CS.state.lang === 'ar') {
      html += '<div class="dt__actions"><button class="btn btn--ghost btn--sm" data-translate-plot>' +
              '🔤 ترجم القصة الكاملة للعربية</button></div>';
    }
    if (extra.plotError) {
      html += '<p class="overview__src">🔴 ' + esc(extra.plotError) + '</p>';
    }

    return '<h3 class="sec__title">القصة الكاملة</h3>' + html;
  }

  /**
   * d: كائن التفاصيل الكامل (tmdb) أو عنصر ويكيبيديا
   * extra: { fullPlot, overviewEn }
   */
  function detail(d, extra) {
    extra = extra || {};
    var facts = [];

    if (d.rating)   facts.push('<span class="fact fact--score">★ ' + d.rating.toFixed(1) + (d.votes ? ' · ' + d.votes.toLocaleString('en-US') : '') + '</span>');
    if (d.year)     facts.push('<span class="fact">' + d.year + '</span>');
    facts.push('<span class="fact">' + (TYPE_AR[d.type] || '') + '</span>');

    var certInfo = CS.certs.cachedFor(d);
    if (certInfo) {
      var ct = CS.certs.tierInfo(certInfo.tier);
      facts.push('<span class="fact" style="border-color:' + esc(ct.color) + '66;color:' + esc(ct.color) + '">' +
        ct.emoji + ' ' + esc(ct.label) +
        (certInfo.cert && certInfo.tier !== 5 ? ' · ' + esc(certInfo.cert) : '') + '</span>');
    }
    if (d.runtime)  facts.push('<span class="fact">' + esc(CS.util.minutes(d.runtime)) + '</span>');
    if (d.seasons)  facts.push('<span class="fact">' + d.seasons + ' موسم</span>');
    (d.genres || []).forEach(function (g) { facts.push('<span class="fact fact--genre">' + esc(g) + '</span>'); });
    if (d.source === 'wiki') facts.push('<span class="fact">مصدر: ويكيبيديا</span>');

    var castHtml = (d.cast && d.cast.length)
      ? '<div class="cast">' + d.cast.map(function (c) {
          return '<div class="cast__p">' +
            (c.photo ? '<img src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" loading="lazy">'
                     : '<div class="cast__ph">👤</div>') +
            '<b>' + esc(c.name) + '</b>' +
            (c.role ? '<span>' + esc(c.role) + '</span>' : '') +
          '</div>';
        }).join('') + '</div>'
      : '';

    var trailerHtml = d.trailer
      ? '<div class="trailer"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(d.trailer.key) +
        '" title="تريلر ' + esc(d.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>'
      : '';

    var provHtml = providersHtml(d.providers);
    var similar = (d.similar || []).slice(0, 14);
    var recs = (d.recommendations || []).slice(0, 14);

    return '' +
      '<div class="dt__hero">' +
        '<div class="dt__backdrop">' + (d.backdrop ? '<img src="' + esc(d.backdrop) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<button class="dt__close" data-back aria-label="رجوع">&#8594;</button>' +
      '</div>' +

      '<div class="dt__top">' +
        '<div class="dt__poster">' + posterHtml(d) + '</div>' +
        '<div class="dt__headings">' +
          '<h2 class="dt__title">' + esc(d.title) + '</h2>' +
          (d.originalTitle ? '<p class="dt__original">' + esc(d.originalTitle) + '</p>' : '') +
          (d.tagline ? '<p class="dt__tagline">«' + esc(d.tagline) + '»</p>' : '') +
          '<div class="dt__facts">' + facts.join('') + '</div>' +
          '<div class="dt__actions">' +
            voteBar(d, true) +
            '<button class="btn btn--ghost" data-share="' + esc(itemKey(d)) + '">🔗 انسخ الرابط</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dt__body">' +
        '<section id="dt-extra"></section>' +
        '<section id="dt-story">' + storySection(d, extra) + '</section>' +

        (provHtml ? '<section><h3 class="sec__title">وين تشوفه <span class="sec__note">(' + esc(CS.state.region) + ')</span></h3>' + provHtml + '</section>' : '') +

        (trailerHtml ? '<section><h3 class="sec__title">التريلر</h3>' + trailerHtml + '</section>' : '') +

        '<section id="dt-links">' + linksHtml(d) + '</section>' +

        (castHtml ? '<section><h3 class="sec__title">طاقم العمل</h3>' + castHtml + '</section>' : '') +

        (metaTable(d) ? '<section><h3 class="sec__title">معلومات العمل</h3>' + metaTable(d) + '</section>' : '') +

        (similar.length ? '<section><h3 class="sec__title">أعمال مشابهة</h3><div class="rail">' + cards(similar) + '</div></section>' : '') +

        (recs.length ? '<section><h3 class="sec__title">لأنك شفت هذا <span class="sec__note">ترشيحات TMDB</span></h3><div class="rail">' + cards(recs) + '</div></section>' : '') +
      '</div>';
  }

  /* ---------- المصادر الإضافية (OMDb / TVmaze) ---------- */

  function extraSources(d, ex) {
    ex = ex || {};
    var blocks = '';

    if (ex.omdb) {
      var o = ex.omdb, chips = [];
      if (o.imdb)       chips.push(metaRow('IMDb', o.imdb + '/10' + (o.imdbVotes ? ' · ' + o.imdbVotes : '')));
      if (o.rotten)     chips.push(metaRow('Rotten Tomatoes', o.rotten));
      if (o.metacritic) chips.push(metaRow('Metacritic', o.metacritic + '/100'));
      if (o.rated)      chips.push(metaRow('التصنيف الأمريكي', o.rated));
      if (o.awards)     chips.push(metaRow('الجوائز', o.awards));
      if (o.boxOffice)  chips.push(metaRow('شبّاك التذاكر', o.boxOffice));
      if (chips.length) {
        blocks += '<h3 class="sec__title">تقييمات المواقع <span class="sec__note">OMDb</span></h3>' +
                  '<div class="metatable">' + chips.join('') + '</div>';
      }
    }

    if (ex.tvmaze) {
      var t = ex.tvmaze, rows = '';
      rows += metaRow('الحالة', t.status);
      rows += metaRow('موعد العرض', t.schedule);
      rows += metaRow('الشبكة', t.network);
      if (t.next) rows += metaRow('الحلقة القادمة',
        'م' + t.next.season + ' ح' + t.next.number + (t.next.airdate ? ' · ' + t.next.airdate : ''));
      if (t.prev) rows += metaRow('آخر حلقة عُرضت',
        'م' + t.prev.season + ' ح' + t.prev.number + (t.prev.airdate ? ' · ' + t.prev.airdate : ''));
      if (rows) {
        blocks += '<h3 class="sec__title">مواعيد الحلقات <span class="sec__note">TVmaze</span></h3>' +
                  '<div class="metatable">' + rows + '</div>';
      }
    }

    return blocks;
  }

  /* ---------- حالة فارغة ---------- */

  function emptyHtml(query, meta) {
    meta = meta || {};

    /* TMDB ما رد؟ هذي مشكلة اتصال، مو نتيجة بحث فاضية — نقولها صريحة */
    if (meta.tmdbError) {
      return '<b>🔴 TMDB ما رد</b>' +
        '<p>' + esc(meta.tmdbError) + '</p>' +
        '<div style="margin-top:1.2rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn" data-diagnose>🔍 افحص الاتصال</button></div>' +
        '<p style="margin-top:1rem;font-size:.82rem">🟢 جرّب وضع «بوصف القصة» — يشتغل على ويكيبيديا بدون TMDB.</p>';
    }

    var tips = [
      'اكتب المشهد اللي تذكره بالتفصيل: «رجل يجلس على كرسي متحرك ويراقب جيرانه».',
      'جرّب بالإنجليزي — تغطية ويكيبيديا الإنجليزية أوسع بكثير.',
      'بدّل طريقة البحث من الأزرار فوق (بالاسم / بوصف القصة / بالثيمة).',
      'اذكر أسماء الممثلين أو المخرج لو تذكرها.'
    ];
    if (meta.certFiltered) {
      tips.unshift('فلتر التصنيف العمري شغّال (' + esc(meta.certFiltered) + ') — رجّعه لـ«كل التصنيفات».');
    }
    if (meta.noKey) {
      tips.unshift('أضف مفتاح TMDB المجاني من الإعدادات ⚙️ — بيفتح لك البوسترات والتقييمات والأعمال المشابهة.');
    }
    return '<b>🔴 ما لقيت شي لـ «' + esc(query) + '»</b>' +
      '<p>جرّب كذا:</p><ul><li>' + tips.join('</li><li>') + '</li></ul>';
  }

  CS.ui = {
    toast: toast,
    skeletons: skeletons,
    card: card,
    cards: cards,
    row: row,
    detail: detail,
    storySection: storySection,
    extraSources: extraSources,
    voteBar: voteBar,
    certBadge: certBadge,
    detailSkeleton: detailSkeleton,
    emptyHtml: emptyHtml,
    itemKey: itemKey,
    linksHtml: linksHtml,
    TYPE_AR: TYPE_AR
  };

})(window.CS);
