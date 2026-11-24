/* Aviso de cookies + Google Tag Manager da V4 (decisão Luís, 24/11/2026).
   A Política de Privacidade (item 7) promete pedir a escolha do visitante antes de
   medição e publicidade. Por isso o contêiner da V4 só carrega DEPOIS de "Aceitar"
   (modo de consentimento básico do Google): quem recusa ou ignora o aviso não é
   rastreado, qualquer que seja a configuração das tags dentro do GTM.
   A escolha fica neste navegador; "Cookies" no rodapé reabre o aviso.
   Subir VERSAO pede a escolha de novo (ex.: a política mudou o que é coletado). */
(function () {
  'use strict';
  var GTM_ID = 'GTM-WNKWFZ32';
  var CHAVE = 'azit-cookies';
  var VERSAO = 1;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // Tudo negado até o visitante escolher (Consent Mode v2).
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
    functionality_storage: 'granted', security_storage: 'granted',
  });

  function lerEscolha() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      return v && v.v === VERSAO ? v.escolha : null;
    } catch (e) { return null; }
  }
  function gravarEscolha(escolha) {
    try { localStorage.setItem(CHAVE, JSON.stringify({ v: VERSAO, escolha: escolha, em: new Date().toISOString() })); } catch (e) { /* sem armazenamento: o aviso volta na próxima visita */ }
  }

  var gtmCarregado = false;
  function carregarGtm() {
    if (gtmCarregado) return;
    gtmCarregado = true;
    gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
    // Código enviado pela V4, mais o evento gtm.js do instalador padrão do GTM
    // (é ele que dispara os acionadores "Todas as páginas").
    gtag('js', new Date());
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(s);
  }

  // ---------- aviso ----------
  var CSS =
    '.ck{position:fixed;left:max(16px,env(safe-area-inset-left,0px));right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;max-width:560px;' +
    'background:#070f1c;color:#c6d1df;border:1px solid #1d2c44;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px 18px;' +
    "font-family:'Manrope',system-ui,sans-serif;font-size:14.5px;line-height:1.5}" +
    ".ck b{color:#fff;font-family:'Outfit',system-ui,sans-serif;font-size:16px;display:block;margin-bottom:4px}" +
    '.ck a{color:#fa8e0d}' +
    '.ck .ck-acoes{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}' +
    ".ck button{font-family:'Outfit',system-ui,sans-serif;font-weight:700;font-size:15px;border-radius:10px;padding:10px 18px;cursor:pointer}" +
    '.ck .ck-sim{background:#fa8e0d;color:#001029;border:0}' +
    '.ck .ck-nao{background:transparent;color:#fff;border:1.5px solid #7f93ab}' +
    '.ck button:focus-visible{outline:2px solid #fff;outline-offset:2px}';

  var aviso = null;
  function fecharAviso() { if (aviso) { aviso.remove(); aviso = null; } }
  function mostrarAviso() {
    if (aviso) return;
    if (!document.getElementById('ck-css')) {
      var st = document.createElement('style');
      st.id = 'ck-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    aviso = document.createElement('div');
    aviso.className = 'ck';
    aviso.setAttribute('role', 'region');
    aviso.setAttribute('aria-label', 'Aviso de cookies');
    aviso.innerHTML =
      '<b>Você escolhe sobre os cookies</b>' +
      'Com a sua permissão, o site usa cookies do Google e da Meta para medir as visitas e mostrar anúncios da Azit. ' +
      'Sem ela, o site funciona igual. Veja a <a href="/privacidade/#cookies">Política de Privacidade</a>.' +
      '<div class="ck-acoes"><button type="button" class="ck-sim">Aceitar</button><button type="button" class="ck-nao">Recusar</button></div>';
    aviso.querySelector('.ck-sim').addEventListener('click', function () {
      gravarEscolha('aceito');
      fecharAviso();
      carregarGtm();
    });
    aviso.querySelector('.ck-nao').addEventListener('click', function () {
      var tinhaCarregado = gtmCarregado;
      gravarEscolha('recusado');
      fecharAviso();
      // Retirada do consentimento: recarrega para a página voltar sem o GTM.
      if (tinhaCarregado) location.reload();
    });
    document.body.appendChild(aviso);
  }

  function iniciar() {
    var escolha = lerEscolha();
    if (escolha === 'aceito') carregarGtm();
    else if (escolha !== 'recusado') mostrarAviso();
    // Link "Cookies" do rodapé: reabre o aviso para mudar a escolha.
    document.querySelectorAll('[data-cookies]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); mostrarAviso(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
