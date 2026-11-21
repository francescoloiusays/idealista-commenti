const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) {
        const e = new Error(res?.error || 'Errore');
        e.code = res?.code;
        return reject(e);
      }
      resolve(res.data);
    });
  });
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

function msg(text, kind = '') {
  $('msg').textContent = text;
  $('msg').className = 'msg ' + kind;
}

async function renderUser() {
  const box = $('user');
  let user = null;
  let error = null;
  try {
    ({ user } = await send('me'));
  } catch (e) {
    error = e;
  }
  box.replaceChildren();
  if (user) {
    const pic = user.picture ? el('img', { src: user.picture, alt: '', referrerpolicy: 'no-referrer' }) : el('div', { class: 'ph' });
    box.append(
      pic,
      el('div', { class: 'grow' }, el('div', { class: 'name', text: user.name }), el('div', { class: 'sub', text: 'Commenti con il tuo profilo Chrome' })),
      el('button', {
        class: 'ghost',
        text: 'Esci',
        onclick: async () => {
          await send('logout');
          renderUser();
        },
      })
    );
  } else {
    const sub =
      error?.code === 'NO_BACKEND'
        ? 'Prima imposta l’indirizzo del server qui sotto.'
        : error
          ? error.message
          : 'Accedi per commentare gli annunci.';
    box.append(
      el('div', { class: 'ph' }),
      el('div', { class: 'grow' }, el('div', { class: 'name', text: 'Non hai effettuato l’accesso' }), el('div', { class: 'sub', text: sub })),
      el('button', {
        text: 'Accedi',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            await send('login');
          } catch (e) {
            msg(e.message, 'err');
            $('adv').open = true;
          }
          renderUser();
        },
      })
    );
    if (error?.code === 'NO_BACKEND') $('adv').open = true;
  }
}

async function init() {
  const cfg = await send('getConfig');
  $('api').value = /INSERISCI/.test(cfg.apiUrl) ? '' : cfg.apiUrl;
  $('extid').textContent = cfg.extensionId;

  $('save').addEventListener('click', async () => {
    try {
      const { apiUrl } = await send('setConfig', { apiUrl: $('api').value });
      $('api').value = apiUrl;
      msg('Salvato', 'ok');
      renderUser();
    } catch (e) {
      msg(e.message, 'err');
    }
  });
  $('test').addEventListener('click', async () => {
    msg('Verifica in corso…');
    try {
      await send('setConfig', { apiUrl: $('api').value });
      await send('ping');
      msg('Il server risponde correttamente ✓', 'ok');
    } catch (e) {
      msg(e.message, 'err');
    }
  });
  renderUser();
}

init();
