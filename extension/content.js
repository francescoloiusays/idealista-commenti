// Content script: aggiunge la sezione commenti agli annunci di idealista
// e il contatore dei commenti nelle pagine dei risultati.
(() => {
  'use strict';
  if (globalThis.__idealistaCommenti) return;
  globalThis.__idealistaCommenti = true;

  const REACTIONS = [
    { e: '👍', label: 'Mi piace' },
    { e: '❤️', label: 'Adoro' },
    { e: '😂', label: 'Ahah' },
    { e: '😮', label: 'Wow' },
    { e: '😢', label: 'Che tristezza' },
    { e: '😡', label: 'Grrr' },
  ];
  const LABEL = Object.fromEntries(REACTIONS.map((r) => [r.e, r.label]));
  const DETAIL_RE = /\/(?:immobile|inmueble|imovel)\/(\d{4,12})(?:\/|$)/;
  const MAX_DEPTH = 2; // livelli di rientro; oltre, le risposte vengono mostrate allo stesso livello
  const VISIBLE_REPLIES = 2;
  const MAX_IMAGE_SIDE = 1600;
  const MAX_UPLOAD = 5 * 1024 * 1024;

  const here = () => (globalThis.__IC_TEST_URL ? new URL(globalThis.__IC_TEST_URL) : location);
  const country = () => ({ it: 'it', com: 'es', pt: 'pt' })[here().hostname.split('.').pop()];
  const listingFromPath = (path) => {
    const m = String(path).match(DETAIL_RE);
    return m && country() ? `${country()}:${m[1]}` : null;
  };

  /* ---------------------------------------------------------- helpers */

  function bg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (res) => {
          if (chrome.runtime.lastError) return reject(new Error('Estensione aggiornata: ricarica la pagina'));
          if (!res?.ok) {
            const err = new Error(res?.error || 'Errore sconosciuto');
            err.status = res?.status;
            err.code = res?.code;
            return reject(err);
          }
          resolve(res.data);
        });
      } catch {
        reject(new Error('Estensione aggiornata: ricarica la pagina'));
      }
    });
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const ICONS = {
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>',
  };
  function icon(name) {
    const s = document.createElement('span');
    s.style.display = 'contents';
    s.innerHTML = ICONS[name]; // costanti interne, nessun dato esterno
    return s;
  }

  // <img> che, se la CSP della pagina blocca l'origine, riprova passando dal service worker
  function safeImg(src, props = {}, onFail) {
    const el = h('img', { alt: '', ...props, referrerpolicy: 'no-referrer', decoding: 'async' });
    let retried = false;
    el.addEventListener('error', async () => {
      if (retried || !src || src.startsWith('data:') || src.startsWith('blob:')) return onFail?.(el);
      retried = true;
      try {
        const { dataUrl } = await bg('fetchImage', { url: src });
        el.src = dataUrl;
      } catch {
        onFail?.(el);
      }
    });
    el.src = src;
    return el;
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function colorFor(str) {
    let hash = 0;
    for (const ch of String(str)) hash = (hash * 31 + ch.codePointAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
  }
  function avatar(user, small) {
    const cls = 'ic-avatar' + (small ? ' sm' : '');
    const fallback = () =>
      h('div', { class: cls, style: `background:${colorFor(user?.id || user?.name)}`, 'aria-hidden': 'true', text: initials(user?.name) });
    if (!user?.picture) return fallback();
    return safeImg(user.picture, { class: cls, alt: user.name }, (img) => img.replaceWith(fallback()));
  }

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'adesso';
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${Math.round(s / 3600)} h`;
    if (s < 7 * 86400) return `${Math.round(s / 86400)} g`;
    if (s < 5 * 7 * 86400) return `${Math.round(s / (7 * 86400))} sett`;
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('it-IT', opts);
  }
  const fullDate = (ts) => new Date(ts).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' });

  function richText(text) {
    const frag = document.createDocumentFragment();
    const re = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi;
    let last = 0;
    for (const m of text.matchAll(re)) {
      frag.append(text.slice(last, m.index));
      frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer nofollow ugc', text: m[0] }));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Formato non supportato: usa JPG, PNG, WebP o GIF');
    if (file.type === 'image/gif') {
      if (file.size > MAX_UPLOAD) throw new Error('GIF troppo grande (max 5 MB)');
      return file; // manteniamo l'animazione
    }
    // Ricodifica sempre: riduce le dimensioni e rimuove i metadati EXIF (posizione GPS inclusa)
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (file.type !== 'image/png') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
    const out = blob || (await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85)));
    if (!out) throw new Error('Impossibile elaborare l’immagine');
    if (out.size > MAX_UPLOAD) throw new Error('Immagine troppo grande (max 5 MB)');
    return out;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(new Error('Lettura del file non riuscita'));
      fr.readAsDataURL(blob);
    });
  }

  /* ----------------------------------------------------- widget commenti */

  function mountComments(listing) {
    const host = h('div', { id: 'idealista-commenti', 'data-listing': listing });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', { text: globalThis.IC_STYLES || '' }));

    const state = {
      listing,
      comments: [],
      me: null,
      loading: true,
      error: null,
      errorCode: '',
      replyTo: null,
      editing: null,
      confirmDelete: null,
      expanded: new Set(),
    };
    const replyComposers = new Map();
    const editComposers = new Map();
    let byId = new Map();
    let kids = new Map();

    const listEl = h('ul', { class: 'ic-list' });
    const countEl = h('span', { class: 'ic-count' });
    const loginEl = h('div');
    const topComposerSlot = h('div');
    const statusEl = h('div');
    const toastEl = h('div', { class: 'ic-toast', role: 'status', hidden: true });
    let toastTimer;

    const section = h(
      'section',
      { class: 'ic', 'aria-label': 'Commenti' },
      h(
        'div',
        { class: 'ic-head' },
        h('h2', { class: 'ic-title' }, 'Commenti ', countEl),
        h('span', { class: 'ic-spacer' }),
        h('button', { class: 'ic-iconbtn', title: 'Aggiorna', 'aria-label': 'Aggiorna i commenti', onclick: () => load() }, icon('refresh'))
      ),
      loginEl,
      topComposerSlot,
      statusEl,
      listEl,
      toastEl,
      h('div', { class: 'ic-foot', text: 'Commenti della community · non affiliato a idealista' })
    );
    root.append(section);

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toastEl.hidden = true), 4500);
    }

    async function login() {
      try {
        const { user } = await bg('login');
        state.me = user;
        renderAll();
        await load();
        return true;
      } catch (e) {
        toast(e.message);
        return false;
      }
    }

    async function ensureLogin() {
      if (state.me) return true;
      return login();
    }

    /* --------------------------------------------------------- composer */

    function createComposer({ mode = 'new', placeholder = 'Scrivi un commento…', initial = '', onSubmit, onCancel }) {
      let attach = null; // { kind: 'gif', url, preview } | { kind: 'image', blob, previewUrl }
      let busy = false;
      let gifPanel = null;
      const allowMedia = mode !== 'edit';

      const ta = h('textarea', { class: 'ic-text', rows: 1, placeholder, maxlength: 2000, 'aria-label': placeholder });
      ta.value = initial;
      const attachBox = h('div');
      const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
      const gifBtn = h('button', { class: 'ic-tool', type: 'button', title: 'Aggiungi una GIF', 'aria-label': 'Aggiungi una GIF', text: 'GIF' });
      const imgBtn = h('button', { class: 'ic-tool', type: 'button', title: 'Aggiungi un’immagine', 'aria-label': 'Aggiungi un’immagine' }, icon('image'));
      const sendBtn = h('button', { class: 'ic-tool ic-send', type: 'button', title: 'Invia', 'aria-label': 'Invia' }, icon('send'));
      const field = h(
        'div',
        { class: 'ic-field' },
        attachBox,
        h('div', { class: 'ic-row' }, ta, allowMedia && gifBtn, allowMedia && imgBtn, sendBtn),
        fileInput
      );
      const hint =
        mode === 'new'
          ? null
          : h(
              'div',
              { class: 'ic-hint' },
              mode === 'edit' ? 'Premi Esc per ' : '',
              h('button', { type: 'button', text: mode === 'edit' ? 'annullare' : 'Annulla', onclick: () => onCancel?.() })
            );
      const el = h(
        'div',
        { class: 'ic-composer' + (mode === 'new' ? '' : ' reply') },
        mode === 'edit' ? null : avatar(state.me, mode !== 'new'),
        h('div', { style: 'flex:1;min-width:0' }, field, hint)
      );

      const autosize = () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
      };
      const update = () => {
        sendBtn.disabled = busy || (!ta.value.trim() && !attach);
        ta.disabled = busy;
        gifBtn.classList.toggle('on', !!gifPanel);
      };

      function setAttach(a) {
        if (attach?.previewUrl) URL.revokeObjectURL(attach.previewUrl);
        attach = a;
        attachBox.replaceChildren();
        if (a) {
          const src = a.kind === 'gif' ? a.preview : a.previewUrl;
          attachBox.append(
            h(
              'div',
              { class: 'ic-attach' },
              a.kind === 'gif' ? safeImg(src, { alt: 'GIF selezionata' }) : h('img', { src, alt: 'Immagine selezionata' }),
              h('button', { class: 'ic-x', type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi allegato', text: '×', onclick: () => setAttach(null) })
            )
          );
        }
        update();
      }

      async function addFile(file) {
        if (!file || !allowMedia) return;
        try {
          const blob = await prepareImage(file);
          setAttach({ kind: 'image', blob, previewUrl: URL.createObjectURL(blob) });
          closeGifs();
          ta.focus();
        } catch (e) {
          toast(e.message);
        }
      }

      function closeGifs() {
        gifPanel?.remove();
        gifPanel = null;
        update();
      }

      async function openGifs() {
        if (gifPanel) return closeGifs();
        if (!(await ensureLogin())) return;
        gifPanel = createGifPanel((g) => {
          setAttach({ kind: 'gif', url: g.url, preview: g.preview });
          closeGifs();
          ta.focus();
        });
        field.append(gifPanel);
        update();
        gifPanel.querySelector('input')?.focus();
      }

      async function submit() {
        if (busy) return;
        const text = ta.value.trim();
        if (!text && !attach) return;
        if (!(await ensureLogin())) return;
        busy = true;
        update();
        try {
          let imageKey = null;
          let gifUrl = null;
          if (attach?.kind === 'image') {
            const up = await bg('upload', { base64: await blobToBase64(attach.blob), contentType: attach.blob.type });
            imageKey = up.key;
          } else if (attach?.kind === 'gif') gifUrl = attach.url;
          await onSubmit({ text, gifUrl, imageKey });
          ta.value = '';
          setAttach(null);
          closeGifs();
          autosize();
        } catch (e) {
          toast(e.message);
        } finally {
          busy = false;
          update();
        }
      }

      ta.addEventListener('input', () => {
        autosize();
        update();
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape' && onCancel) {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation(); // evita che le scorciatoie di idealista intercettino i tasti
      });
      ta.addEventListener('keyup', (e) => e.stopPropagation());
      ta.addEventListener('keypress', (e) => e.stopPropagation());
      ta.addEventListener('focus', () => {
        if (!state.me && mode === 'new') loginEl.querySelector('button')?.classList.add('pulse');
      });
      ta.addEventListener('paste', (e) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (file && allowMedia) {
          e.preventDefault();
          addFile(file);
        }
      });
      if (allowMedia) {
        field.addEventListener('dragover', (e) => {
          if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
            e.preventDefault();
            field.classList.add('drag');
          }
        });
        field.addEventListener('dragleave', () => field.classList.remove('drag'));
        field.addEventListener('drop', (e) => {
          field.classList.remove('drag');
          const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
          if (file) {
            e.preventDefault();
            addFile(file);
          }
        });
      }
      gifBtn.addEventListener('click', openGifs);
      imgBtn.addEventListener('click', async () => {
        if (await ensureLogin()) fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        addFile(fileInput.files?.[0]);
        fileInput.value = '';
      });
      sendBtn.addEventListener('click', submit);
      update();
      queueMicrotask(autosize);

      return {
        el,
        focus: () => {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        },
        isDirty: () => !!ta.value.trim() || !!attach || busy,
        hasFocus: () => root.activeElement === ta,
      };
    }

    function createGifPanel(onPick) {
      const input = h('input', { type: 'search', placeholder: 'Cerca GIF su GIPHY…', 'aria-label': 'Cerca GIF' });
      const grid = h('div', { class: 'ic-gifgrid' });
      const panel = h(
        'div',
        { class: 'ic-gifs' },
        input,
        grid,
        h('div', { class: 'ic-gifs-foot' }, h('span', { text: 'Tocca una GIF per allegarla' }), h('span', {}, 'Powered by ', h('b', { text: 'GIPHY' })))
      );
      let q = '';
      let offset = 0;
      let seq = 0;
      let loading = false;
      let done = false;
      const msg = (t) => h('div', { class: 'ic-gifs-msg', text: t });

      async function load(reset) {
        if (loading && !reset) return;
        const my = ++seq;
        loading = true;
        if (reset) {
          offset = 0;
          done = false;
          grid.replaceChildren(msg('Caricamento…'));
        }
        try {
          const data = await bg('gifs', { q, offset });
          if (my !== seq) return;
          if (reset) grid.replaceChildren();
          for (const g of data.gifs) {
            grid.append(
              h('button', { type: 'button', title: g.title || 'GIF', 'aria-label': g.title || 'GIF', onclick: () => onPick(g) }, safeImg(g.preview, { loading: 'lazy', alt: g.title || '' }))
            );
          }
          if (!data.gifs.length) done = true;
          if (reset && !data.gifs.length) grid.append(msg('Nessuna GIF trovata'));
          offset = data.nextOffset;
        } catch (e) {
          if (my === seq) grid.replaceChildren(msg(e.message));
        } finally {
          if (my === seq) loading = false;
        }
      }

      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          q = input.value.trim();
          load(true);
        }, 350);
      });
      for (const ev of ['keydown', 'keyup', 'keypress']) input.addEventListener(ev, (e) => e.stopPropagation());
      grid.addEventListener('scroll', () => {
        if (!done && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 80) load(false);
      });
      load(true);
      return panel;
    }

    /* ------------------------------------------------------------ data */

    function index() {
      byId = new Map(state.comments.map((c) => [c.id, c]));
      kids = new Map();
      for (const c of state.comments) {
        const key = c.parentId && byId.has(c.parentId) ? c.parentId : null;
        if (!kids.has(key)) kids.set(key, []);
        kids.get(key).push(c);
      }
      for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);
      visibleCache.clear();
    }
    const visibleCache = new Map();
    function isVisible(c) {
      if (visibleCache.has(c.id)) return visibleCache.get(c.id);
      const v = !c.deleted || (kids.get(c.id) || []).some(isVisible);
      visibleCache.set(c.id, v);
      return v;
    }
    function descendants(c) {
      const out = [];
      const walk = (x) => {
        for (const k of kids.get(x.id) || []) {
          out.push(k);
          walk(k);
        }
      };
      walk(c);
      return out.sort((a, b) => a.createdAt - b.createdAt);
    }

    async function load() {
      if (busyRefresh()) return;
      state.loading = !state.comments.length;
      if (state.loading) renderStatus();
      try {
        const data = await bg('getComments', { listing });
        state.comments = data.comments;
        state.me = data.me || null;
        state.error = null;
        state.errorCode = '';
      } catch (e) {
        state.error = e.message;
        state.errorCode = e.code || '';
      } finally {
        state.loading = false;
        index();
        renderAll();
      }
    }

    // non ricaricare mentre l'utente sta scrivendo una risposta o una modifica
    function busyRefresh() {
      if (state.replyTo || state.editing) return true;
      return top?.hasFocus() && top.isDirty();
    }

    async function postComment(parentId, { text, gifUrl, imageKey }) {
      const { comment } = await bg('postComment', { listing, parentId, text, gifUrl, imageKey });
      state.comments.push(comment);
      if (parentId) {
        state.replyTo = null;
        replyComposers.delete(parentId);
        // assicura che la nuova risposta sia visibile
        let p = byId.get(parentId);
        while (p) {
          state.expanded.add(p.id);
          p = byId.get(p.parentId);
        }
      }
      index();
      renderList();
      root.getElementById?.('ic-' + comment.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function react(c, emoji) {
      if (!(await ensureLogin())) return;
      const prev = { reactions: { ...c.reactions }, myReaction: c.myReaction };
      const r = { ...c.reactions };
      if (c.myReaction) r[c.myReaction] = Math.max(0, (r[c.myReaction] || 1) - 1) || undefined;
      if (emoji) r[emoji] = (r[emoji] || 0) + 1;
      for (const k of Object.keys(r)) if (!r[k]) delete r[k];
      c.reactions = r;
      c.myReaction = emoji;
      renderList();
      try {
        const res = await bg('react', { id: c.id, emoji });
        c.reactions = res.reactions;
        c.myReaction = res.myReaction;
      } catch (e) {
        Object.assign(c, prev);
        toast(e.message);
      }
      renderList();
    }

    async function remove(c) {
      try {
        await bg('deleteComment', { id: c.id });
        Object.assign(c, { deleted: true, text: '', gifUrl: null, imageUrl: null, user: null, reactions: {}, myReaction: null });
        state.confirmDelete = null;
        index();
        renderAll();
      } catch (e) {
        toast(e.message);
      }
    }

    /* ---------------------------------------------------------- render */

    function lightbox(src) {
      const box = h('div', { class: 'ic-lightbox', role: 'dialog', 'aria-label': 'Immagine ingrandita' }, safeImg(src));
      const close = () => {
        box.remove();
        document.removeEventListener('keydown', onKey, true);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      box.addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);
      root.append(box);
    }

    function pill(c) {
      const entries = Object.entries(c.reactions || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return null;
      const total = entries.reduce((s, [, n]) => s + n, 0);
      return h(
        'span',
        { class: 'ic-pill', title: entries.map(([e, n]) => `${e} ${n}`).join('  ·  ') },
        entries.slice(0, 3).map(([e]) => h('span', { class: 'e', text: e })),
        h('span', { class: 'n', text: String(total) })
      );
    }

    function reactControl(c) {
      const mine = c.myReaction;
      const bar = h(
        'div',
        { class: 'ic-bar', role: 'toolbar', 'aria-label': 'Reazioni' },
        REACTIONS.map((r) =>
          h('button', {
            type: 'button',
            class: mine === r.e ? 'mine' : null,
            title: r.label,
            'aria-label': r.label,
            text: r.e,
            onclick: (ev) => {
              ev.stopPropagation();
              closeBar();
              react(c, mine === r.e ? null : r.e);
            },
          })
        )
      );
      const btn = h('button', {
        type: 'button',
        class: 'ic-act',
        'data-r': mine,
        'aria-pressed': mine ? 'true' : 'false',
        text: mine ? `${mine} ${LABEL[mine]}` : 'Mi piace',
        onclick: () => {
          closeBar();
          react(c, mine ? null : '👍');
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          openBar();
        },
      });
      const wrap = h('span', { class: 'ic-react' }, bar, btn);
      let t;
      const openBar = () => {
        clearTimeout(t);
        bar.classList.add('open');
      };
      const closeBar = () => {
        clearTimeout(t);
        bar.classList.remove('open');
      };
      wrap.addEventListener('mouseenter', () => {
        clearTimeout(t);
        t = setTimeout(openBar, 350);
      });
      wrap.addEventListener('mouseleave', () => {
        clearTimeout(t);
        t = setTimeout(closeBar, 300);
      });
      wrap.addEventListener('focusin', (e) => e.target !== btn && openBar());
      wrap.addEventListener('focusout', (e) => !wrap.contains(e.relatedTarget) && closeBar());
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          openBar();
          bar.querySelector('button')?.focus();
        }
      });
      // pressione prolungata su touch
      let lp;
      btn.addEventListener('touchstart', () => (lp = setTimeout(openBar, 450)), { passive: true });
      btn.addEventListener('touchend', () => clearTimeout(lp));
      return wrap;
    }

    function renderComment(c, depth, { flat = false, replyToName = null } = {}) {
      const mineComment = state.me && c.user && c.user.id === state.me.id;
      const main = h('div', { class: 'ic-main' });

      if (replyToName) main.append(h('div', { class: 'ic-replyto', text: `↪ in risposta a ${replyToName}` }));

      if (c.deleted) {
        main.append(h('div', { class: 'ic-bubble-wrap' }, h('div', { class: 'ic-bubble deleted', text: 'Commento eliminato' })));
      } else if (state.editing === c.id) {
        let comp = editComposers.get(c.id);
        if (!comp) {
          comp = createComposer({
            mode: 'edit',
            initial: c.text,
            placeholder: 'Modifica il commento…',
            onCancel: () => {
              state.editing = null;
              editComposers.delete(c.id);
              renderList();
            },
            onSubmit: async ({ text }) => {
              const { comment } = await bg('editComment', { id: c.id, text });
              Object.assign(c, comment);
              state.editing = null;
              editComposers.delete(c.id);
              renderList();
            },
          });
          editComposers.set(c.id, comp);
          setTimeout(() => comp.focus(), 0);
        }
        main.append(comp.el);
      } else {
        const bubble = c.text
          ? h('div', { class: 'ic-bubble' }, h('span', { class: 'ic-name', text: c.user.name }), h('div', { class: 'ic-body' }, richText(c.text)))
          : h('div', { class: 'ic-bubble' }, h('span', { class: 'ic-name', text: c.user.name }));
        main.append(h('div', { class: 'ic-bubble-wrap' }, bubble, pill(c)));
      }

      if (!c.deleted && state.editing !== c.id) {
        const media = c.gifUrl || c.imageUrl;
        if (media) {
          const im = safeImg(media, { class: 'ic-media', loading: 'lazy', alt: c.gifUrl ? 'GIF' : 'Immagine allegata' });
          im.addEventListener('click', () => lightbox(media));
          main.append(im);
        }
      }

      if (!c.deleted && state.editing !== c.id) {
        const actions = h(
          'div',
          { class: 'ic-actions' },
          reactControl(c),
          h('button', {
            type: 'button',
            class: 'ic-act',
            text: 'Rispondi',
            onclick: async () => {
              if (!(await ensureLogin())) return;
              state.replyTo = state.replyTo === c.id ? null : c.id;
              renderList();
              replyComposers.get(c.id)?.focus();
            },
          }),
          h('time', { class: 'ic-time', datetime: new Date(c.createdAt).toISOString(), title: fullDate(c.createdAt), text: ago(c.createdAt) }),
          c.editedAt ? h('span', { class: 'ic-edited', title: 'Modificato ' + fullDate(c.editedAt), text: 'Modificato' }) : null
        );
        if (mineComment) {
          if (state.confirmDelete === c.id) {
            actions.append(
              h('span', { text: 'Eliminare?' }),
              h('button', { type: 'button', class: 'ic-act', style: 'color:var(--ic-danger)', text: 'Sì, elimina', onclick: () => remove(c) }),
              h('button', { type: 'button', class: 'ic-act', text: 'No', onclick: () => ((state.confirmDelete = null), renderList()) })
            );
          } else {
            actions.append(
              c.text || c.gifUrl || c.imageUrl
                ? h('button', { type: 'button', class: 'ic-act', text: 'Modifica', onclick: () => ((state.editing = c.id), renderList()) })
                : null,
              h('button', { type: 'button', class: 'ic-act', text: 'Elimina', onclick: () => ((state.confirmDelete = c.id), renderList()) })
            );
          }
        }
        main.append(actions);
      }

      if (!flat) {
        const replies = renderReplies(c, depth);
        if (replies) main.append(replies);
      }

      if (state.replyTo === c.id) {
        let comp = replyComposers.get(c.id);
        if (!comp) {
          comp = createComposer({
            mode: 'reply',
            placeholder: `Rispondi a ${c.user?.name || 'questo commento'}…`,
            onCancel: () => {
              state.replyTo = null;
              replyComposers.delete(c.id);
              renderList();
            },
            onSubmit: (data) => postComment(c.id, data),
          });
          replyComposers.set(c.id, comp);
          setTimeout(() => comp.focus(), 0);
        }
        main.append(comp.el);
      }

      return h('li', { class: 'ic-c', id: 'ic-' + c.id }, c.deleted ? h('div', { class: 'ic-avatar' + (depth ? ' sm' : '') }) : avatar(c.user, depth > 0), main);
    }

    function renderReplies(c, depth) {
      const childDepth = depth + 1;
      let items;
      if (childDepth >= MAX_DEPTH) {
        items = descendants(c)
          .filter(isVisible)
          .map((x) => ({ c: x, flat: true, replyToName: x.parentId !== c.id ? byId.get(x.parentId)?.user?.name || 'un commento eliminato' : null }));
      } else {
        items = (kids.get(c.id) || []).filter(isVisible).map((x) => ({ c: x, flat: false }));
      }
      if (!items.length) return null;

      const expanded = state.expanded.has(c.id) || items.length <= VISIBLE_REPLIES + 1;
      const shown = expanded ? items : items.slice(0, VISIBLE_REPLIES);
      const ul = h('ul', { class: 'ic-list ic-replies' }, shown.map((i) => renderComment(i.c, childDepth, i)));
      if (!expanded) {
        const hidden = items.length - shown.length;
        ul.append(
          h('li', {}, h('button', {
            type: 'button',
            class: 'ic-more',
            text: hidden === 1 ? '↳ Visualizza 1 altra risposta' : `↳ Visualizza altre ${hidden} risposte`,
            onclick: () => {
              state.expanded.add(c.id);
              renderList();
            },
          }))
        );
      }
      return ul;
    }

    function renderStatus() {
      statusEl.replaceChildren();
      if (state.loading) statusEl.append(h('div', { class: 'ic-state', text: 'Caricamento dei commenti…' }));
      else if (state.error) {
        const text =
          state.errorCode === 'NO_BACKEND'
            ? 'Server dei commenti non configurato: apri il popup dell’estensione e inserisci l’indirizzo del Worker.'
            : state.error;
        statusEl.append(
          h('div', { class: 'ic-state err' }, text, ' ', h('button', { class: 'ic-btn ghost', type: 'button', text: 'Riprova', onclick: () => load() }))
        );
      } else if (!state.comments.some((c) => !c.deleted))
        statusEl.append(h('div', { class: 'ic-empty', text: 'Ancora nessun commento. Scrivi il primo!' }));
    }

    function renderList() {
      const scrollY = window.scrollY;
      const roots = (kids.get(null) || []).filter(isVisible).sort((a, b) => b.createdAt - a.createdAt);
      listEl.replaceChildren(...roots.map((c) => renderComment(c, 0)));
      const n = state.comments.filter((c) => !c.deleted).length;
      countEl.textContent = n ? `(${n})` : '';
      renderStatus();
      if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo({ top: scrollY });
    }

    let top = null;
    let topFor;
    function renderAll() {
      loginEl.replaceChildren();
      if (!state.me && state.errorCode !== 'NO_BACKEND') {
        loginEl.append(
          h(
            'div',
            { class: 'ic-login' },
            h('p', { text: 'Accedi con il tuo profilo Chrome per commentare, rispondere e reagire.' }),
            h('button', { class: 'ic-btn', type: 'button', text: 'Accedi con Chrome', onclick: () => login() })
          )
        );
      }
      const who = state.me?.id || 'anon';
      if (!top || topFor !== who) {
        top = createComposer({ mode: 'new', onSubmit: (data) => postComment(null, data) });
        topFor = who;
        topComposerSlot.replaceChildren(top.el);
      }
      topComposerSlot.hidden = state.errorCode === 'NO_BACKEND';
      renderList();
    }

    renderAll();
    load();

    // aggiornamento periodico e quando si torna sulla scheda
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    const onStorage = (changes, area) => {
      if (area === 'local' && ('me' in changes || 'loggedOut' in changes)) {
        state.me = changes.me ? changes.me.newValue || null : changes.loggedOut?.newValue ? null : state.me;
        renderAll();
        if (state.me) load();
      }
      if (area === 'sync' && 'apiUrl' in changes) load();
    };
    chrome.storage?.onChanged?.addListener(onStorage);

    return {
      host,
      destroy() {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVis);
        chrome.storage?.onChanged?.removeListener(onStorage);
        host.remove();
      },
    };
  }

  function findAnchor() {
    const selectors = ['.detail-info', '#details', '.detail-container', 'main#main-content', '#main-content', 'main', '#main'];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function placeWidget(host) {
    const anchor = findAnchor();
    if (anchor) {
      anchor.append(host);
    } else {
      host.style.cssText = 'display:block;max-width:960px;margin:0 auto;padding:0 16px;';
      document.body.append(host);
    }
  }

  /* ------------------------------------------ contatori nei risultati */

  function initBadges() {
    const pending = new Map(); // listing -> [anchor]
    const counts = new Map();
    let timer;

    function badge(n) {
      return h('span', {
        class: 'ic-badge',
        title: n === 1 ? '1 commento' : `${n} commenti`,
        style:
          'display:inline-flex;align-items:center;gap:4px;margin:4px 0 0 0;padding:2px 9px;border-radius:12px;' +
          'background:#e7f0fd;color:#0f3d78;font:600 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        text: `💬 ${n}`,
      });
    }

    function decorate(listing, anchors) {
      const n = counts.get(listing);
      if (!n) return;
      for (const a of anchors) {
        if (!a.isConnected || a.dataset.icBadged) continue;
        a.dataset.icBadged = '1';
        a.insertAdjacentElement('afterend', badge(n));
      }
    }

    function scan() {
      const seenCards = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        if (a.dataset.icBadged || a.closest('#idealista-commenti')) continue;
        let path;
        try {
          path = new URL(a.href, location.href).pathname;
        } catch {
          continue;
        }
        const listing = listingFromPath(path);
        if (!listing) continue;
        const card = a.closest('article') || a.parentElement;
        // un solo contatore per scheda, preferibilmente sul titolo
        if (card && (seenCards.has(card) || card.querySelector('[data-ic-badged]'))) continue;
        const best = card?.querySelector('a.item-link') || a;
        if (best !== a && listingFromPath(new URL(best.href, location.href).pathname) !== listing) continue;
        if (card) seenCards.add(card);
        if (counts.has(listing)) decorate(listing, [best]);
        else {
          if (!pending.has(listing)) pending.set(listing, []);
          pending.get(listing).push(best);
        }
      }
      flush();
    }

    async function flush() {
      const keys = [...pending.keys()].filter((k) => !counts.has(k));
      while (keys.length) {
        const chunk = keys.splice(0, 100);
        try {
          const data = await bg('getCounts', { listings: chunk });
          for (const k of chunk) counts.set(k, data.counts?.[k] || 0);
        } catch {
          return; // backend non raggiungibile: nessun contatore
        }
        for (const k of chunk) {
          decorate(k, pending.get(k) || []);
          pending.delete(k);
        }
      }
    }

    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 600);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    return { destroy: () => mo.disconnect() };
  }

  /* ------------------------------------------------------------- avvio */

  let widget = null;
  let badges = null;
  let current = null;

  function route() {
    const listing = listingFromPath(here().pathname);
    if (listing === current && (widget || badges)) return;
    current = listing;
    widget?.destroy();
    badges?.destroy();
    widget = badges = null;
    if (listing) {
      widget = mountComments(listing);
      placeWidget(widget.host);
    } else if (country()) {
      badges = initBadges();
    }
  }

  route();
  let lastHref = here().href;
  setInterval(() => {
    if (here().href !== lastHref) {
      lastHref = here().href;
      route();
    }
  }, 1000);
})();
