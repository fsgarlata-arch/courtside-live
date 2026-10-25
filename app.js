(() => {
  const $app = document.getElementById('app');
  const cfg = window.COURTSIDE_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/TUO-PROGETTO|TUA-CHIAVE/.test(cfg.supabaseUrl + cfg.supabaseAnonKey) && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

  const S = {
    ready: false, user: null, canEdit: false, isOwner: false,
    teamRow: null, team: null, games: [], editors: [], teamsList: null,
    route: { view: 'home' }, sel: { home: null, away: null }, confirm: null,
    login: { step: 'email', email: '' }, online: false,
  };
  const BALL = `<svg class="ball" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="var(--accent)"/><g fill="none" stroke="var(--navy)" stroke-width="2.4"><circle cx="32" cy="32" r="30"/><path d="M2 32h60M32 2v60"/><path d="M11 10c8 7 12 14 12 22s-4 15-12 22"/><path d="M53 10c-8 7-12 14-12 22s4 15 12 22"/></g></svg>`;
  const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`;

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?';
  const logoHTML = (t, size) => `<span class="logo ${size}" style="--c:${esc(t?.color || '#e2591a')}">${t?.logo ? `<img alt="" src="${esc(t.logo)}">` : esc(initials(t?.name))}</span>`;
  const slugify = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const fmtDate = iso => {
    if (!iso) return 'Data da definire';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };
  const periodLabel = (q, n) => q <= n ? (n === 4 ? `${q}°Q` : `${q}°T`) : `OT${q - n > 1 ? q - n : ''}`;
  let toastT;
  const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); };
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

  // parse "12 Rossi Marco" lines
  const parseRoster = txt => (txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^#?(\d{1,2})[\s.\-–:]+(.+)$/) || l.match(/^(.+?)[\s,]+#?(\d{1,2})$/);
    if (m) return /^\d/.test(m[1]) ? { num: m[1], name: m[2].trim() } : { num: m[2], name: m[1].trim() };
    if (/^\d{1,2}$/.test(l)) return { num: l, name: '' };
    return { num: '', name: l };
  });
  const rosterText = r => (r || []).map(p => [p.num, p.name].filter(Boolean).join(' ')).join('\n');

  const baseUrl = () => location.origin + location.pathname;
  const teamUrl = () => S.teamRow ? `${baseUrl()}?squadra=${encodeURIComponent(S.teamRow.slug)}` : baseUrl();
  async function share(url, title) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Link copiato: incollalo nella chat dei genitori'); }
    catch { toast(url); }
  }

  // ---------- game math ----------
  function sides(g) {
    const us = { name: S.team?.name || 'Noi', logo: S.team?.logo || '', color: S.team?.color || '#e2591a' };
    const them = { name: g.opponent || 'Avversari', logo: g.oppLogo || '', color: g.oppColor || '#12204a' };
    return g.weAreHome !== false ? { home: us, away: them } : { home: them, away: us };
  }
  function score(g) {
    const ev = g.events || [];
    if (!ev.length && g.manual) return { home: +g.manual.home || 0, away: +g.manual.away || 0 };
    const s = { home: 0, away: 0 };
    for (const e of ev) if (e.k === 'pt') s[e.s] += e.p;
    return s;
  }
  function byPeriod(g) {
    const n = Math.max(g.periods || 4, g.q || 1, ...(g.events || []).map(e => e.q));
    const rows = { home: Array(n).fill(0), away: Array(n).fill(0) };
    for (const e of g.events || []) if (e.k === 'pt') rows[e.s][e.q - 1] += e.p;
    return { n, rows };
  }
  const foulsIn = (g, side, q) => (g.events || []).filter(e => e.k === 'f' && e.s === side && e.q === q).length;
  function outcome(g) {
    if (g.status !== 'final') return null;
    const s = score(g), usKey = g.weAreHome !== false ? 'home' : 'away', themKey = usKey === 'home' ? 'away' : 'home';
    return s[usKey] > s[themKey] ? 'w' : s[usKey] < s[themKey] ? 'l' : 'd';
  }
  const rosterOf = (g, side) => side === (g.weAreHome !== false ? 'home' : 'away') ? (g.ourRoster || S.team?.roster || []) : (g.oppRoster || []);

  // ---------- data ----------
  const rowToGame = r => ({ ...(r.data || {}), id: r.id });
  const writing = new Map(); // per-row serialized writes
  const pendingIds = () => new Set([...writing].filter(([, w]) => w.busy || w.next).map(([id]) => id));

  function saveGame(g) {
    if (!sb || !S.teamRow) return;
    const id = g.id;
    const w = writing.get(id) || { busy: false, next: null };
    writing.set(id, w);
    const { id: _, ...body } = g;
    w.next = JSON.parse(JSON.stringify(body));
    if (w.busy) return;
    (async function pump() {
      w.busy = true;
      while (w.next) {
        const data = w.next; w.next = null;
        const { error } = await sb.from('games').upsert({ id, team_id: S.teamRow.id, data, updated_at: new Date().toISOString() });
        if (error) { handleWriteError(error); w.next = null; }
      }
      w.busy = false;
    })();
  }
  function handleWriteError(e) {
    console.warn(e);
    if (e?.code === '42501' || /row-level security|permission/i.test(e?.message || '')) {
      S.canEdit = false; toast('Non hai i permessi per modificare questa squadra.'); render();
    } else toast('Salvataggio non riuscito: controlla la connessione e riprova.');
  }
  async function loadGames() {
    if (!S.teamRow) return;
    const { data, error } = await sb.from('games').select('id,data').eq('team_id', S.teamRow.id);
    if (error) return console.warn(error);
    const mine = pendingIds();
    S.games = data.map(r => mine.has(r.id) && gameById(r.id) ? gameById(r.id) : rowToGame(r));
  }
  async function loadTeamRow(where) {
    const q = sb.from('teams').select('id,slug,owner,data');
    const { data, error } = await (where.slug ? q.eq('slug', where.slug) : q.eq('id', where.id)).maybeSingle();
    if (error) console.warn(error);
    return data || null;
  }
  async function resolveTeam() {
    const qs = new URLSearchParams(location.search);
    const slug = qs.get('squadra') || store.get('slug');
    if (slug) { const t = await loadTeamRow({ slug }); if (t) return t; }
    if (S.user) {
      const { data } = await sb.from('teams').select('id,slug,owner,data').eq('owner', S.user.id).limit(1);
      if (data?.length) return data[0];
    }
    const { data } = await sb.from('teams').select('id,slug,owner,data').order('slug').limit(50);
    S.teamsList = data || [];
    return S.teamsList.length === 1 ? S.teamsList[0] : null;
  }
  async function setTeam(row) {
    S.teamRow = row; S.team = row?.data || null;
    if (!row) return;
    store.set('slug', row.slug);
    const qs = new URLSearchParams(location.search);
    if (qs.get('squadra') !== row.slug) { qs.set('squadra', row.slug); try { history.replaceState(null, '', `${location.pathname}?${qs}${location.hash}`); } catch {} }
    await Promise.all([loadGames(), refreshPerms()]);
    subscribe();
  }
  async function refreshPerms() {
    S.canEdit = false; S.isOwner = false; S.editors = [];
    if (!S.user || !S.teamRow) return;
    S.isOwner = S.teamRow.owner === S.user.id;
    const { data } = await sb.rpc('can_edit_team', { t: S.teamRow.id });
    S.canEdit = !!data;
    if (S.isOwner) {
      const { data: eds } = await sb.from('team_editors').select('email').eq('team_id', S.teamRow.id).order('email');
      S.editors = (eds || []).map(r => r.email);
    }
  }

  // ---------- realtime ----------
  let channel = null;
  const refetchTimers = new Map();
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    const id = S.teamRow.id;
    channel = sb.channel('team-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'games', filter: 'team_id=eq.' + id }, p => onGameRow(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: 'team_id=eq.' + id }, p => onGameRow(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'games' }, p => {
        const gid = p.old?.id; if (!gid || !gameById(gid)) return;
        S.games = S.games.filter(g => g.id !== gid);
        if (S.route.view === 'game' && S.route.id === gid) go('home'); else softRender();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: 'id=eq.' + id }, async () => {
        const row = await loadTeamRow({ id }); if (row) { S.teamRow = row; S.team = row.data; softRender(); }
      })
      .subscribe(status => {
        const was = S.online;
        S.online = status === 'SUBSCRIBED';
        renderHeader();
        if (S.online && !was) loadGames().then(softRender); // catch up after a reconnect
      });
  }
  function onGameRow(row) {
    if (!row?.id || pendingIds().has(row.id)) return;
    // Large rows can arrive truncated over realtime: fetch the row when its data is missing.
    if (row.data && typeof row.data === 'object') return applyGame(rowToGame(row));
    clearTimeout(refetchTimers.get(row.id));
    refetchTimers.set(row.id, setTimeout(async () => {
      const { data } = await sb.from('games').select('id,data').eq('id', row.id).maybeSingle();
      if (data) applyGame(rowToGame(data));
    }, 150));
  }
  function applyGame(g) {
    const old = gameById(g.id), was = old ? score(old) : null;
    if (old) S.games[S.games.indexOf(old)] = g; else S.games.push(g);
    if (!softRender()) return;
    if (S.route.view === 'game' && S.route.id === g.id && was) {
      const s = score(g);
      for (const k of ['home', 'away']) if (s[k] !== was[k]) document.getElementById('dg-' + k)?.classList.add('flash');
    }
  }
  const isEditingForm = () => ['team', 'new', 'edit', 'login'].includes(S.route.view);
  function softRender() { if (!S.ready || isEditingForm()) return false; render(); return true; }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !S.teamRow) return;
    loadGames().then(softRender);
    if (wantWake) wake(true);
  });

  // ---------- routing ----------
  function go(view, id) {
    S.route = { view, id }; S.confirm = null; S.sel = { home: null, away: null };
    const tok = view === 'game' ? '#g-' + id : '';
    try { history.replaceState(null, '', location.pathname + location.search + tok); } catch {}
    render(); window.scrollTo({ top: 0 });
    wake(view === 'game' && S.canEdit && gameById(id)?.status === 'live');
  }
  const gameById = id => S.games.find(g => g.id === id);
  let wakeLock = null, wantWake = false;
  async function wake(on) {
    wantWake = on;
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => wakeLock = null); }
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { wakeLock = null; }
  }

  // ---------- install prompt ----------
  let installEvt = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; softRender(); });
  function installBanner() {
    if (standalone || store.get('installDismissed')) return '';
    if (installEvt) return `<div class="install">${BALL.replace('class="ball"', 'style="width:36px;height:36px;flex:none"')}<p>Installa l'app sul telefono per aprirla con un tocco.</p><button class="btn sm" data-install>Installa</button><button class="x" data-install-x aria-label="Chiudi">×</button></div>`;
    if (isIOS) return `<div class="install">${BALL.replace('class="ball"', 'style="width:36px;height:36px;flex:none"')}<p>Su iPhone: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</p><button class="x" data-install-x aria-label="Chiudi">×</button></div>`;
    return '';
  }

  // ---------- render ----------
  function renderHeader() {
    const t = S.team;
    document.getElementById('brandLogo').innerHTML = t ? logoHTML(t, 's') : `<span class="logo s" style="--c:var(--accent)">${BALL.replace('class="ball"', 'style="width:100%;height:100%"')}</span>`;
    document.getElementById('brandName').textContent = t?.name || 'Courtside Live';
    document.getElementById('brandSub').textContent = t?.category ? `${t.category} · risultati live` : 'Basket giovanile · risultati live';
    document.getElementById('teamBtn').hidden = !(S.canEdit || (S.user && !S.teamRow));
    document.getElementById('loginBtn').hidden = !sb || !!S.user;
    const c = document.getElementById('conn');
    c.hidden = !S.teamRow; c.classList.toggle('on', S.online);
    c.title = S.online ? 'Connesso: aggiornamenti in diretta' : 'Non connesso: riprovo…';
  }

  function render() {
    renderHeader();
    if (!S.ready) return;
    const r = S.route;
    if (!sb) { $app.innerHTML = viewConfig(); return; }
    if (r.view === 'login') { $app.innerHTML = viewLogin(); return; }
    if (r.view === 'team') { $app.innerHTML = viewTeam(); return; }
    if (!S.teamRow) { $app.innerHTML = viewPick(); return; }
    if (r.view === 'new') $app.innerHTML = viewGameForm(null);
    else if (r.view === 'edit') { const g = gameById(r.id); $app.innerHTML = g ? viewGameForm(g) : viewHome(); }
    else if (r.view === 'game') { const g = gameById(r.id); $app.innerHTML = g ? viewGame(g) : viewHome(); }
    else $app.innerHTML = viewHome();
  }

  function viewConfig() {
    return `<div class="empty">${BALL}<h3>Collega Supabase</h3><p>Apri <b>config.js</b> e inserisci l'URL del progetto e la chiave anon. Poi esegui <b>supabase/schema.sql</b> nel SQL Editor. Le istruzioni complete sono nel README.</p></div>`;
  }

  function viewPick() {
    const list = S.teamsList || [];
    return `
      <div class="empty">${BALL}<h3>${S.user ? 'Crea la tua squadra' : 'Scegli la squadra'}</h3>
        <p>${S.user ? 'Inserisci nome, logo e, se vuoi, il roster. Poi condividi il link con i genitori.' : "Apri il link che ti ha mandato l'allenatore, oppure scegli qui sotto."}</p>
        ${S.user ? `<button class="btn" data-go="team">Imposta squadra</button>` : ''}
      </div>
      ${list.length ? `<section class="stack"><h2 class="sec">Squadre</h2><div class="team-list">${list.map(t => `<button type="button" data-team="${esc(t.slug)}">${logoHTML(t.data, 'm')}<span>${esc(t.data?.name || t.slug)}<br><span class="hint">${esc(t.data?.category || '')}</span></span></button>`).join('')}</div></section>` : ''}
      ${installBanner()}`;
  }

  function viewLogin() {
    const L = S.login;
    if (S.user) {
      return `<button class="back" data-go="home">← Indietro</button>
        <section class="panel"><h3>Accesso segnapunti</h3><p style="margin:0">Hai effettuato l'accesso come <b>${esc(S.user.email)}</b>.</p>
        ${S.teamRow && !S.canEdit ? `<div class="notice">Questo account non può modificare <b>${esc(S.team?.name)}</b>. Chiedi al proprietario della squadra di aggiungerti tra i segnapunti.</div>` : ''}
        <div class="row end"><button class="btn ghost" data-logout>Esci</button></div></section>`;
    }
    const mode = L.mode || 'password';
    const emailField = `<div class="field"><label for="loginEmail">La tua email</label><input type="text" id="loginEmail" inputmode="email" autocomplete="email" autocapitalize="off" required value="${esc(L.email)}" placeholder="nome@esempio.it"></div>`;
    let body;
    if (mode === 'password') body = `
          ${emailField}
          <div class="field"><label for="loginPass">Password</label><input type="password" id="loginPass" autocomplete="current-password" minlength="8" required></div>
          <div class="row end"><button class="btn" type="submit" style="order:2">Entra</button><button type="submit" class="btn ghost" data-signup>Crea account</button></div>
          <span class="hint">Prima volta? Scegli una password di almeno 8 caratteri e tocca “Crea account”: riceverai un'email per confermare l'indirizzo, poi potrai entrare.</span>`;
    else if (L.step === 'email') body = `
          ${emailField}
          <div class="row end"><button class="btn" type="submit">Inviami il link</button></div>`;
    else body = `
          <p style="margin:0">Ti abbiamo mandato un'email a <b>${esc(L.email)}</b>. Apri il link <b>da questo stesso browser</b>. Se l'email contiene un codice, puoi scriverlo qui.</p>
          <div class="field"><label for="loginCode">Codice (facoltativo)</label><input type="text" id="loginCode" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></div>
          <div class="row end"><button type="button" class="btn ghost" data-login-back>Cambia email</button><button class="btn" type="submit">Entra</button></div>`;
    return `<button class="back" data-go="home">← Indietro</button>
      <form class="form panel" id="loginForm">
        <h3>Accesso segnapunti</h3>
        <p class="hint" style="margin:0">Serve solo a chi aggiorna il punteggio. I genitori seguono le partite senza accedere.</p>
        <div class="seg" role="group" aria-label="Metodo di accesso">
          <button type="button" data-login-mode="password" class="${mode === 'password' ? 'on' : ''}">Password</button>
          <button type="button" data-login-mode="link" class="${mode === 'link' ? 'on' : ''}">Link via email</button>
        </div>
        ${body}
      </form>`;
  }

  function gameCard(g) {
    const sd = sides(g), s = score(g), o = outcome(g);
    const hasScore = g.status !== 'scheduled' || g.manual;
    const pill = g.status === 'live' ? `<span class="pill live">Live · ${periodLabel(g.q || 1, g.periods || 4)}</span>`
      : o ? `<span class="pill ${o}">${o === 'w' ? 'Vinta' : o === 'l' ? 'Persa' : 'Pari'}</span>`
      : `<span class="pill sch">In programma</span>`;
    const lead = s.home === s.away ? '' : s.home > s.away ? 'home' : 'away';
    return `<button class="gcard" type="button" data-open="${esc(g.id)}">
      <span class="side">${logoHTML(sd.home, 'm')}<span class="tname">${esc(sd.home.name)}</span></span>
      <span class="center">${hasScore ? `<span class="sc"><span class="${lead === 'away' ? 'dim' : ''}">${s.home}</span><span class="dim">–</span><span class="${lead === 'home' ? 'dim' : ''}">${s.away}</span></span>` : `<span class="sc dim" style="font-size:20px">VS</span>`}${pill}</span>
      <span class="side r">${logoHTML(sd.away, 'm')}<span class="tname">${esc(sd.away.name)}</span></span>
      <span class="foot"><span>${esc(fmtDate(g.date))}</span><span>${esc([g.competition, g.venue].filter(Boolean).join(' · '))}</span></span>
    </button>`;
  }

  function viewHome() {
    const t = S.team || {};
    const sorted = [...S.games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const live = sorted.filter(g => g.status === 'live');
    const upcoming = sorted.filter(g => g.status === 'scheduled');
    const done = sorted.filter(g => g.status === 'final').reverse();
    const w = done.filter(g => outcome(g) === 'w').length, l = done.filter(g => outcome(g) === 'l').length;
    const pf = done.reduce((a, g) => a + score(g)[g.weAreHome !== false ? 'home' : 'away'], 0);
    const pa = done.reduce((a, g) => a + score(g)[g.weAreHome !== false ? 'away' : 'home'], 0);
    return `
      <section class="hero">
        ${logoHTML(t, 'xl')}
        <div style="min-width:0">
          <h1>${esc(t.name || S.teamRow.slug)}</h1>
          <div class="meta">${esc([t.category, t.season].filter(Boolean).join(' · ') || 'Basket giovanile')}</div>
          <div class="record">
            <div><b>${w}</b><span>Vinte</span></div>
            <div><b>${l}</b><span>Perse</span></div>
            <div><b>${done.length ? (pf / done.length).toFixed(1) : '–'}</b><span>Punti fatti/g</span></div>
            <div><b>${done.length ? (pa / done.length).toFixed(1) : '–'}</b><span>Subiti/g</span></div>
          </div>
          <button type="button" class="share-btn" data-share-team>${SHARE_ICON} Invita i genitori</button>
        </div>
      </section>
      ${installBanner()}
      ${S.canEdit ? `<div class="row"><button class="btn" data-go="new">+ Nuova partita</button></div>` : ''}
      ${live.length ? `<section class="stack"><h2 class="sec">In diretta</h2>${live.map(gameCard).join('')}</section>` : ''}
      <section class="stack"><h2 class="sec">Prossime partite</h2>${upcoming.length ? upcoming.map(gameCard).join('') : `<div class="notice">Nessuna partita in programma.${S.canEdit ? ' Usa “Nuova partita” per aggiungerne una.' : ''}</div>`}</section>
      <section class="stack"><h2 class="sec">Risultati</h2>${done.length ? done.map(gameCard).join('') : `<div class="notice">Ancora nessun risultato.</div>`}</section>`;
  }

  function viewTeam() {
    if (!S.user) { S.route = { view: 'login' }; return viewLogin(); }
    const isNew = !S.teamRow;
    const t = S.team || {};
    if (!isNew && !S.canEdit) return viewLogin();
    return `
      <button class="back" data-go="home">← Indietro</button>
      <form class="form panel" id="teamForm">
        <h3>${isNew ? 'Nuova squadra' : 'La tua squadra'}</h3>
        <div class="logo-pick">
          <span id="teamLogoPrev">${logoHTML({ name: t.name, logo: t.logo, color: t.color }, 'l')}</span>
          <div class="field"><label for="teamLogo">Logo</label><input type="file" id="teamLogo" accept="image/*"></div>
          <div class="field"><label for="teamColor">Colore</label><input type="color" id="teamColor" value="${esc(t.color || '#e2591a')}"></div>
          <div class="row" id="teamLogoActs" ${t.logo ? '' : 'hidden'}><button type="button" class="btn ghost sm" data-recrop="team">Ritaglia</button><button type="button" class="btn ghost sm" data-logo-clear="team">Rimuovi</button></div>
        </div>
        <div class="field"><label for="teamName">Nome squadra</label><input type="text" id="teamName" required value="${esc(t.name || '')}" placeholder="Es. Pallacanestro Varese U13"></div>
        ${isNew ? `<div class="field"><label for="teamSlug">Indirizzo della squadra</label><input type="text" id="teamSlug" required pattern="[a-z0-9\\-]{2,40}" autocapitalize="off" placeholder="es. varese-u13"><span class="hint">Finirà nel link per i genitori: ${esc(baseUrl())}?squadra=<b id="slugPrev">…</b>. Solo lettere minuscole, numeri e trattini.</span></div>` : ''}
        <div class="grid2">
          <div class="field"><label for="teamCat">Categoria</label><input type="text" id="teamCat" value="${esc(t.category || '')}" placeholder="Es. Under 13"></div>
          <div class="field"><label for="teamSeason">Stagione</label><input type="text" id="teamSeason" value="${esc(t.season || '')}" placeholder="Es. 2026/27"></div>
        </div>
        <div class="field"><label for="teamRoster">Roster (facoltativo)</label>
          <textarea id="teamRoster" placeholder="Un giocatore per riga: numero e nome&#10;4 Rossi Luca&#10;7 Bianchi Sara&#10;12 Verdi">${esc(rosterText(t.roster))}</textarea>
          <span class="hint">Verrà proposto in automatico in ogni nuova partita. Puoi lasciare solo i numeri o solo i nomi.</span>
        </div>
        <div class="row end"><button class="btn" type="submit">${isNew ? 'Crea squadra' : 'Salva squadra'}</button></div>
      </form>
      ${!isNew && S.isOwner ? `
      <section class="panel">
        <h3>Segnapunti</h3>
        <p class="hint" style="margin:0">Le persone in questo elenco possono aggiornare punteggi e partite dopo aver fatto l'accesso con la loro email.</p>
        <ul class="editors">${S.editors.map(e => `<li><span>${esc(e)}</span><button type="button" class="btn ghost sm" data-rm-editor="${esc(e)}">Rimuovi</button></li>`).join('') || '<li><span class="hint">Per ora solo tu.</span></li>'}</ul>
        <form class="row" id="editorForm"><div class="field" style="flex:1 1 200px"><label for="editorEmail">Aggiungi email</label><input type="text" id="editorEmail" inputmode="email" autocapitalize="off" placeholder="altro.genitore@esempio.it"></div><button class="btn sm" type="submit" style="align-self:end">Aggiungi</button></form>
      </section>` : ''}
      ${!isNew ? `<section class="panel"><h3>Link per i genitori</h3><p style="margin:0;overflow-wrap:anywhere"><b>${esc(teamUrl())}</b></p><div class="row"><button type="button" class="btn sm" data-share-team>${SHARE_ICON} Condividi</button><button type="button" class="btn ghost sm" data-logout>Esci (${esc(S.user.email)})</button></div></section>` : ''}`;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function viewGameForm(g) {
    const isNew = !g; g = g || { weAreHome: true, periods: 4 };
    const home = g.weAreHome !== false;
    const hasEvents = (g.events || []).length > 0;
    return `
      <button class="back" ${isNew ? 'data-go="home"' : `data-open="${esc(g.id)}"`}>← Indietro</button>
      <form class="form panel" id="gameForm" data-id="${esc(g.id || '')}">
        <h3>${isNew ? 'Nuova partita' : 'Modifica partita'}</h3>
        <div class="field"><span class="lbl">Giochiamo</span>
          <div class="seg" role="group" aria-label="Casa o trasferta">
            <button type="button" data-ha="1" class="${home ? 'on' : ''}">In casa</button>
            <button type="button" data-ha="0" class="${home ? '' : 'on'}">In trasferta</button>
          </div>
          <input type="hidden" id="gHome" value="${home ? 1 : 0}">
        </div>
        <div class="field"><label for="gOpp">Squadra avversaria</label><input type="text" id="gOpp" required value="${esc(g.opponent || '')}" placeholder="Es. Pallacanestro Rivoli"></div>
        <div class="logo-pick">
          <span id="oppLogoPrev">${logoHTML({ name: g.opponent, logo: g.oppLogo, color: g.oppColor || '#12204a' }, 'l')}</span>
          <div class="field"><label for="gOppLogo">Logo avversari (facoltativo)</label><input type="file" id="gOppLogo" accept="image/*"></div>
          <div class="field"><label for="gOppColor">Colore</label><input type="color" id="gOppColor" value="${esc(g.oppColor || '#12204a')}"></div>
          <div class="row" id="oppLogoActs" ${g.oppLogo ? '' : 'hidden'}><button type="button" class="btn ghost sm" data-recrop="opp">Ritaglia</button><button type="button" class="btn ghost sm" data-logo-clear="opp">Rimuovi</button></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="gDate">Data e ora</label><input type="datetime-local" id="gDate" value="${esc(toLocalInput(g.date))}"></div>
          <div class="field"><label for="gPeriods">Periodi</label>
            <select id="gPeriods">${[4, 6, 2].map(n => `<option value="${n}" ${+(g.periods || 4) === n ? 'selected' : ''}>${n === 4 ? '4 quarti' : n === 6 ? '6 tempi (minibasket)' : '2 tempi'}</option>`).join('')}</select>
          </div>
        </div>
        <div class="grid2">
          <div class="field"><label for="gComp">Campionato / torneo</label><input type="text" id="gComp" value="${esc(g.competition || '')}" placeholder="Es. Campionato U13 · 5ª giornata"></div>
          <div class="field"><label for="gVenue">Palestra</label><input type="text" id="gVenue" value="${esc(g.venue || '')}" placeholder="Es. PalaComunale, via Roma 3"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="gOurRoster">Formazione ${esc(S.team?.name || 'nostra')}</label>
            <textarea id="gOurRoster" placeholder="4 Rossi&#10;7 Bianchi">${esc(rosterText(g.ourRoster || (isNew ? S.team?.roster : [])))}</textarea></div>
          <div class="field"><label for="gOppRoster">Formazione avversari</label>
            <textarea id="gOppRoster" placeholder="Se li conosci: numero e nome&#10;5 Neri&#10;11">${esc(rosterText(g.oppRoster))}</textarea></div>
        </div>
        <span class="hint">Le formazioni sono facoltative: senza, il segnapunti registra solo i punti di squadra.</span>
        ${!hasEvents ? `
        <details ${g.manual ? 'open' : ''}>
          <summary class="lbl" style="cursor:pointer">Partita già giocata? Inserisci il risultato finale</summary>
          <div class="grid2" style="margin-top:10px">
            <div class="field"><label for="gManUs">Punti ${esc(S.team?.name || 'nostri')}</label><input type="number" min="0" id="gManUs" inputmode="numeric" value="${g.manual ? esc(home ? g.manual.home : g.manual.away) : ''}"></div>
            <div class="field"><label for="gManThem">Punti avversari</label><input type="number" min="0" id="gManThem" inputmode="numeric" value="${g.manual ? esc(home ? g.manual.away : g.manual.home) : ''}"></div>
          </div>
        </details>` : ''}
        <div class="row end">
          ${!isNew ? `<button type="button" class="btn danger" data-del="${esc(g.id)}">Elimina</button>` : ''}
          <button class="btn" type="submit">${isNew ? 'Crea partita' : 'Salva'}</button>
        </div>
        ${S.confirm === 'del' ? `<div class="confirm"><b>Eliminare questa partita?</b><span class="hint">Punteggio e cronaca verranno cancellati per tutti.</span><div class="row end"><button type="button" class="btn ghost sm" data-cancel>Annulla</button><button type="button" class="btn danger sm" data-del-yes="${esc(g.id)}">Sì, elimina</button></div></div>` : ''}
      </form>`;
  }

  function viewGame(g) {
    const sd = sides(g), s = score(g), n = g.periods || 4, q = g.q || 1;
    const { n: cols, rows } = byPeriod(g);
    const live = g.status === 'live', fin = g.status === 'final';
    const o = outcome(g);
    const bonus = side => foulsIn(g, side, q) >= 4;
    const status = live ? `<span class="pill live">Live</span>` : fin ? `<span class="pill ${o}">Finale</span>` : `<span class="pill sch">In programma</span>`;
    const hasEvents = (g.events || []).length > 0;
    const pcell = side => rows[side].map((v, i) => `<td class="${live && i === q - 1 ? 'cur' : ''}">${i < q || fin ? v : '–'}</td>`).join('');
    return `
      <div class="row" style="justify-content:space-between"><button class="back" data-go="home">← Tutte le partite</button><button type="button" class="btn ghost sm" data-share-game="${esc(g.id)}">${SHARE_ICON} Condividi</button></div>
      <section class="board" aria-live="polite">
        <div class="top"><span>${esc(fmtDate(g.date))}</span>${status}</div>
        <div class="teams">
          <div class="team">${logoHTML(sd.home, 'l')}<div class="nm">${esc(sd.home.name)}</div><div class="tag">Casa</div></div>
          <div class="period">${live || hasEvents ? `<div class="q">${esc(periodLabel(q, n))}</div><div class="ql">${fin ? 'Finita' : 'Periodo'}</div>` : `<div class="q">VS</div>`}</div>
          <div class="team">${logoHTML(sd.away, 'l')}<div class="nm">${esc(sd.away.name)}</div><div class="tag">Ospiti</div></div>
        </div>
        <div class="teams">
          <div class="team"><div class="digits" id="dg-home">${s.home}</div>${live ? `<div class="fouls ${bonus('home') ? 'bonus' : ''}">Falli <b>${foulsIn(g, 'home', q)}</b>${bonus('home') ? ' · bonus' : ''}</div>` : ''}</div>
          <div></div>
          <div class="team"><div class="digits" id="dg-away">${s.away}</div>${live ? `<div class="fouls ${bonus('away') ? 'bonus' : ''}">Falli <b>${foulsIn(g, 'away', q)}</b>${bonus('away') ? ' · bonus' : ''}</div>` : ''}</div>
        </div>
        ${hasEvents ? `<div class="scroll-x"><table class="qtable">
          <thead><tr><th>Squadra</th>${Array.from({ length: cols }, (_, i) => `<th>${esc(periodLabel(i + 1, n))}</th>`).join('')}<th>Tot</th></tr></thead>
          <tbody>
            <tr><td>${esc(sd.home.name)}</td>${pcell('home')}<td class="tot">${s.home}</td></tr>
            <tr><td>${esc(sd.away.name)}</td>${pcell('away')}<td class="tot">${s.away}</td></tr>
          </tbody></table></div>` : ''}
        <div class="top" style="justify-content:center">${esc([g.competition, g.venue].filter(Boolean).join(' · '))}</div>
      </section>
      ${S.canEdit ? scorer(g) : ''}
      ${boxScore(g, 'home', sd.home)}
      ${boxScore(g, 'away', sd.away)}
      ${feed(g, sd)}
      ${!S.canEdit && live ? `<div class="notice">Il punteggio si aggiorna da solo: tieni aperta questa pagina.</div>` : ''}`;
  }

  function scorer(g) {
    const sd = sides(g), n = g.periods || 4, q = g.q || 1;
    if (g.status === 'scheduled') {
      return `<section class="panel"><h3>Segnapunti</h3>
        <p class="hint" style="margin:0">Quando inizia la partita premi “Inizia diretta”: i genitori vedranno il punteggio aggiornarsi in tempo reale.</p>
        <div class="ctlbar"><button class="btn" data-act="start">▶ Inizia diretta</button><button class="btn ghost" data-edit="${esc(g.id)}">Modifica partita</button></div></section>`;
    }
    if (g.status === 'final') {
      return `<section class="panel"><h3>Segnapunti</h3><div class="ctlbar"><button class="btn ghost" data-act="reopen">Riapri diretta</button><button class="btn ghost" data-edit="${esc(g.id)}">Modifica partita</button></div></section>`;
    }
    const side = key => {
      const roster = rosterOf(g, key), sel = S.sel[key];
      return `<div class="side-ctl">
        <div class="hd">${logoHTML(sd[key], 's')}<span>${esc(sd[key].name)}</span></div>
        ${roster.length ? `<div class="chips">${roster.map((p, i) => `<button type="button" class="chip ${sel === i ? 'on' : ''}" data-pick="${key}:${i}"><b>${esc(p.num || '·')}</b>${esc(p.name ? p.name.split(' ')[0] : '')}</button>`).join('')}</div><span class="hint">${sel != null ? 'Ora tocca i punti o il fallo.' : 'Scegli il giocatore (facoltativo), poi i punti.'}</span>` : ''}
        <div class="pts">
          <button class="pt" data-pts="${key}:1" aria-label="Un punto ${esc(sd[key].name)}">+1</button>
          <button class="pt" data-pts="${key}:2" aria-label="Due punti ${esc(sd[key].name)}">+2</button>
          <button class="pt p3" data-pts="${key}:3" aria-label="Tre punti ${esc(sd[key].name)}">+3</button>
          <button class="pt f" data-foul="${key}" aria-label="Fallo ${esc(sd[key].name)}">FALLO</button>
        </div>
      </div>`;
    };
    const last = q >= n;
    return `<section class="stack">
      <h2 class="sec">Segnapunti · ${esc(periodLabel(q, n))}</h2>
      <div class="bench">${side('home')}${side('away')}</div>
      <div class="ctlbar">
        <button class="btn ghost" data-act="undo" ${(g.events || []).length ? '' : 'disabled'}>↶ Annulla ultima</button>
        <button class="btn navy" data-act="next">${last ? (q === n ? 'Supplementare' : 'Altro supplementare') : `Passa al ${esc(periodLabel(q + 1, n))}`}</button>
        <button class="btn" data-act="end">Fine partita</button>
      </div>
      ${S.confirm === 'end' ? `<div class="confirm"><b>Chiudere la partita sul ${score(g).home}–${score(g).away}?</b><span class="hint">Il risultato diventerà definitivo. Potrai comunque riaprirla.</span><div class="row end"><button class="btn ghost sm" data-cancel>Annulla</button><button class="btn sm" data-act="end-yes">Sì, finale</button></div></div>` : ''}
    </section>`;
  }

  function boxScore(g, key, team) {
    const roster = rosterOf(g, key);
    const ev = (g.events || []).filter(e => e.s === key);
    if (!roster.length && !ev.some(e => e.pl)) return '';
    const stats = new Map();
    roster.forEach(p => stats.set(p.num + '|' + p.name, { ...p, pts: 0, t3: 0, ft: 0, f: 0 }));
    for (const e of ev) {
      if (!e.pl) continue;
      const k = e.pl.num + '|' + e.pl.name;
      if (!stats.has(k)) stats.set(k, { ...e.pl, pts: 0, t3: 0, ft: 0, f: 0 });
      const st = stats.get(k);
      if (e.k === 'pt') { st.pts += e.p; if (e.p === 3) st.t3++; if (e.p === 1) st.ft++; } else st.f++;
    }
    const list = [...stats.values()].sort((a, b) => b.pts - a.pts || (+a.num || 99) - (+b.num || 99));
    if (!list.length) return '';
    return `<section class="panel"><h3>${logoHTML(team, 's')} ${esc(team.name)}</h3>
      <div class="scroll-x"><table class="box"><thead><tr><th>#</th><th>Giocatore</th><th class="r">Pt</th><th class="r">Tiri liberi</th><th class="r">Da 3</th><th class="r">Falli</th></tr></thead>
      <tbody>${list.map(p => `<tr><td class="n">${esc(p.num || '–')}</td><td>${esc(p.name || '—')}</td><td class="r big">${p.pts}</td><td class="r">${p.ft}</td><td class="r">${p.t3}</td><td class="r">${p.f}${p.f >= 5 ? ' ⛔' : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function feed(g, sd) {
    const ev = g.events || [];
    if (!ev.length) return '';
    const n = g.periods || 4;
    let h = 0, a = 0;
    const withScore = ev.map(e => { if (e.k === 'pt') e.s === 'home' ? h += e.p : a += e.p; return { e, h, a }; }).reverse().slice(0, 80);
    return `<section class="panel"><h3>Cronaca</h3><ul class="feed">${withScore.map(({ e, h, a }) => {
      const who = e.pl ? `${e.pl.num ? '#' + esc(e.pl.num) + ' ' : ''}${esc(e.pl.name || '')}` : esc(sd[e.s].name);
      const tag = e.k === 'f' ? `<span class="tag f">F</span>` : `<span class="tag ${e.p === 3 ? 'p3' : ''}">+${e.p}</span>`;
      return `<li><span class="q">${esc(periodLabel(e.q, n))}</span><span>${tag}${who}${e.pl ? ` <span class="hint">· ${esc(sd[e.s].name)}</span>` : ''}</span><span class="s">${h}–${a}</span></li>`;
    }).join('')}</ul>${ev.length > 80 ? `<span class="hint">Mostrate le ultime 80 azioni.</span>` : ''}</section>`;
  }

  // ---------- actions ----------
  function mutate(id, fn) {
    const g = gameById(id); if (!g) return;
    const copy = JSON.parse(JSON.stringify(g));
    fn(copy);
    Object.assign(g, copy);
    saveGame(g); render();
  }
  function addEvent(key, kind, pts) {
    const id = S.route.id;
    mutate(id, g => {
      const roster = rosterOf(g, key);
      const sel = S.sel[key];
      const pl = sel != null && roster[sel] ? { num: roster[sel].num || '', name: roster[sel].name || '' } : null;
      g.events = g.events || [];
      g.events.push({ id: uid(), s: key, k: kind, p: pts || 0, q: g.q || 1, pl, t: Date.now() });
      if (g.events.length > 1200) g.events = g.events.slice(-1200);
    });
    S.sel[key] = null; render();
    if (kind === 'pt') document.getElementById('dg-' + key)?.classList.add('flash');
    try { navigator.vibrate?.(15); } catch {}
  }
  async function deleteGame(id) {
    const { error } = await sb.from('games').delete().eq('id', id);
    if (error) return handleWriteError(error);
    S.games = S.games.filter(g => g.id !== id);
    toast('Partita eliminata'); go('home');
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('button, [data-open]');
    if (!t) return;
    const d = t.dataset;
    if (d.crop) return cropAction(d.crop);
    if (d.cbg) { crop.bg = d.cbg; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); return paintStage(); }
    if (d.recrop) {
      const src = d.recrop === 'team' ? (pendingTeamLogo || S.team?.logo) : (pendingOppLogo || gameById(S.route.id)?.oppLogo);
      if (src) loadImage(src).then(img => openCrop(img, d.recrop)).catch(() => toast('Logo non leggibile: caricalo di nuovo.'));
      return;
    }
    if (d.logoClear) { setLogo(d.logoClear, ''); return; }
    if (t.id === 'brandBtn') return go('home');
    if (t.id === 'teamBtn') return go('team');
    if (t.id === 'loginBtn') return go('login');
    if (d.go) return go(d.go);
    if (d.open) return go('game', d.open);
    if (d.edit) return go('edit', d.edit);
    if (d.team) { const row = (S.teamsList || []).find(x => x.slug === d.team); if (row) { await setTeam(row); go('home'); } return; }
    if (d.shareTeam !== undefined) return share(teamUrl(), S.team?.name || 'Courtside Live');
    if (d.shareGame) { const g = gameById(d.shareGame), sd = g && sides(g); return share(`${teamUrl()}#g-${d.shareGame}`, sd ? `${sd.home.name} – ${sd.away.name}` : 'Partita'); }
    if (d.install !== undefined) { installEvt?.prompt(); installEvt = null; return render(); }
    if (d.installX !== undefined) { store.set('installDismissed', '1'); return render(); }
    if (d.logout !== undefined) { await sb.auth.signOut(); S.login = { step: 'email', email: '' }; toast('Sei uscito'); return go('home'); }
    if (d.loginBack !== undefined) { S.login.step = 'email'; return render(); }
    if (d.loginMode) { S.login = { mode: d.loginMode, step: 'email', email: document.getElementById('loginEmail')?.value.trim() || S.login.email }; return render(); }
    if (d.rmEditor) {
      const { error } = await sb.from('team_editors').delete().eq('team_id', S.teamRow.id).eq('email', d.rmEditor);
      if (error) return handleWriteError(error);
      S.editors = S.editors.filter(x => x !== d.rmEditor); return render();
    }
    if (d.cancel !== undefined) { S.confirm = null; return render(); }
    if (d.del) { S.confirm = 'del'; return render(); }
    if (d.delYes) return deleteGame(d.delYes);
    if (d.ha) {
      document.getElementById('gHome').value = d.ha;
      t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t));
      return;
    }
    if (d.pick) { const [k, i] = d.pick.split(':'); S.sel[k] = S.sel[k] === +i ? null : +i; return render(); }
    if (d.pts) { const [k, p] = d.pts.split(':'); return addEvent(k, 'pt', +p); }
    if (d.foul) return addEvent(d.foul, 'f', 0);
    if (d.act) {
      const id = S.route.id;
      if (d.act === 'start') { mutate(id, g => { g.status = 'live'; g.q = g.q || 1; delete g.manual; }); wake(true); toast('Diretta iniziata'); }
      if (d.act === 'reopen') { mutate(id, g => { g.status = 'live'; }); wake(true); }
      if (d.act === 'undo') mutate(id, g => { g.events.pop(); });
      if (d.act === 'next') mutate(id, g => { g.q = (g.q || 1) + 1; });
      if (d.act === 'end') { S.confirm = 'end'; render(); }
      if (d.act === 'end-yes') { S.confirm = null; mutate(id, g => { g.status = 'final'; }); wake(false); toast('Partita chiusa'); }
    }
  });

  // ---------- logo cropper ----------
  // The logo is always shown inside a circle, so the crop is a square with a circular guide.
  let pendingTeamLogo = null, pendingOppLogo = null;
  const STAGE = 300, OUT = 256;
  const crop = { el: document.getElementById('cropper'), cv: null, img: null, target: null, s: 1, min: 1, max: 4, fit: 1, cover: 1, tx: 0, ty: 0, bg: 'white', ptrs: new Map(), dist: 0 };
  const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const formColor = target => document.getElementById(target === 'team' ? 'teamColor' : 'gOppColor')?.value || '#e2591a';
  const zoomToSlider = s => Math.round(1000 * Math.log(s / crop.min) / Math.log(crop.max / crop.min));
  const sliderToZoom = v => crop.min * Math.pow(crop.max / crop.min, v / 1000);

  function setLogo(target, url) {
    if (target === 'team') pendingTeamLogo = url; else pendingOppLogo = url;
    const name = document.getElementById(target === 'team' ? 'teamName' : 'gOpp')?.value;
    document.getElementById(target === 'team' ? 'teamLogoPrev' : 'oppLogoPrev').innerHTML = logoHTML({ name, logo: url, color: formColor(target) }, 'l');
    document.getElementById(target === 'team' ? 'teamLogoActs' : 'oppLogoActs').hidden = !url;
  }

  function openCrop(img, target) {
    Object.assign(crop, { img, target, tx: 0, ty: 0, bg: 'white' });
    crop.fit = STAGE / Math.max(img.width, img.height);
    crop.cover = STAGE / Math.min(img.width, img.height);
    crop.min = crop.fit * 0.4; crop.max = crop.cover * 4;
    crop.s = crop.fit * 0.92;
    crop.el.innerHTML = `<div class="crop-card" role="dialog" aria-modal="true" aria-labelledby="cropTitle">
      <h3 id="cropTitle">Ritaglia il logo</h3>
      <p class="hint">Trascina per spostarlo, usa il cursore o due dita per lo zoom. Si vedrà quello che sta dentro il cerchio.</p>
      <div class="crop-stage"><canvas id="cropCanvas" width="${STAGE * 2}" height="${STAGE * 2}" aria-label="Anteprima del ritaglio"></canvas></div>
      <div class="field"><label for="cropZoom">Zoom</label><input type="range" id="cropZoom" min="0" max="1000" value="${zoomToSlider(crop.s)}"></div>
      <div class="row"><button type="button" class="btn ghost sm" data-crop="fit">Logo intero</button><button type="button" class="btn ghost sm" data-crop="fill">Riempi il cerchio</button><button type="button" class="btn ghost sm" data-crop="center">Centra</button></div>
      <div class="field"><span class="lbl">Sfondo</span><div class="seg" role="group" aria-label="Sfondo del logo">
        <button type="button" data-cbg="white" class="on">Bianco</button><button type="button" data-cbg="team">Colore squadra</button><button type="button" data-cbg="none">Trasparente</button></div></div>
      <div class="row end"><button type="button" class="btn ghost" data-crop="cancel">Annulla</button><button type="button" class="btn" data-crop="ok">Usa questo logo</button></div>
    </div>`;
    crop.el.hidden = false;
    crop.cv = document.getElementById('cropCanvas');
    crop.ptrs.clear();
    bindStage(crop.cv);
    paintStage();
  }

  function paint(ctx, size, guide) {
    const k = size / STAGE;
    ctx.clearRect(0, 0, size, size);
    if (crop.bg === 'none') {
      if (guide) { const q = 16 * k; for (let y = 0; y < size; y += q) for (let x = 0; x < size; x += q) { ctx.fillStyle = ((x + y) / q) % 2 ? '#cfd3dc' : '#f2f3f6'; ctx.fillRect(x, y, q, q); } }
    } else { ctx.fillStyle = crop.bg === 'team' ? formColor(crop.target) : '#ffffff'; ctx.fillRect(0, 0, size, size); }
    const w = crop.img.width * crop.s * k, h = crop.img.height * crop.s * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop.img, size / 2 + crop.tx * k - w / 2, size / 2 + crop.ty * k - h / 2, w, h);
    if (guide) {
      ctx.save();
      ctx.fillStyle = 'rgba(5,8,16,.6)';
      ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.arc(size / 2, size / 2, size / 2 - 2 * k, 0, Math.PI * 2); ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  function paintStage() { if (crop.cv) paint(crop.cv.getContext('2d'), crop.cv.width, true); }
  function clampPan() {
    const lim = (len) => Math.max(0, len / 2 + STAGE / 2 - 30);
    crop.tx = Math.max(-lim(crop.img.width * crop.s), Math.min(lim(crop.img.width * crop.s), crop.tx));
    crop.ty = Math.max(-lim(crop.img.height * crop.s), Math.min(lim(crop.img.height * crop.s), crop.ty));
  }
  function setZoom(s, fromSlider) {
    const prev = crop.s;
    crop.s = Math.max(crop.min, Math.min(crop.max, s));
    crop.tx *= crop.s / prev; crop.ty *= crop.s / prev; // zoom around the centre
    clampPan();
    if (!fromSlider) { const z = document.getElementById('cropZoom'); if (z) z.value = zoomToSlider(crop.s); }
    paintStage();
  }

  function bindStage(cv) {
    const unit = () => STAGE / cv.getBoundingClientRect().width;
    const distance = () => { const [a, b] = [...crop.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); crop.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (crop.ptrs.size === 2) crop.dist = distance(); });
    cv.addEventListener('pointermove', e => {
      const p = crop.ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (crop.ptrs.size === 1) { crop.tx += dx * unit(); crop.ty += dy * unit(); clampPan(); paintStage(); }
      else if (crop.ptrs.size === 2) { const d = distance(); if (crop.dist) setZoom(crop.s * d / crop.dist); crop.dist = d; }
    });
    const up = e => { crop.ptrs.delete(e.pointerId); crop.dist = crop.ptrs.size === 2 ? distance() : 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); setZoom(crop.s * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }

  function cropAction(a) {
    if (a === 'fit') { crop.tx = crop.ty = 0; setZoom(crop.fit * 0.92); }
    if (a === 'fill') { crop.tx = crop.ty = 0; setZoom(crop.cover); }
    if (a === 'center') { crop.tx = crop.ty = 0; paintStage(); }
    if (a === 'cancel') closeCrop();
    if (a === 'ok') {
      const c = document.createElement('canvas'); c.width = c.height = OUT;
      paint(c.getContext('2d'), OUT, false);
      let url = c.toDataURL('image/webp', 0.9);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
      if (url.length > 150000 && crop.bg !== 'none') url = c.toDataURL('image/jpeg', 0.88);
      setLogo(crop.target, url);
      closeCrop();
    }
  }
  function closeCrop() { crop.el.hidden = true; crop.el.innerHTML = ''; crop.cv = null; crop.img = null; }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !crop.el.hidden) closeCrop(); });
  document.addEventListener('input', e => {
    if (e.target.id === 'cropZoom') setZoom(sliderToZoom(+e.target.value), true);
    if (e.target.id === 'teamName' && document.getElementById('teamSlug') && !slugTouched) { document.getElementById('teamSlug').value = slugify(e.target.value); updateSlugPrev(); }
    if (e.target.id === 'teamSlug') { slugTouched = true; updateSlugPrev(); }
  });
  let slugTouched = false;
  const updateSlugPrev = () => { const p = document.getElementById('slugPrev'); if (p) p.textContent = document.getElementById('teamSlug').value || '…'; };
  document.addEventListener('change', e => {
    const t = e.target;
    const target = t.id === 'teamLogo' ? 'team' : t.id === 'gOppLogo' ? 'opp' : null;
    if (!target || !t.files[0]) return;
    const url = URL.createObjectURL(t.files[0]);
    loadImage(url).then(img => openCrop(img, target)).catch(() => toast('Immagine non leggibile: prova con un PNG o JPG.')).finally(() => { t.value = ''; });
  });

  // ---------- forms ----------
  document.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const v = id => document.getElementById(id)?.value?.trim() ?? '';
    const btn = f.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      if (f.id === 'loginForm' && (S.login.mode || 'password') === 'password') {
        const email = v('loginEmail').toLowerCase(), password = document.getElementById('loginPass').value;
        S.login.email = email;
        if (e.submitter?.dataset.signup !== undefined) {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: baseUrl() } });
          if (error) return toast(/already|registered/i.test(error.message) ? 'Esiste già un account con questa email: tocca “Entra”.' : /password/i.test(error.message) ? 'Password troppo debole: usa almeno 8 caratteri.' : 'Registrazione non riuscita: riprova tra poco.');
          if (!data.session) return toast("Ti abbiamo mandato un'email: conferma l'indirizzo, poi torna qui e tocca “Entra”.");
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) return toast(/confirm/i.test(error.message) ? "Prima conferma l'indirizzo con il link che ti abbiamo mandato per email." : 'Email o password non corrette.');
        }
        toast('Accesso effettuato');
        go(S.teamRow ? 'home' : 'team');
      } else if (f.id === 'loginForm') {
        if (S.login.step === 'email') {
          const email = v('loginEmail').toLowerCase();
          const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: baseUrl() + location.search } });
          if (error) return toast(error.status === 429 ? 'Troppe richieste: aspetta un minuto e riprova.' : "Invio non riuscito: controlla l'indirizzo email.");
          S.login = { mode: 'link', step: 'code', email }; render();
        } else {
          const { error } = await sb.auth.verifyOtp({ email: S.login.email, token: v('loginCode').replace(/\s/g, ''), type: 'email' });
          if (error) return toast('Codice non valido o scaduto: richiedine uno nuovo.');
          toast('Accesso effettuato');
          go(S.teamRow ? 'home' : 'team');
        }
      }
      if (f.id === 'editorForm') {
        const email = v('editorEmail').toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Scrivi un indirizzo email valido.");
        const { error } = await sb.from('team_editors').insert({ team_id: S.teamRow.id, email });
        if (error && error.code !== '23505') return handleWriteError(error);
        if (!S.editors.includes(email)) S.editors.push(email);
        toast('Segnapunti aggiunto'); render();
      }
      if (f.id === 'teamForm') {
        const data = {
          name: v('teamName') || 'La mia squadra', category: v('teamCat'), season: v('teamSeason'),
          color: v('teamColor'), roster: parseRoster(v('teamRoster')),
          logo: pendingTeamLogo !== null ? pendingTeamLogo : (S.team?.logo || ''),
        };
        if (!S.teamRow) {
          const slug = slugify(v('teamSlug'));
          if (slug.length < 2) return toast("Scegli un indirizzo di almeno 2 caratteri.");
          const { data: row, error } = await sb.from('teams').insert({ slug, data }).select('id,slug,owner,data').single();
          if (error) return toast(error.code === '23505' ? 'Questo indirizzo è già usato: scegline un altro.' : 'Creazione non riuscita: riprova.');
          pendingTeamLogo = null;
          await setTeam(row);
          toast('Squadra creata'); go('home');
        } else {
          const { error } = await sb.from('teams').update({ data, updated_at: new Date().toISOString() }).eq('id', S.teamRow.id);
          if (error) return handleWriteError(error);
          pendingTeamLogo = null;
          S.team = data; S.teamRow.data = data;
          toast('Squadra salvata'); go('home');
        }
      }
      if (f.id === 'gameForm') {
        const id = f.dataset.id || uid();
        const prev = gameById(id) || { status: 'scheduled', q: 1, events: [] };
        const home = v('gHome') === '1';
        const dt = v('gDate');
        const g = {
          ...prev, id,
          weAreHome: home, opponent: v('gOpp'), oppColor: v('gOppColor'),
          oppLogo: pendingOppLogo !== null ? pendingOppLogo : (prev.oppLogo || ''),
          date: dt ? new Date(dt).toISOString() : '', periods: +v('gPeriods') || 4,
          competition: v('gComp'), venue: v('gVenue'),
          ourRoster: parseRoster(v('gOurRoster')), oppRoster: parseRoster(v('gOppRoster')),
        };
        pendingOppLogo = null;
        const us = v('gManUs'), them = v('gManThem');
        if (!(g.events || []).length && us !== '' && them !== '') {
          g.manual = home ? { home: +us, away: +them } : { home: +them, away: +us };
          g.status = 'final';
        } else if (!(g.events || []).length) { delete g.manual; if (g.status === 'final') g.status = 'scheduled'; }
        if (!gameById(id)) S.games.push(g); else Object.assign(gameById(id), g);
        saveGame(g);
        toast(f.dataset.id ? 'Partita aggiornata' : 'Partita creata');
        go('game', id);
      }
    } finally { if (btn && btn.isConnected) btn.disabled = false; }
  });

  // ---------- boot ----------
  function restoreRoute() {
    const h = location.hash.slice(1);
    if (h.startsWith('g-')) return { view: 'game', id: h.slice(2) };
    return { view: 'home' };
  }
  S.route = restoreRoute();

  async function boot() {
    if (!sb) { S.ready = true; render(); return; }
    const { data: { session } } = await sb.auth.getSession();
    S.user = session?.user || null;
    sb.auth.onAuthStateChange(async (_ev, sess) => {
      const was = S.user?.id;
      S.user = sess?.user || null;
      if (S.user?.id === was) return;
      if (!S.teamRow && S.user) { const row = await resolveTeam(); if (row) await setTeam(row); }
      else await refreshPerms();
      render();
    });
    try { const row = await resolveTeam(); if (row) await setTeam(row); }
    catch (e) { console.warn(e); toast('Connessione al server non riuscita.'); }
    S.ready = true;
    render();
    wake(S.route.view === 'game' && S.canEdit && gameById(S.route.id)?.status === 'live');
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  render();
  boot();
})();
