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
    if (item.source === 'wiki') return 'w/' + (item.wikiLang || 'ar') + '/' + item.wikiTitle;
    return item.type + '/' + item.id;
  }

  function posterHtml(item, size) {
    if (item.poster) {
      return '<img src="' + esc(item.poster) + '" alt="بوستر ' + esc(item.title) + '" loading="lazy" decoding="async">';
    }
    return '<div class="card__ph"><b>' + (item.type === 'tv' ? '📺' : '🎬') + '</b><span>' + esc(item.title) + '</span></div>';
  }

  function scoreClass(r) { return r >= 7.5 ? 'is-high' : r > 0 && r < 5.5 ? 'is-low' : ''; }

  function card(item) {
    var fav = CS.favorites.has({ id: item.id, type: item.type });
    var sub = [];
    if (item.year) sub.push(item.year);
    sub.push(TYPE_AR[item.type] || '');
    if (item.source === 'wiki') sub.push('ويكيبيديا');

    var why = item.whyText
      ? '<span class="card__why ' + (WHY_CLASS[item.why] || '') + '">' + esc(item.whyText) + '</span>'
      : '';

    return '' +
      '<article class="card" data-key="' + esc(itemKey(item)) + '">' +
        '<button class="card__link" data-open="' + esc(itemKey(item)) + '" aria-label="' + esc(item.title) + '">' +
          '<div class="card__poster">' + posterHtml(item) +
            (item.rating ? '<span class="card__score ' + scoreClass(item.rating) + '">' + item.rating.toFixed(1) + '</span>' : '') +
            '<span class="card__type">' + (TYPE_AR[item.type] || '') + '</span>' +
          '</div>' +
          '<div class="card__body">' +
            '<h3 class="card__title">' + esc(item.title) + '</h3>' +
            '<p class="card__sub">' + esc(sub.filter(Boolean).join(' · ')) + '</p>' +
            why +
          '</div>' +
        '</button>' +
        '<button class="card__fav' + (fav ? ' is-on' : '') + '" data-fav="' + esc(itemKey(item)) + '" aria-label="حفظ في قائمتي" aria-pressed="' + (fav ? 'true' : 'false') + '">' +
          '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-9.4-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.4 12c-1.9 4.3-9.4 9-9.4 9z"/></svg>' +
        '</button>' +
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
    return '<div class="links">' + list.map(function (l) {
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
        '<button class="dt__close" data-close-detail aria-label="إغلاق">&times;</button></div>' +
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
    var short = d.overview || extra.overviewEn || '';
    var story = short;

    if (extra.fullPlot) {
      var head = CS.search.norm(short).slice(0, 60);
      if (!story) story = extra.fullPlot;
      else if (!head || CS.search.norm(extra.fullPlot).indexOf(head) === -1) story += '\n\n' + extra.fullPlot;
    }

    var html = story
      ? '<p class="overview">' + esc(story) + '</p>'
      : '<p class="overview overview--empty">ما فيه ملخص متوفر لهالعمل بالعربي. جرّب بدّل لغة المحتوى للإنجليزية من الإعدادات، أو افتح روابط المواقع تحت.</p>';

    var src = [];
    if (short) src.push('الملخص من TMDB');
    if (extra.fullPlot) src.push('تفاصيل القصة من ويكيبيديا');
    if (src.length) html += '<p class="overview__src">🔸 ' + src.join(' · ') + '</p>';

    return '<h3 class="sec__title">القصة الكاملة</h3>' + html;
  }

  /**
   * d: كائن التفاصيل الكامل (tmdb) أو عنصر ويكيبيديا
   * extra: { fullPlot, overviewEn }
   */
  function detail(d, extra) {
    extra = extra || {};
    var isFav = CS.favorites.has(d);
    var facts = [];

    if (d.rating)   facts.push('<span class="fact fact--score">★ ' + d.rating.toFixed(1) + (d.votes ? ' · ' + d.votes.toLocaleString('en-US') : '') + '</span>');
    if (d.year)     facts.push('<span class="fact">' + d.year + '</span>');
    facts.push('<span class="fact">' + (TYPE_AR[d.type] || '') + '</span>');
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
        '<button class="dt__close" data-close-detail aria-label="إغلاق">&times;</button>' +
      '</div>' +

      '<div class="dt__top">' +
        '<div class="dt__poster">' + posterHtml(d) + '</div>' +
        '<div class="dt__headings">' +
          '<h2 class="dt__title">' + esc(d.title) + '</h2>' +
          (d.originalTitle ? '<p class="dt__original">' + esc(d.originalTitle) + '</p>' : '') +
          (d.tagline ? '<p class="dt__tagline">«' + esc(d.tagline) + '»</p>' : '') +
          '<div class="dt__facts">' + facts.join('') + '</div>' +
          '<div class="dt__actions">' +
            '<button class="btn' + (isFav ? '' : ' btn--ghost') + '" data-fav="' + esc(itemKey(d)) + '">' +
              (isFav ? '❤️ محفوظ في قائمتي' : '🤍 احفظ في قائمتي') + '</button>' +
            '<button class="btn btn--ghost" data-share="' + esc(itemKey(d)) + '">🔗 انسخ الرابط</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dt__body">' +
        '<section id="dt-story">' + storySection(d, extra) + '</section>' +

        (provHtml ? '<section><h3 class="sec__title">وين تشوفه <span class="sec__note">(' + esc(CS.state.region) + ')</span></h3>' + provHtml + '</section>' : '') +

        (trailerHtml ? '<section><h3 class="sec__title">التريلر</h3>' + trailerHtml + '</section>' : '') +

        '<section><h3 class="sec__title">ابحث عنه في كل المواقع</h3>' + linksHtml(d) + '</section>' +

        (castHtml ? '<section><h3 class="sec__title">طاقم العمل</h3>' + castHtml + '</section>' : '') +

        (metaTable(d) ? '<section><h3 class="sec__title">معلومات العمل</h3>' + metaTable(d) + '</section>' : '') +

        (similar.length ? '<section><h3 class="sec__title">أعمال مشابهة</h3><div class="rail">' + cards(similar) + '</div></section>' : '') +

        (recs.length ? '<section><h3 class="sec__title">لأنك شفت هذا <span class="sec__note">ترشيحات TMDB</span></h3><div class="rail">' + cards(recs) + '</div></section>' : '') +
      '</div>';
  }

  /* ---------- حالة فارغة ---------- */

  function emptyHtml(query, meta) {
    var tips = [
      'اكتب المشهد اللي تذكره بالتفصيل: «رجل يجلس على كرسي متحرك ويراقب جيرانه».',
      'جرّب بالإنجليزي — تغطية ويكيبيديا الإنجليزية أوسع بكثير.',
      'بدّل طريقة البحث من الأزرار فوق (بالاسم / بوصف القصة / بالثيمة).',
      'اذكر أسماء الممثلين أو المخرج لو تذكرها.'
    ];
    if (meta && meta.noKey) {
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
    detailSkeleton: detailSkeleton,
    emptyHtml: emptyHtml,
    itemKey: itemKey,
    linksHtml: linksHtml,
    TYPE_AR: TYPE_AR
  };

})(window.CS);
