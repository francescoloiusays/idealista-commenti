(async () => {
  const params = new URLSearchParams(location.search);
  const out = { pass: [], fail: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (cond, name) => (cond ? out.pass : out.fail).push(name);
  const root = () => document.getElementById('idealista-commenti')?.shadowRoot;
  const li = (id) => root().getElementById('ic-' + id);
  const own = (el) => el.querySelector(':scope > .ic-main');
  const btn = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const actBtn = (id, text) => btn(own(li(id)).querySelector(':scope > .ic-actions'), text);
  const type = (ta, text) => { ta.value = text; ta.dispatchEvent(new Event('input')); };
  const enter = (ta) => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const report = () => { document.getElementById('results').textContent = JSON.stringify(out); document.title = out.fail.length ? 'FAIL' : 'PASS'; };

  try {
    await sleep(500);
    ok(!!root(), 'widget montato');
    ok(document.querySelector('.detail-info > #idealista-commenti'), 'inserito in .detail-info');
    ok(root().querySelector('.ic-count').textContent === '(8)', 'conteggio commenti (8)');
    const tops = root().querySelectorAll('.ic > .ic-list > .ic-c');
    ok(tops.length === 4, 'quattro commenti principali (' + tops.length + ')');
    ok(tops[0].id === 'ic-c1', 'ordinati dal più recente');
    ok(!!li('c1r2') && !!li('c1r3'), 'risposte annidate visibili');
    ok(own(li('c1r3')).textContent.includes('in risposta a Giulia Ferri'), 'risposta di 3º livello appiattita con riferimento');
    ok(li('c4').textContent.includes('Commento eliminato'), 'segnaposto commento eliminato');
    ok(li('c4r1').querySelector('.ic-body a')?.href === 'https://www.example.com/condominio', 'link cliccabile');
    ok(own(li('c1')).querySelector('.ic-pill .n').textContent === '5', 'contatore reazioni');
    ok(!!own(li('c2')).querySelector('img.ic-media'), 'GIF mostrata');
    ok(!!actBtn('c3', 'Modifica') && !actBtn('c1', 'Modifica'), 'Modifica solo sui propri commenti');
    ok(li('c1r1').querySelector('.ic-avatar').textContent === 'LM', 'avatar con iniziali senza foto');

    if (params.has('steps')) {
      // reazione rapida
      actBtn('c1', 'Mi piace').click();
      await sleep(80);
      ok(own(li('c1')).querySelector('.ic-pill .n').textContent === '6', 'Mi piace incrementa');
      ok(actBtn('c1', '👍 Mi piace')?.dataset.r === '👍', 'pulsante evidenziato');

      // barra delle reazioni (pressione prolungata/tasto destro)
      const likeC2 = actBtn('c2', 'Mi piace');
      likeC2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const bar = likeC2.parentElement.querySelector('.ic-bar');
      ok(bar.classList.contains('open'), 'barra reazioni aperta');
      btn(bar, '❤️').click();
      await sleep(80);
      ok(actBtn('c2', '❤️ Adoro'), 'reazione ❤️ applicata');

      // risposta
      actBtn('c2', 'Rispondi').click();
      await sleep(30);
      const rta = own(li('c2')).querySelector('.ic-composer textarea');
      ok(!!rta, 'composer di risposta');
      type(rta, 'Concordo, 4.200 €/m² in quella via sono tanti.');
      enter(rta);
      await sleep(120);
      const newReply = own(li('c2')).querySelector('.ic-replies .ic-c');
      ok(newReply?.textContent.includes('4.200 €/m²'), 'risposta pubblicata');

      // modifica
      actBtn('c3', 'Modifica').click();
      await sleep(30);
      const eta = own(li('c3')).querySelector('textarea');
      type(eta, eta.value + ' (aggiornato)');
      enter(eta);
      await sleep(120);
      ok(own(li('c3')).querySelector('.ic-body').textContent.endsWith('(aggiornato)'), 'commento modificato');
      ok(own(li('c3')).textContent.includes('Modificato'), 'etichetta Modificato');

      // eliminazione con conferma
      const rid = newReply.id.slice(3);
      actBtn(rid, 'Elimina').click();
      await sleep(10);
      actBtn(rid, 'Sì, elimina').click();
      await sleep(120);
      ok(!li(rid), 'risposta eliminata');

      // GIF nel composer principale
      const top = root().querySelector('.ic > div > .ic-composer');
      btn(top, 'GIF').click();
      await sleep(150);
      const gifButtons = top.querySelectorAll('.ic-gifgrid button');
      ok(gifButtons.length === 6, 'griglia GIF');
      gifButtons[0].click();
      await sleep(30);
      ok(!!top.querySelector('.ic-attach img'), 'anteprima GIF allegata');
      type(top.querySelector('textarea'), 'Qualcuno ha già fatto un’offerta?');
      top.querySelector('.ic-send').click();
      await sleep(150);
      const first = root().querySelector('.ic > .ic-list > .ic-c');
      ok(first.textContent.includes('offerta') && first.querySelector('img.ic-media'), 'nuovo commento con GIF in cima');
      ok(!top.querySelector('.ic-attach img') && top.querySelector('textarea').value === '', 'composer svuotato');

      // espandi risposte
      const more = [...root().querySelectorAll('.ic-more')];
      ok(more.length === 0 || more.length === 1, 'pulsante "altre risposte" coerente');

      // lascia aperta la barra reazioni per lo screenshot
      if (params.has('bar')) {
        const lb = actBtn(first.id.slice(3), 'Mi piace');
        lb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      }
    }
  } catch (e) {
    out.fail.push('eccezione: ' + e.message + ' ' + e.stack);
  }
  report();
})();
