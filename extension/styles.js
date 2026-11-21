// CSS del widget, iniettato dentro uno Shadow DOM per non interferire con idealista.
globalThis.IC_STYLES = `
:host {
  all: initial;
  display: block;
  --ic-bg: #ffffff;
  --ic-bubble: #f0f2f5;
  --ic-text: #1c1e21;
  --ic-muted: #65676b;
  --ic-line: #e4e6eb;
  --ic-accent: #1b6fd8;
  --ic-accent-soft: #e7f0fd;
  --ic-danger: #c62828;
  --ic-radius: 18px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.35;
  color: var(--ic-text);
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
.ic {
  background: var(--ic-bg);
  border: 1px solid var(--ic-line);
  border-radius: 12px;
  padding: 16px 18px 8px;
  margin: 24px 0;
}
.ic-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ic-title { font-size: 18px; font-weight: 700; margin: 0; }
.ic-count { color: var(--ic-muted); font-weight: 500; }
.ic-head .ic-spacer { flex: 1; }
.ic-iconbtn {
  border: 0; background: transparent; cursor: pointer; color: var(--ic-muted);
  width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 16px;
}
.ic-iconbtn:hover { background: var(--ic-bubble); color: var(--ic-text); }

.ic-login {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 14px;
  background: var(--ic-accent-soft); border-radius: 10px; color: #0f3d78;
}
.ic-login p { margin: 0; flex: 1; }
.ic-btn {
  border: 0; cursor: pointer; border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 14px;
  background: var(--ic-accent); color: #fff;
}
.ic-btn:hover { filter: brightness(1.08); }
.ic-btn:disabled { opacity: .5; cursor: default; filter: none; }
.ic-btn.ghost { background: transparent; color: var(--ic-muted); }
.ic-btn.pulse { animation: ic-pulse .7s ease-in-out 2; }
@keyframes ic-pulse { 50% { transform: scale(1.08); box-shadow: 0 0 0 6px rgba(27,111,216,.18); } }
.ic-btn.ghost:hover { background: var(--ic-bubble); }

.ic-avatar {
  width: 36px; height: 36px; border-radius: 50%; flex: none; object-fit: cover; background: var(--ic-bubble);
  display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; user-select: none;
}
.ic-avatar.sm { width: 30px; height: 30px; font-size: 12px; }

/* composer */
.ic-composer { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 16px; }
.ic-composer.reply { margin: 8px 0 4px; }
.ic-field { flex: 1; min-width: 0; background: var(--ic-bubble); border-radius: var(--ic-radius); padding: 6px 8px 6px 14px; }
.ic-field.drag { outline: 2px dashed var(--ic-accent); }
.ic-row { display: flex; align-items: flex-end; gap: 4px; }
.ic-text {
  flex: 1; border: 0; outline: 0; background: transparent; resize: none; font: inherit; color: inherit;
  padding: 6px 0; min-height: 22px; max-height: 220px; overflow-y: auto; line-height: 1.35;
}
.ic-text::placeholder { color: var(--ic-muted); }
.ic-tool {
  border: 0; background: transparent; cursor: pointer; border-radius: 50%; width: 32px; height: 32px;
  display: grid; place-items: center; color: var(--ic-muted); font-size: 13px; font-weight: 800; flex: none;
}
.ic-tool:hover { background: #e4e6eb; }
.ic-tool.on { color: var(--ic-accent); }
.ic-tool svg { width: 20px; height: 20px; }
.ic-send { color: var(--ic-accent); }
.ic-send:disabled { color: #bcc0c4; cursor: default; background: transparent; }
.ic-hint { font-size: 12px; color: var(--ic-muted); margin: 4px 0 0 14px; }
.ic-hint button { border: 0; background: none; color: var(--ic-accent); cursor: pointer; padding: 0; font-size: 12px; }

.ic-attach { position: relative; display: inline-block; margin: 6px 0 4px; }
.ic-attach img { max-width: 220px; max-height: 180px; border-radius: 10px; display: block; }
.ic-attach .ic-x {
  position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; border: 0; cursor: pointer;
  background: rgba(0,0,0,.65); color: #fff; font-size: 14px; line-height: 24px; padding: 0;
}

/* gif picker */
.ic-gifs { margin-top: 8px; border-top: 1px solid var(--ic-line); padding-top: 8px; }
.ic-gifs input {
  width: 100%; border: 1px solid var(--ic-line); border-radius: 18px; padding: 7px 12px; font: inherit; outline: 0; background: #fff;
}
.ic-gifs input:focus { border-color: var(--ic-accent); }
.ic-gifgrid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; margin-top: 8px;
  max-height: 280px; overflow-y: auto; overscroll-behavior: contain;
}
.ic-gifgrid button { border: 0; padding: 0; background: #ddd; border-radius: 6px; overflow: hidden; cursor: pointer; height: 90px; }
.ic-gifgrid button:hover { outline: 3px solid var(--ic-accent); }
.ic-gifgrid img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ic-gifs-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11px; color: var(--ic-muted); }
.ic-gifs-foot b { letter-spacing: .04em; color: #000; }
.ic-gifs-msg { grid-column: 1 / -1; color: var(--ic-muted); font-size: 13px; padding: 12px 0; text-align: center; }

/* comments */
.ic-list { list-style: none; margin: 0; padding: 0; }
.ic-c { display: flex; gap: 8px; margin: 0 0 10px; }
.ic-main { flex: 1; min-width: 0; }
.ic-bubble-wrap { display: flex; align-items: flex-end; gap: 6px; max-width: 100%; }
.ic-bubble {
  display: inline-block; background: var(--ic-bubble); border-radius: var(--ic-radius); padding: 8px 12px;
  max-width: 100%; overflow-wrap: anywhere; position: relative;
}
.ic-bubble.deleted { font-style: italic; color: var(--ic-muted); }
.ic-name { font-weight: 600; font-size: 13px; display: block; }
.ic-body { white-space: pre-wrap; margin-top: 1px; }
.ic-body a { color: var(--ic-accent); }
.ic-media { display: block; margin-top: 6px; max-width: min(320px, 100%); max-height: 320px; border-radius: 12px; cursor: zoom-in; }
.ic-replyto { font-size: 12px; color: var(--ic-muted); margin-bottom: 2px; }

.ic-pill {
  display: inline-flex; align-items: center; gap: 2px; background: #fff; border-radius: 12px; padding: 1px 6px 1px 3px;
  box-shadow: 0 1px 3px rgba(0,0,0,.2); font-size: 12px; color: var(--ic-muted); white-space: nowrap; margin-bottom: -6px;
  cursor: default;
}
.ic-pill span.e { font-size: 14px; margin-right: -2px; }
.ic-pill span.n { margin-left: 5px; }

.ic-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; margin: 3px 0 0 12px; font-size: 12px; color: var(--ic-muted); }
.ic-act { border: 0; background: none; padding: 0; cursor: pointer; font-weight: 700; color: var(--ic-muted); font-size: 12px; }
.ic-act:hover { text-decoration: underline; }
.ic-act[data-r="👍"] { color: #1b6fd8; }
.ic-act[data-r="❤️"] { color: #e0245e; }
.ic-act[data-r="😂"], .ic-act[data-r="😮"], .ic-act[data-r="😢"] { color: #e8a317; }
.ic-act[data-r="😡"] { color: #e9710f; }
.ic-time { color: var(--ic-muted); }
.ic-edited { font-style: italic; }

.ic-react { position: relative; display: inline-block; }
.ic-bar {
  position: absolute; bottom: calc(100% + 6px); left: -8px; z-index: 5; display: flex; gap: 2px; padding: 4px 6px;
  background: #fff; border-radius: 26px; box-shadow: 0 2px 12px rgba(0,0,0,.22); opacity: 0; pointer-events: none;
  transform: translateY(6px) scale(.9); transform-origin: bottom left; transition: opacity .15s, transform .15s;
}
.ic-bar.open { opacity: 1; pointer-events: auto; transform: none; }
.ic-bar button {
  border: 0; background: none; cursor: pointer; font-size: 26px; width: 38px; height: 38px; padding: 0; border-radius: 50%;
  transition: transform .12s; line-height: 38px;
}
.ic-bar button:hover, .ic-bar button:focus-visible { transform: scale(1.3) translateY(-4px); outline: 0; }
.ic-bar button.mine { background: var(--ic-accent-soft); }

.ic-replies { margin-top: 8px; }
.ic-replies .ic-replies { margin-left: 0; }
.ic-more { border: 0; background: none; cursor: pointer; color: var(--ic-muted); font-weight: 700; font-size: 13px; padding: 2px 0 8px; }
.ic-more:hover { text-decoration: underline; }

.ic-empty, .ic-state { color: var(--ic-muted); text-align: center; padding: 18px 0 14px; font-size: 14px; }
.ic-state.err { color: var(--ic-danger); }
.ic-toast {
  position: sticky; bottom: 8px; margin: 8px auto 0; width: fit-content; max-width: 100%; background: #323232; color: #fff;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 10;
}
.ic-foot { font-size: 11px; color: var(--ic-muted); text-align: right; padding: 4px 0 6px; }

.ic-lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,.85); display: grid; place-items: center; z-index: 2147483647; cursor: zoom-out;
}
.ic-lightbox img { max-width: 92vw; max-height: 92vh; border-radius: 6px; }

@media (max-width: 600px) {
  .ic { padding: 12px 10px 6px; border-radius: 0; border-left: 0; border-right: 0; }
  .ic-media { max-width: 100%; }
}
`;
