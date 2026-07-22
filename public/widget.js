(function () {
  var cfg = {
    business: document.currentScript.getAttribute('data-business') || 'NeoWeb Studio',
    welcome: document.currentScript.getAttribute('data-welcome') || '¡Hola! Soy el asistente virtual. ¿En qué puedo ayudarte?',
    primary: document.currentScript.getAttribute('data-primary') || '#2563eb',
    apiUrl: document.currentScript.getAttribute('data-api-url') || '/api/webhook',
  };

  var visitorId = localStorage.getItem('nw_visitor_id');
  if (!visitorId) {
    visitorId = 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('nw_visitor_id', visitorId);
  }

  var state = { messages: [], isOpen: false };

  var styles = document.createElement('style');
  styles.textContent =
    '#nw-chat *{box-sizing:border-box;margin:0;padding:0}' +
    '#nw-chat{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1f2937}' +
    '#nw-btn{position:fixed;bottom:24px;right:24px;z-index:999999;width:60px;height:60px;border-radius:50%;background:' + cfg.primary + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:transform .2s,box-shadow .2s}' +
    '#nw-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,0,0,0.25)}' +
    '#nw-btn svg{width:28px;height:28px;fill:#fff}' +
    '#nw-panel{position:fixed;bottom:96px;right:24px;z-index:999998;width:380px;height:560px;max-height:calc(100vh - 140px);background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.18);display:none;flex-direction:column;overflow:hidden;animation:nwSlide .25s ease}' +
    '@keyframes nwSlide{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}' +
    '#nw-header{padding:16px 20px;background:' + cfg.primary + ';color:#fff;display:flex;align-items:center;gap:12px;flex-shrink:0}' +
    '#nw-header-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:16px}' +
    '#nw-header-text{flex:1}' +
    '#nw-header-title{font-weight:600;font-size:15px}' +
    '#nw-header-status{font-size:12px;opacity:.85}' +
    '#nw-close{background:none;border:none;color:#fff;cursor:pointer;padding:4px;opacity:.8;transition:opacity .2s}' +
    '#nw-close:hover{opacity:1}' +
    '#nw-close svg{width:20px;height:20px;fill:#fff}' +
    '#nw-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#f8fafc}' +
    '#nw-messages::-webkit-scrollbar{width:5px}' +
    '#nw-messages::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}' +
    '.nw-msg{max-width:85%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;word-wrap:break-word;animation:nwMsgIn .25s ease}' +
    '@keyframes nwMsgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
    '.nw-msg-bot{align-self:flex-start;background:#e2e8f0;color:#1e293b;border-bottom-left-radius:4px}' +
    '.nw-msg-user{align-self:flex-end;background:' + cfg.primary + ';color:#fff;border-bottom-right-radius:4px}' +
    '.nw-msg-time{font-size:10px;opacity:.6;margin-top:4px}' +
    '.nw-msg-bot .nw-msg-time{text-align:left}' +
    '.nw-msg-user .nw-msg-time{text-align:right}' +
    '#nw-typing{align-self:flex-start;background:#e2e8f0;padding:12px 16px;border-radius:14px;border-bottom-left-radius:4px;display:none;gap:4px}' +
    '#nw-typing span{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:nwBounce 1.2s ease-in-out infinite}' +
    '#nw-typing span:nth-child(2){animation-delay:.2s}' +
    '#nw-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes nwBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}' +
    '#nw-footer{padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff;flex-shrink:0}' +
    '#nw-input{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;font-size:14px;outline:none;transition:border .2s}' +
    '#nw-input:focus{border-color:' + cfg.primary + '}' +
    '#nw-send{width:40px;height:40px;border-radius:10px;background:' + cfg.primary + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .2s;flex-shrink:0}' +
    '#nw-send:disabled{opacity:.5;cursor:not-allowed}' +
    '#nw-send svg{width:18px;height:18px;fill:#fff}' +
    '@media(max-width:480px){' +
    '#nw-panel{right:12px;left:12px;width:auto;bottom:80px;max-height:calc(100vh - 100px);border-radius:12px}' +
    '#nw-btn{right:16px;bottom:16px}}';

  document.head.appendChild(styles);

  var btn = document.createElement('div'); btn.id = 'nw-chat';
  btn.innerHTML =
    '<button id="nw-btn" aria-label="Abrir chat">' +
    '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h7v2H7z"/></svg>' +
    '</button>' +
    '<div id="nw-panel">' +
    '<div id="nw-header">' +
    '<div id="nw-header-avatar">🤖</div>' +
    '<div id="nw-header-text">' +
    '<div id="nw-header-title">' + cfg.business + '</div>' +
    '<div id="nw-header-status">En línea</div>' +
    '</div>' +
    '<button id="nw-close" aria-label="Cerrar">' +
    '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
    '</button>' +
    '</div>' +
    '<div id="nw-messages"></div>' +
    '<div id="nw-typing"><span></span><span></span><span></span></div>' +
    '<div id="nw-footer">' +
    '<input id="nw-input" placeholder="Escribe un mensaje..." />' +
    '<button id="nw-send" aria-label="Enviar"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(btn);

  var panel = document.getElementById('nw-panel');
  var messagesEl = document.getElementById('nw-messages');
  var input = document.getElementById('nw-input');
  var sendBtn = document.getElementById('nw-send');
  var typingEl = document.getElementById('nw-typing');
  var triggerBtn = document.getElementById('nw-btn');

  function formatTime() { return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }

  function addMessage(text, role) {
    var div = document.createElement('div');
    div.className = 'nw-msg nw-msg-' + role;
    div.innerHTML = text.replace(/\n/g, '<br>') + '<div class="nw-msg-time">' + formatTime() + '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    state.messages.push({ role: role, text: text });
  }

  function setTyping(show) { typingEl.style.display = show ? 'flex' : 'none'; messagesEl.scrollTop = messagesEl.scrollHeight; }

  function sendMessage() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMessage(text, 'user');
    sendBtn.disabled = true;
    setTyping(true);

    fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, from: visitorId, channel: 'web' })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Error ' + res.status);
      return res.json();
    })
    .then(function (data) {
      setTyping(false);
      sendBtn.disabled = false;
      addMessage(data.reply || data.message || 'Gracias por tu mensaje.', 'bot');
    })
    .catch(function () {
      setTyping(false);
      sendBtn.disabled = false;
      addMessage('Lo siento, hubo un error. Por favor intenta de nuevo.', 'bot');
    });
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  triggerBtn.addEventListener('click', function () {
    state.isOpen = !state.isOpen;
    panel.style.display = state.isOpen ? 'flex' : 'none';
    if (state.isOpen) {
      if (state.messages.length === 0) {
        addMessage(cfg.welcome, 'bot');
        scrollToBottom();
      }
      input.focus();
    }
  });

  document.getElementById('nw-close').addEventListener('click', function () {
    state.isOpen = false;
    panel.style.display = 'none';
  });

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });
})();
