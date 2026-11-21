// Finto ambiente chrome.* + backend in memoria, per provare il content script senza estensione.
(() => {
  const now = Date.now();
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  const svg = (w, h, body) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
  const face = (bg, fg) => svg(80, 80, `<rect width="80" height="80" fill="${bg}"/><circle cx="40" cy="32" r="15" fill="${fg}"/><ellipse cx="40" cy="78" rx="27" ry="22" fill="${fg}"/>`);
  const gif = (bg, t) => svg(240, 160, `<rect width="240" height="160" rx="0" fill="${bg}"/><text x="120" y="95" font-size="54" text-anchor="middle">${t}</text>`);
  const plan = svg(420, 280, `<rect width="420" height="280" fill="#fafaf7"/><g fill="none" stroke="#333" stroke-width="5"><rect x="20" y="20" width="380" height="240"/><path d="M200 20v130M20 150h120M180 150h220M300 150v110"/></g><g font-family="sans-serif" font-size="15" fill="#555"><text x="60" y="90">Soggiorno 24 m²</text><text x="250" y="90">Camera 14 m²</text><text x="60" y="215">Cucina</text><text x="215" y="215">Bagno</text><text x="320" y="215">Camera</text></g>`);

  const me = { id: 'u-me', name: 'Francesco L.', picture: face('#cfe0fb', '#1b6fd8') };
  const U = {
    giulia: { id: 'u1', name: 'Giulia Ferri', picture: face('#fde2d6', '#d9643a') },
    luca: { id: 'u2', name: 'Luca Moretti', picture: null },
    marco: { id: 'u3', name: 'Marco Esposito', picture: face('#dcf2e3', '#2e8b57') },
    paolo: { id: 'u4', name: 'Paolo Rinaldi', picture: face('#ece2fb', '#7b4bc4') },
    sara: { id: 'u5', name: 'Sara Colombo', picture: null },
  };
  let seq = 100;
  const C = (id, user, text, ago, extra = {}) => ({ id, parentId: null, user, text, gifUrl: null, imageUrl: null, createdAt: now - ago, editedAt: null, deleted: false, reactions: {}, myReaction: null, ...extra });
  const comments = [
    C('c1', U.giulia, 'Sono andata a vederla sabato: luminosissima, ma il bagno è da rifare completamente. L’agenzia dice che il prezzo è trattabile.', 2 * hour, { reactions: { '👍': 4, '❤️': 1 } }),
    C('c1r1', U.luca, 'Quanto chiedono di spese condominiali?', 95 * min, { parentId: 'c1' }),
    C('c1r2', U.giulia, '180 €/mese con riscaldamento centralizzato incluso.', 80 * min, { parentId: 'c1r1', reactions: { '😮': 2 } }),
    C('c1r3', U.marco, 'Un po’ alte per la zona, al civico 12 sono 120.', 40 * min, { parentId: 'c1r2' }),
    C('c1r4', U.sara, 'Confermo, anche noi l’abbiamo vista: il box è minuscolo.', 25 * min, { parentId: 'c1' }),
    C('c2', U.paolo, 'Io dopo aver visto il prezzo al metro quadro:', 1 * day, { gifUrl: gif('#ffe08a', '😱'), reactions: { '😂': 6, '👍': 1 } }),
    C('c3', me, 'Mi hanno mandato la planimetria, la seconda camera è più piccola di quanto sembra dalle foto.', 3 * day, { imageUrl: plan, reactions: { '👍': 2 } }),
    C('c4', null, '', 5 * day, { deleted: true }),
    C('c4r1', U.sara, 'Qualcuno sa se l’ascensore è stato rifatto? https://www.example.com/condominio', 4 * day, { parentId: 'c4' }),
  ];
  const gifs = [['#ffd6e0', '🏠'], ['#d6f5ff', '🔑'], ['#e8ffd6', '🎉'], ['#fff0c2', '💸'], ['#f0e0ff', '😍'], ['#ffe1c2', '📦']].map(([b, t], i) => ({ id: 'g' + i, title: 'GIF ' + t, url: gif(b, t), preview: gif(b, t) }));

  const loggedIn = !new URLSearchParams(location.search).has('anon');
  window.__mock = { comments, me, calls: [] };
  const handlers = {
    getComments: () => ({ listing: 'it:34567890', comments: structuredClone(comments), me: loggedIn ? me : null }),
    getCounts: ({ listings }) => ({ counts: Object.fromEntries(listings.map((l, i) => [l, [3, 0, 12, 1][i % 4]])) }),
    postComment: ({ parentId, text, gifUrl, imageKey }) => {
      const c = C('n' + seq++, me, text, 0, { parentId: parentId || null, gifUrl: gifUrl || null, imageUrl: imageKey ? plan : null });
      comments.push(c);
      return { comment: structuredClone(c) };
    },
    editComment: ({ id, text }) => {
      const c = comments.find((x) => x.id === id);
      c.text = text;
      c.editedAt = Date.now();
      return { comment: structuredClone(c) };
    },
    deleteComment: ({ id }) => {
      Object.assign(comments.find((x) => x.id === id), { deleted: true, text: '', user: null, gifUrl: null, imageUrl: null });
      return { ok: true };
    },
    react: ({ id, emoji }) => {
      const c = comments.find((x) => x.id === id);
      if (c.myReaction) c.reactions[c.myReaction]--;
      if (emoji) c.reactions[emoji] = (c.reactions[emoji] || 0) + 1;
      for (const k in c.reactions) if (!c.reactions[k]) delete c.reactions[k];
      c.myReaction = emoji;
      return { reactions: { ...c.reactions }, myReaction: emoji };
    },
    upload: () => ({ key: '00000000-0000-0000-0000-000000000000.webp' }),
    gifs: ({ q }) => ({ gifs: q === 'nulla' ? [] : gifs, nextOffset: 24 }),
    login: () => ({ user: me }),
    fetchImage: ({ url }) => ({ dataUrl: url }),
  };
  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        window.__mock.calls.push(msg.type);
        setTimeout(() => {
          try {
            cb({ ok: true, data: handlers[msg.type](msg) });
          } catch (e) {
            cb({ ok: false, error: e.message });
          }
        }, 15);
      },
    },
    storage: { onChanged: { addListener() {}, removeListener() {} } },
  };
})();
