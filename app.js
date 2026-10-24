'use strict';
(function () {
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const toastEl = document.getElementById('toast');
  const CFG = window.PIXELMAPY_CONFIG || {};
  const CATEGORIES = ['Przygodowe', 'Survival', 'Parkour', 'Minigry', 'Budowle', 'PvP', 'Puzzle', 'Horror', 'Inne'];
  const PER = 12;
  const MAP_SELECT = '*, author:profiles!maps_author_id_fkey(id,username,avatar)';
  let sb = null;
  let me = null; // { id, email, username, bio, avatar, role }
  const home = { q: '', cat: '', sort: 'new', page: 1 };

  // ---------- narzędzia ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function mount(...nodes) { clear(app); nodes.filter(Boolean).forEach((n) => app.append(n)); window.scrollTo(0, 0); }
  let toastTimer;
  function toast(msg, bad) {
    toastEl.textContent = msg; toastEl.className = 'toast' + (bad ? ' bad' : ''); toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3800);
  }
  const go = (p) => { location.hash = '#' + p; };
  const fmtDate = (t) => new Date(t).toLocaleDateString('pl-PL');
  const STATUS = { pending: 'Czeka na akceptację', approved: 'Opublikowana', rejected: 'Odrzucona' };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  const fmtDateTime = (t) => new Date(t).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

  // ---------- eventy: motyw, odliczanie, ranking ----------
  let currentEvent = null;
  const THEMES = { end: 'The End', nether: 'Nether', winter: 'Zima', default: 'Zwykły wygląd' };
  const tickers = new Set();
  function countdown(el, endIso) {
    const end = new Date(endIso).getTime();
    const p = (n) => String(n).padStart(2, '0');
    const upd = () => {
      const ms = end - Date.now();
      if (ms <= 0) { el.textContent = 'Event zakończony'; return; }
      const s = Math.floor(ms / 1000);
      el.textContent = (s >= 86400 ? Math.floor(s / 86400) + ' d ' : '') + p(Math.floor((s % 86400) / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
    };
    upd();
    tickers.add({ el, upd, born: Date.now() });
  }
  setInterval(() => { tickers.forEach((t) => { if (!t.el.isConnected && Date.now() - t.born > 3000) tickers.delete(t); else t.upd(); }); }, 1000);

  function applyTheme() {
    document.body.className = document.body.className.replace(/\btheme-\w+/g, '').trim();
    if (currentEvent && currentEvent.theme && currentEvent.theme !== 'default') document.body.classList.add('theme-' + currentEvent.theme);
  }
  async function loadEvent() {
    try {
      const { data, error } = await sb.from('events').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1);
      currentEvent = !error && data && data[0] ? data[0] : null;
    } catch (e) { currentEvent = null; }
    applyTheme();
  }
  async function fetchTop(n) {
    const { data, error } = await sb.from('maps').select(MAP_SELECT).eq('status', 'approved').order('score', { ascending: false }).order('created_at', { ascending: false }).limit(n);
    if (error) return [];
    const liked = await likedSet(data.map((x) => x.id));
    return data.map((x) => norm(x, liked));
  }
  function eventBanner() {
    if (!currentEvent) return null;
    const ev = currentEvent;
    const ended = new Date(ev.ends_at) <= new Date();
    const cd = h('div', { class: 'countdown' });
    countdown(cd, ev.ends_at);
    const list = h('div', { class: 'grid' });
    const box = h('section', { class: 'panel event' },
      h('h2', {}, '★ EVENT: ' + ev.name),
      ev.description ? h('p', {}, ev.description) : null,
      h('div', { class: 'evtime' }, ended ? null : h('span', {}, 'Do końca eventu:'), cd),
      h('h3', {}, ended ? 'Zwycięzca eventu (najwięcej pobrań i polubień)' : 'Prowadzą mapy z największą liczbą pobrań i polubień'), list);
    fetchTop(3).then((maps) => {
      if (!maps.length) { list.append(h('div', { class: 'empty' }, 'Jeszcze nie ma żadnych map w rankingu.')); return; }
      maps.forEach((m, i) => list.append(h('div', {}, h('div', { class: 'rank' }, i === 0 && ended ? '🏆 ZWYCIĘZCA' : '#' + (i + 1) + (i === 0 ? ' – prowadzi' : '')), mapCard(m))));
    }).catch(() => {});
    return box;
  }

  function niceError(e) {
    const m = (e && e.message) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy email lub hasło';
    if (/already registered|already been registered/i.test(m)) return 'Ten email jest już zajęty';
    if (/Email not confirmed/i.test(m)) return 'Najpierw potwierdź email (sprawdź skrzynkę)';
    if (/profiles_username_lower|duplicate key/i.test(m)) return 'Ta nazwa użytkownika jest już zajęta';
    if (/Database error saving new user/i.test(m)) return 'Nazwa lub email jest zajęta albo niepoprawna';
    if (/rate limit|too many/i.test(m)) return 'Za dużo prób, spróbuj za chwilę';
    if (/row-level security|permission denied/i.test(m)) return 'Brak uprawnień do tej operacji';
    if (/Password should be/i.test(m)) return 'Hasło: minimum 6 znaków';
    return m;
  }
  async function q(promise) { const r = await promise; if (r.error) throw r.error; return r; }

  // ---------- generowana grafika pixel ----------
  function seedRng(str) {
    let s = 2166136261;
    for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
    return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const cache = new Map();
  function canvasUrl(key, w, h2, scale, draw) {
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h2 * scale;
    const x = c.getContext('2d');
    draw((px, py, col) => { x.fillStyle = col; x.fillRect(px * scale, py * scale, scale, scale); }, seedRng(key));
    const u = c.toDataURL(); cache.set(key, u); return u;
  }
  function thumbUrl(seed) {
    return canvasUrl('t' + seed, 32, 18, 8, (px, rnd) => {
      const sky = ['#7ec0ee', '#f4a261', '#2b2d42', '#9bd0f5', '#c77dff'][Math.floor(rnd() * 5)];
      for (let x = 0; x < 32; x++) for (let y = 0; y < 18; y++) px(x, y, sky);
      let hgt = 9 + Math.floor(rnd() * 4);
      for (let x = 0; x < 32; x++) {
        hgt = Math.max(5, Math.min(14, hgt + Math.floor(rnd() * 3) - 1));
        for (let y = hgt; y < 18; y++) px(x, y, y === hgt ? '#5dae3b' : y < hgt + 4 ? '#7a5230' : (rnd() < .12 ? '#d4af37' : '#7d7d7d'));
        if (rnd() < .08 && hgt > 7) { for (let t = 1; t <= 3; t++) px(x, hgt - t, '#5b3a1a'); for (let lx = -1; lx <= 1; lx++) for (let ly = 4; ly <= 5; ly++) if (x + lx >= 0 && x + lx < 32) px(x + lx, hgt - ly + 1, '#2f8f2f'); }
      }
    });
  }
  const AV_COL = ['#5dae3b', '#4a90d9', '#d9473d', '#f2c230', '#c77dff', '#ff8fab', '#2ec4b6', '#f4a261', '#8d99ae', '#80ed99', '#e76f51', '#90e0ef'];
  function avatarUrl(i) {
    return canvasUrl('a' + i, 8, 8, 8, (px, rnd) => {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) px(x, y, '#2a2018');
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) if (rnd() < .55) { px(x, y, AV_COL[i % 12]); px(7 - x, y, AV_COL[i % 12]); }
    });
  }
  const avatar = (i, small) => h('img', { class: 'avatar' + (small ? ' s' : ''), src: avatarUrl(i || 0), alt: '' });

  // ---------- dane (Supabase) ----------
  function norm(r, liked) {
    return {
      id: r.id, name: r.name, description: r.description, category: r.category, version: r.version || '', image: safeUrl(r.image) || '',
      status: r.status, createdAt: r.created_at, likes: r.like_count, downloads: r.downloads, link: r.link,
      liked: liked ? liked.has(r.id) : false, author: r.author ? { id: r.author.id, username: r.author.username, avatar: r.author.avatar } : null,
    };
  }
  async function likedSet(ids) {
    if (!me || !ids.length) return new Set();
    const { data } = await q(sb.from('likes').select('map_id').eq('user_id', me.id).in('map_id', ids));
    return new Set(data.map((x) => x.map_id));
  }
  async function loadProfile(user) {
    const { data } = await q(sb.from('profiles').select('*').eq('id', user.id).single());
    me = { id: user.id, email: user.email, username: data.username, bio: data.bio, avatar: data.avatar, role: data.role, ban: null };
    try {
      const { data: b } = await sb.from('bans').select('until,reason').eq('user_id', user.id).maybeSingle();
      if (b && new Date(b.until) > new Date()) me.ban = { until: b.until, reason: b.reason };
    } catch (e) { /* tabela bans może jeszcze nie istnieć */ }
  }
  async function fetchMaps({ query, cat, sort, page, authorId, status }) {
    let req = sb.from('maps').select(MAP_SELECT, { count: 'exact' });
    req = req.eq('status', status || 'approved');
    if (authorId) req = req.eq('author_id', authorId);
    if (cat) req = req.eq('category', cat);
    if (query) { const s = query.replace(/[,()%*\\.:"']/g, ' ').trim(); if (s) req = req.or(`name.ilike.%${s}%,description.ilike.%${s}%`); }
    if (sort === 'likes') req = req.order('like_count', { ascending: false }).order('created_at', { ascending: false });
    else if (sort === 'downloads') req = req.order('downloads', { ascending: false }).order('created_at', { ascending: false });
    else req = req.order('created_at', { ascending: false });
    const from = ((page || 1) - 1) * PER;
    const { data, count } = await q(req.range(from, from + PER - 1));
    const liked = await likedSet(data.map((x) => x.id));
    return { items: data.map((x) => norm(x, liked)), total: count || 0, pages: Math.max(1, Math.ceil((count || 0) / PER)) };
  }

  // ---------- nawigacja ----------
  function renderNav() {
    clear(nav);
    nav.append(h('a', { class: 'btn small gray', href: '#/' }, 'Mapy'));
    if (me) {
      nav.append(h('a', { class: 'btn small', href: '#/add' }, '+ Dodaj mapę'));
      if (me.role === 'admin') nav.append(h('a', { class: 'btn small blue', href: '#/admin' }, 'Panel admina'));
      nav.append(h('a', { class: 'btn small gray', href: '#/my' }, 'Moje mapy'));
      nav.append(h('a', { class: 'btn small gray', href: '#/profile' }, me.username));
    } else {
      nav.append(h('a', { class: 'btn small gray', href: '#/login' }, 'Zaloguj'));
      nav.append(h('a', { class: 'btn small', href: '#/register' }, 'Rejestracja'));
    }
    renderBanner();
  }
  function renderBanner() {
    const box = document.getElementById('banner');
    if (!box) return;
    clear(box);
    if (me && me.ban) {
      const forever = new Date(me.ban.until).getFullYear() >= 9000;
      box.append(h('div', { class: 'err' }, 'Twoje konto jest zablokowane ' + (forever ? 'na stałe' : 'do ' + fmtDateTime(me.ban.until)) + '.' + (me.ban.reason ? ' Powód: ' + me.ban.reason + '.' : '') + ' W tym czasie nie możesz dodawać map ani ich lubić.'));
    }
  }

  // ---------- komponenty ----------
  function mapCard(m) {
    return h('a', { class: 'card', href: '#/map/' + m.id },
      h('img', { class: 'thumb', src: m.image || thumbUrl(m.id + m.name), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      h('div', { class: 'body' },
        h('span', { class: 'tag' }, m.category),
        h('h3', {}, m.name),
        h('p', {}, m.description),
        h('div', { class: 'meta' }, h('span', {}, '♥ ', h('b', {}, m.likes)), h('span', {}, '⬇ ', h('b', {}, m.downloads)), m.version ? h('span', {}, m.version) : null),
        m.author ? h('div', { class: 'who' }, avatar(m.author.avatar, true), m.author.username) : null,
        m.status !== 'approved' ? h('span', { class: 'tag ' + m.status }, STATUS[m.status]) : null));
  }
  function field(label, input, hint) { return h('div', { class: 'field' }, h('label', { class: 'l' }, label), input, hint ? h('div', { class: 'hint' }, hint) : null); }
  function errBox() { return h('div', { class: 'err', hidden: true }); }
  function showErr(box, msg) { box.textContent = msg; box.hidden = false; }
  async function guard(btn, box, fn) {
    btn.setAttribute('disabled', ''); box.hidden = true;
    try { await fn(); } catch (e) { showErr(box, niceError(e)); } finally { btn.removeAttribute('disabled'); }
  }
  function needLogin() { toast('Zaloguj się, aby to zrobić', true); go('/login'); }
  const loadingBox = () => h('div', { class: 'panel empty' }, 'Ładowanie...');

  // ---------- strony ----------
  async function pageHome() {
    const list = h('div'); const pager = h('div', { class: 'pager' });
    const search = h('input', { type: 'search', placeholder: 'Szukaj map...', value: home.q, maxlength: '60' });
    const sort = h('select', { 'aria-label': 'Sortowanie', onchange: (e) => { home.sort = e.target.value; home.page = 1; load(); } },
      ...[['new', 'Najnowsze'], ['likes', 'Najpopularniejsze (♥)'], ['downloads', 'Najczęściej pobierane']].map(([v, t]) => h('option', { value: v, selected: home.sort === v }, t)));
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { home.q = search.value.trim(); home.page = 1; load(); }, 300); });
    const chips = h('div', { class: 'chips' });
    function drawChips() {
      clear(chips);
      [['', 'Wszystkie'], ...CATEGORIES.map((c) => [c, c])].forEach(([v, t]) => chips.append(h('button', { class: 'chip' + (home.cat === v ? ' on' : ''), onclick: () => { home.cat = v; home.page = 1; drawChips(); load(); } }, t)));
    }
    drawChips();
    mount(
      h('section', { class: 'hero' }, h('h1', {}, 'Mapy do Minecraft'), h('p', {}, 'Pobieraj za darmo. Zaloguj się i dodaj własną mapę.'),
        me ? h('a', { class: 'btn', href: '#/add' }, '+ Dodaj mapę') : h('a', { class: 'btn', href: '#/register' }, 'Załóż konto')),
      eventBanner(),
      h('div', { class: 'tools' }, search, sort), chips, list, pager);
    async function load() {
      try {
        const d = await fetchMaps({ query: home.q, cat: home.cat, sort: home.sort, page: home.page });
        clear(list); clear(pager);
        if (!d.items.length) list.append(h('div', { class: 'panel empty' }, 'Brak map. Bądź pierwszy i dodaj swoją!'));
        else list.append(h('div', { class: 'grid' }, d.items.map(mapCard)));
        if (d.pages > 1) {
          pager.append(h('button', { class: 'btn small gray', disabled: home.page <= 1, onclick: () => { home.page--; load(); } }, '‹'), h('span', {}, `Strona ${home.page} / ${d.pages}`),
            h('button', { class: 'btn small gray', disabled: home.page >= d.pages, onclick: () => { home.page++; load(); } }, '›'));
        }
      } catch (e) { clear(list); list.append(h('div', { class: 'err' }, niceError(e))); }
    }
    load();
  }

  async function pageMap(id) {
    mount(loadingBox());
    let m;
    try {
      const { data } = await q(sb.from('maps').select(MAP_SELECT).eq('id', id).maybeSingle());
      if (!data) return mount(h('div', { class: 'panel empty' }, 'Nie znaleziono mapy.'));
      m = norm(data, await likedSet([data.id]));
    } catch (e) { return mount(h('div', { class: 'err' }, niceError(e))); }
    const likeBtn = h('button', { class: 'btn' }, '');
    const setLike = () => { likeBtn.textContent = (m.liked ? '♥ Polubiono' : '♡ Lubię') + ' (' + m.likes + ')'; likeBtn.className = 'btn' + (m.liked ? ' liked' : ''); };
    setLike();
    likeBtn.addEventListener('click', async () => {
      if (!me) return needLogin();
      if (me.ban) return toast('Twoje konto jest zablokowane', true);
      try {
        if (m.liked) { await q(sb.from('likes').delete().eq('map_id', m.id).eq('user_id', me.id)); m.liked = false; m.likes = Math.max(0, m.likes - 1); }
        else { await q(sb.from('likes').insert({ map_id: m.id, user_id: me.id })); m.liked = true; m.likes++; }
        setLike();
      } catch (e) { toast(niceError(e), true); }
    });
    const canDel = me && (me.role === 'admin' || (m.author && me.id === m.author.id));
    const href = safeUrl(m.link);
    const actions = h('div', { class: 'actions' },
      href ? h('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer', onclick: () => { if (m.status === 'approved') sb.rpc('register_download', { p_id: m.id }); } }, '⬇ Pobierz mapę') : null,
      m.status === 'approved' ? likeBtn : null,
      canDel ? h('button', { class: 'btn red', onclick: async () => { if (!confirm('Usunąć tę mapę?')) return; try { await q(sb.from('maps').delete().eq('id', m.id)); toast('Mapa usunięta'); go('/'); } catch (e) { toast(niceError(e), true); } } }, 'Usuń') : null);
    const adminBox = me && me.role === 'admin' && m.status !== 'approved' ? h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => setStatus(m.id, 'approved', () => pageMap(id)) }, 'Akceptuj'),
      m.status !== 'rejected' ? h('button', { class: 'btn red', onclick: () => setStatus(m.id, 'rejected', () => pageMap(id)) }, 'Odrzuć') : null) : null;
    mount(h('div', { class: 'detail' },
      h('div', {},
        h('img', { class: 'thumb', src: m.image || thumbUrl(m.id + m.name), alt: '', referrerpolicy: 'no-referrer' }),
        h('h1', {}, m.name),
        m.status !== 'approved' ? h('p', {}, h('span', { class: 'tag ' + m.status }, STATUS[m.status])) : null,
        h('div', { class: 'panel' }, h('div', { class: 'desc' }, m.description)), actions, adminBox),
      h('aside', { class: 'panel' },
        h('h3', {}, 'Informacje'),
        h('div', { class: 'stat' }, h('span', {}, 'Kategoria'), h('span', {}, m.category)),
        m.version ? h('div', { class: 'stat' }, h('span', {}, 'Wersja'), h('span', {}, m.version)) : null,
        h('div', { class: 'stat' }, h('span', {}, 'Polubienia'), h('span', {}, m.likes)),
        h('div', { class: 'stat' }, h('span', {}, 'Pobrania'), h('span', {}, m.downloads)),
        h('div', { class: 'stat' }, h('span', {}, 'Dodano'), h('span', {}, fmtDate(m.createdAt))),
        m.author ? h('div', { class: 'stat' }, h('span', {}, 'Autor'), h('a', { class: 'who', href: '#/user/' + m.author.username }, avatar(m.author.avatar, true), m.author.username)) : null)));
  }
  async function setStatus(id, status, after) {
    try { await q(sb.rpc('set_map_status', { p_id: id, p_status: status })); toast(status === 'approved' ? 'Mapa zaakceptowana' : 'Mapa odrzucona'); after(); } catch (e) { toast(niceError(e), true); }
  }

  function authForm(register) {
    const err = errBox();
    const username = h('input', { type: 'text', maxlength: '20', autocomplete: 'username', required: true });
    const email = h('input', { type: 'email', maxlength: '120', autocomplete: 'email', required: true });
    const pw = h('input', { type: 'password', maxlength: '100', autocomplete: register ? 'new-password' : 'current-password', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, register ? 'Zarejestruj się' : 'Zaloguj się');
    const form = h('form', { class: 'panel form' },
      h('h1', {}, register ? 'Rejestracja' : 'Logowanie'), err,
      register ? field('Nazwa użytkownika', username, '3-20 znaków: litery, cyfry, _') : null,
      field('Email', email), field('Hasło', pw, register ? 'Minimum 6 znaków' : null), btn,
      h('p', {}, register ? 'Masz już konto? ' : 'Nie masz konta? ', h('a', { href: register ? '#/login' : '#/register' }, register ? 'Zaloguj się' : 'Zarejestruj się')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(btn, err, async () => {
        const mail = email.value.trim().toLowerCase();
        if (register) {
          const un = username.value.trim();
          if (!USERNAME_RE.test(un)) throw new Error('Nazwa: 3-20 znaków (litery, cyfry, _)');
          if (pw.value.length < 6) throw new Error('Hasło: minimum 6 znaków');
          const { data: taken } = await q(sb.from('profiles').select('id').ilike('username', un.replace(/_/g, '\\_')).limit(1));
          if (taken.length) throw new Error('Ta nazwa użytkownika jest już zajęta');
          const { data } = await q(sb.auth.signUp({ email: mail, password: pw.value, options: { data: { username: un } } }));
          if (!data.session) { toast('Konto założone! Potwierdź email (sprawdź skrzynkę), potem się zaloguj.'); return go('/login'); }
          await loadProfile(data.user);
        } else {
          const { data } = await q(sb.auth.signInWithPassword({ email: mail, password: pw.value }));
          await loadProfile(data.user);
        }
        renderNav(); toast('Witaj, ' + me.username + '!'); go('/');
      });
    });
    mount(form);
  }

  function pageAdd() {
    if (!me) return needLogin();
    if (me.ban) return mount(h('div', { class: 'err' }, 'Twoje konto jest zablokowane, więc nie możesz teraz dodawać map.'));
    const err = errBox();
    const name = h('input', { type: 'text', maxlength: '60', required: true });
    const desc = h('textarea', { maxlength: '2000', required: true });
    const link = h('input', { type: 'url', maxlength: '500', placeholder: 'https://...', required: true });
    const cat = h('select', {}, ...CATEGORIES.map((c) => h('option', { value: c }, c)));
    const ver = h('input', { type: 'text', maxlength: '20', placeholder: 'np. 1.21' });
    const img = h('input', { type: 'url', maxlength: '500', placeholder: 'https://... (opcjonalnie)' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Wrzuć mapę');
    const form = h('form', { class: 'panel form wide' }, h('h1', {}, 'Dodaj mapę'),
      me.role === 'admin' ? h('p', {}, 'Jako admin – Twoje mapy publikują się od razu.') : h('p', {}, 'Mapa pojawi się na stronie po akceptacji przez admina.'), err,
      field('Nazwa mapy', name), field('Opis', desc), field('Link do mapy', link, 'Link do pobrania (np. Google Drive, Mega, Mediafire)'),
      field('Kategoria', cat), field('Wersja Minecrafta', ver), field('Obrazek (link)', img, 'Bez obrazka zostanie wygenerowana pixelowa miniatura'), btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(btn, err, async () => {
        const n = name.value.trim(), d = desc.value.trim();
        if (n.length < 3) throw new Error('Nazwa mapy: minimum 3 znaki');
        if (d.length < 10) throw new Error('Opis: minimum 10 znaków');
        if (!safeUrl(link.value.trim())) throw new Error('Podaj poprawny link (http/https) do mapy');
        if (img.value.trim() && !safeUrl(img.value.trim())) throw new Error('Niepoprawny link do obrazka');
        const status = me.role === 'admin' ? 'approved' : 'pending';
        await q(sb.from('maps').insert({ author_id: me.id, name: n, description: d, link: link.value.trim(), image: img.value.trim(), category: cat.value, version: ver.value.trim(), status }));
        toast(status === 'approved' ? 'Mapa opublikowana!' : 'Mapa wysłana – czeka na akceptację admina'); go('/my');
      });
    });
    mount(form);
  }

  async function pageMy() {
    if (!me) return needLogin();
    mount(loadingBox());
    try {
      const { data } = await q(sb.from('maps').select(MAP_SELECT).eq('author_id', me.id).order('created_at', { ascending: false }));
      const items = data.map((x) => norm(x));
      mount(h('h1', {}, 'Moje mapy'), items.length ? h('div', { class: 'grid' }, items.map(mapCard)) : h('div', { class: 'panel empty' }, 'Nie dodałeś jeszcze żadnej mapy. ', h('a', { href: '#/add' }, 'Dodaj pierwszą')));
    } catch (e) { mount(h('div', { class: 'err' }, niceError(e))); }
  }

  function pageProfile() {
    if (!me) return needLogin();
    const err = errBox();
    let av = me.avatar || 0;
    const username = h('input', { type: 'text', maxlength: '20', value: me.username });
    const bio = h('textarea', { maxlength: '300' }); bio.value = me.bio || '';
    const cur = h('input', { type: 'password', autocomplete: 'current-password', maxlength: '100' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '100' });
    const avBox = h('div', { class: 'avatars' });
    const drawAv = () => { clear(avBox); for (let i = 0; i < 12; i++) avBox.append(h('button', { type: 'button', class: av === i ? 'on' : '', 'aria-label': 'Avatar ' + (i + 1), onclick: () => { av = i; drawAv(); } }, h('img', { src: avatarUrl(i), alt: '' }))); };
    drawAv();
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Zapisz profil');
    const form = h('form', { class: 'panel form wide' }, h('h1', {}, 'Mój profil'), err,
      h('p', {}, 'Email: ', me.email, me.role === 'admin' ? ' (admin)' : ''),
      field('Nazwa użytkownika', username), field('O mnie', bio), field('Avatar', avBox),
      h('h2', {}, 'Zmiana hasła'), field('Obecne hasło', cur, 'Zostaw puste, jeśli nie zmieniasz hasła'), field('Nowe hasło', nw), btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(btn, err, async () => {
        const un = username.value.trim();
        if (!USERNAME_RE.test(un)) throw new Error('Nazwa: 3-20 znaków (litery, cyfry, _)');
        if (nw.value) {
          if (nw.value.length < 6) throw new Error('Nowe hasło: minimum 6 znaków');
          await q(sb.auth.signInWithPassword({ email: me.email, password: cur.value })).catch(() => { throw new Error('Obecne hasło jest nieprawidłowe'); });
          await q(sb.auth.updateUser({ password: nw.value }));
        }
        await q(sb.from('profiles').update({ username: un, bio: bio.value.trim().slice(0, 300), avatar: av }).eq('id', me.id));
        me.username = un; me.bio = bio.value.trim(); me.avatar = av; cur.value = ''; nw.value = ''; renderNav(); toast('Profil zapisany');
      });
    });
    const out = h('button', { class: 'btn red', onclick: async () => { await sb.auth.signOut(); me = null; renderNav(); go('/'); toast('Wylogowano'); } }, 'Wyloguj');
    mount(form, h('div', { class: 'form wide actions' }, h('a', { class: 'btn gray', href: '#/user/' + me.username }, 'Mój publiczny profil'), out));
  }

  async function pageUser(name) {
    mount(loadingBox());
    try {
      const { data: u } = await q(sb.from('profiles').select('*').eq('username', name).maybeSingle());
      if (!u) return mount(h('div', { class: 'panel empty' }, 'Nie znaleziono użytkownika.'));
      const { data } = await q(sb.from('maps').select(MAP_SELECT).eq('author_id', u.id).eq('status', 'approved').order('created_at', { ascending: false }));
      const liked = await likedSet(data.map((x) => x.id));
      const maps = data.map((x) => norm(x, liked));
      const likes = maps.reduce((s, x) => s + x.likes, 0), dl = maps.reduce((s, x) => s + x.downloads, 0);
      mount(h('div', { class: 'panel row' }, avatar(u.avatar), h('div', {}, h('h1', {}, u.username, u.role === 'admin' ? ' ★' : ''), h('div', {}, u.bio || 'Brak opisu.'),
        h('div', { class: 'meta' }, h('span', {}, 'Mapy: ', h('b', {}, maps.length)), h('span', {}, '♥ ', h('b', {}, likes)), h('span', {}, '⬇ ', h('b', {}, dl)), h('span', {}, 'Od ', fmtDate(u.created_at))))),
        h('h2', {}, 'Mapy użytkownika'), maps.length ? h('div', { class: 'grid' }, maps.map(mapCard)) : h('div', { class: 'panel empty' }, 'Brak opublikowanych map.'));
    } catch (e) { mount(h('div', { class: 'err' }, niceError(e))); }
  }

  // ----- admin: konta i bany -----
  async function adminUsers(body, load) {
    const { data } = await q(sb.rpc('admin_list_users'));
    const rows = data.map((u) => {
      const banned = u.banned_until && new Date(u.banned_until) > new Date();
      const forever = banned && new Date(u.banned_until).getFullYear() >= 9000;
      const days = h('select', { 'aria-label': 'Czas bana' }, ...[[1, '1 dzień'], [3, '3 dni'], [7, '7 dni'], [30, '30 dni'], [-1, 'Na stałe']].map(([v, t]) => h('option', { value: v, selected: v === 3 }, t)));
      async function doBan(d, reason) {
        try { await q(sb.rpc('set_ban', { p_user: u.id, p_days: d, p_reason: reason })); toast(d === 0 ? 'Odbanowano ' + u.username : 'Zbanowano ' + u.username); load(); } catch (e) { toast(niceError(e), true); }
      }
      return h('tr', {},
        h('td', {}, h('a', { href: '#/user/' + u.username }, u.username)),
        h('td', {}, u.email), h('td', {}, u.role), h('td', {}, u.maps_count),
        h('td', {}, u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : '–'),
        h('td', {}, banned ? h('span', { class: 'banned' }, 'BAN ' + (forever ? 'na stałe' : 'do ' + fmtDateTime(u.banned_until)) + (u.ban_reason ? ' (' + u.ban_reason + ')' : '')) : 'Aktywne'),
        h('td', {}, u.role === 'admin' ? '–' : h('div', { class: 'adminrow' },
          banned ? h('button', { class: 'btn small', onclick: () => doBan(0, '') }, 'Odbanuj')
            : [days, h('button', { class: 'btn small red', onclick: () => { const reason = prompt('Powód bana (opcjonalnie):', ''); if (reason === null) return; doBan(Number(days.value), reason); } }, 'Zbanuj')])));
    });
    body.append(h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ...['Nazwa', 'Email', 'Rola', 'Mapy', 'Ostatnie logowanie', 'Status', 'Akcje'].map((x) => h('th', {}, x))), rows)));
  }

  // ----- admin: eventy -----
  async function adminEvents(body, load) {
    const err = errBox();
    const name = h('input', { type: 'text', maxlength: '60', placeholder: 'np. EVENT 2026', required: true });
    const theme = h('select', {}, ...Object.entries(THEMES).map(([v, t]) => h('option', { value: v }, t)));
    const desc = h('input', { type: 'text', maxlength: '300', placeholder: 'Krótki opis (opcjonalnie)' });
    const days = h('input', { type: 'number', min: '1', max: '365', value: '7' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Uruchom event');
    const form = h('form', { class: 'panel' }, h('h3', {}, 'Nowy event'), err,
      field('Nazwa', name), field('Wygląd strony', theme, 'The End zmienia całą stronę na fioletowo-czarną'),
      field('Opis', desc), field('Ile dni trwa', days, 'Uruchomienie nowego eventu zatrzymuje poprzedni'), btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(btn, err, async () => {
        await q(sb.rpc('admin_save_event', { p_name: name.value, p_theme: theme.value, p_description: desc.value, p_days: Number(days.value) }));
        await loadEvent(); toast('Event uruchomiony!'); load();
      });
    });
    const { data } = await q(sb.from('events').select('*').order('created_at', { ascending: false }));
    async function act(fn) { try { await fn(); await loadEvent(); load(); } catch (e) { toast(niceError(e), true); } }
    const rows = data.map((ev) => {
      const ended = new Date(ev.ends_at) <= new Date();
      const cd = h('span', { class: 'countdown' });
      countdown(cd, ev.ends_at);
      return h('tr', {},
        h('td', {}, h('b', {}, ev.name), h('div', { class: 'hint' }, THEMES[ev.theme] || ev.theme)),
        h('td', {}, ev.active ? (ended ? 'Zakończony (pokazuje zwycięzcę)' : 'TRWA') : 'Zatrzymany'),
        h('td', {}, cd, h('div', { class: 'hint' }, 'koniec: ' + fmtDateTime(ev.ends_at))),
        h('td', {}, h('div', { class: 'adminrow' },
          ev.active ? h('button', { class: 'btn small gray', onclick: () => act(() => q(sb.rpc('admin_set_event_active', { p_id: ev.id, p_active: false }))) }, 'Zatrzymaj')
            : h('button', { class: 'btn small', onclick: () => act(() => q(sb.rpc('admin_set_event_active', { p_id: ev.id, p_active: true }))) }, 'Wznów'),
          h('button', { class: 'btn small red', onclick: () => { if (confirm('Usunąć event "' + ev.name + '"?')) act(() => q(sb.rpc('admin_delete_event', { p_id: ev.id }))); } }, 'Usuń'))));
    });
    body.append(form, h('h2', {}, 'Eventy'),
      data.length ? h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ...['Event', 'Status', 'Odliczanie', 'Akcje'].map((x) => h('th', {}, x))), rows))
        : h('div', { class: 'panel empty' }, 'Brak eventów. Utwórz pierwszy powyżej.'));
    const top = await fetchTop(3);
    if (top.length) body.append(h('h2', {}, 'Ranking map (pobrania + polubienia)'), h('div', { class: 'grid' }, top.map((m, i) => h('div', {}, h('div', { class: 'rank' }, '#' + (i + 1)), mapCard(m)))));
  }

  async function pageAdmin(tab = 'pending') {
    if (!me || me.role !== 'admin') return mount(h('div', { class: 'panel empty' }, 'Brak dostępu.'));
    const body = h('div');
    const tabs = h('div', { class: 'tabs' });
    const defs = [['pending', 'Do akceptacji'], ['approved', 'Zaakceptowane'], ['rejected', 'Odrzucone'], ['all', 'Wszystkie mapy'], ['users', 'Konta i bany'], ['events', 'Eventy']];
    async function count(st) { const r = await q(sb.from('maps').select('id', { count: 'exact', head: true }).eq('status', st)); return r.count || 0; }
    async function load() {
      clear(tabs); clear(body);
      try {
        const drawTabs = (cnt) => defs.forEach(([k, t]) => tabs.append(h('button', { class: 'chip' + (tab === k ? ' on' : ''), onclick: () => { tab = k; load(); } }, t + (cnt && cnt[k] !== undefined ? ' (' + cnt[k] + ')' : ''))));
        if (tab === 'users') { drawTabs(); return await adminUsers(body, load); }
        if (tab === 'events') { drawTabs(); return await adminEvents(body, load); }
        let req = sb.from('maps').select(MAP_SELECT).order('created_at', { ascending: false }).limit(200);
        if (tab !== 'all') req = req.eq('status', tab);
        const [{ data }, p, a, r] = await Promise.all([q(req), count('pending'), count('approved'), count('rejected')]);
        drawTabs({ pending: p, approved: a, rejected: r, all: p + a + r });
        if (!data.length) return body.append(h('div', { class: 'panel empty' }, 'Brak map w tej zakładce.'));
        body.append(h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ...['Mapa', 'Autor', 'Kategoria', 'Status', 'Akcje'].map((x) => h('th', {}, x))),
          data.map((m) => h('tr', {},
            h('td', {}, h('a', { href: '#/map/' + m.id }, m.name), h('div', { class: 'hint' }, fmtDate(m.created_at))),
            h('td', {}, m.author ? m.author.username : '?'), h('td', {}, m.category), h('td', {}, h('span', { class: 'tag ' + m.status }, STATUS[m.status])),
            h('td', {}, h('div', { class: 'adminrow' },
              safeUrl(m.link) ? h('a', { class: 'btn small blue', href: safeUrl(m.link), target: '_blank', rel: 'noopener noreferrer' }, 'Pobierz') : null,
              m.status !== 'approved' ? h('button', { class: 'btn small', onclick: () => setStatus(m.id, 'approved', load) }, 'Akceptuj') : null,
              m.status !== 'rejected' ? h('button', { class: 'btn small gray', onclick: () => setStatus(m.id, 'rejected', load) }, 'Odrzuć') : null,
              h('button', { class: 'btn small red', onclick: async () => { if (!confirm('Usunąć mapę "' + m.name + '"?')) return; try { await q(sb.from('maps').delete().eq('id', m.id)); toast('Usunięto'); load(); } catch (e) { toast(niceError(e), true); } } }, 'Usuń'))))))));
      } catch (e) { body.append(h('div', { class: 'err' }, niceError(e))); }
    }
    mount(h('h1', {}, 'Panel admina'), tabs, body);
    load();
  }

  // ---------- router ----------
  function route() {
    const path = location.hash.replace(/^#/, '') || '/';
    let m;
    if (path === '/') return pageHome();
    if (path === '/login') return me ? go('/') : authForm(false);
    if (path === '/register') return me ? go('/') : authForm(true);
    if (path === '/add') return pageAdd();
    if (path === '/my') return pageMy();
    if (path === '/profile') return pageProfile();
    if (path === '/admin') return pageAdmin();
    if ((m = path.match(/^\/map\/(\d+)$/))) return pageMap(Number(m[1]));
    if ((m = path.match(/^\/user\/([A-Za-z0-9_]+)$/))) return pageUser(m[1]);
    mount(h('div', { class: 'panel empty' }, 'Nie ma takiej strony. ', h('a', { href: '#/' }, 'Wróć do map')));
  }

  function setupMissing(msg) {
    renderNav();
    mount(h('div', { class: 'panel' }, h('h1', {}, 'Dokończ konfigurację'), h('p', {}, msg), h('p', {}, 'Instrukcja krok po kroku jest w pliku README.md.')));
  }

  window.addEventListener('hashchange', route);
  (async function init() {
    if (!window.supabase) return setupMissing('Nie udało się załadować biblioteki Supabase (sprawdź internet).');
    if (!/^https:\/\/.+\.supabase\.co/.test(CFG.SUPABASE_URL || '') || /TWOJ-PROJEKT/.test(CFG.SUPABASE_URL) || !CFG.SUPABASE_ANON_KEY || /WKLEJ/.test(CFG.SUPABASE_ANON_KEY)) {
      return setupMissing('Uzupełnij plik config.js adresem projektu Supabase i kluczem "anon public".');
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) await loadProfile(data.session.user);
    } catch (e) { me = null; }
    await loadEvent();
    renderNav(); route();
  })();
})();
