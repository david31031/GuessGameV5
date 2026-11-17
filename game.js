(() => {
  'use strict';

  /* ---------- Config ---------- */
  const WIN = 10;
  const MAX_GUESSES = 3;
  const PEER_PREFIX = 'guess-qm-game-';
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const PEER_OPTS = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
          username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    }
  };

  const WORDS = [
    'Storm','Pizza','Dragon','Pirate','Volcano','Rainbow','Robot','Castle','Jungle','Astronaut',
    'Banana','Penguin','Guitar','Tornado','Snowman','Mermaid','Zombie','Ice Cream','Rocket','Wizard',
    'Camera','Elephant','Library','Lighthouse','Magnet','Sandwich','Dinosaur','Umbrella','Pyramid','Submarine',
    'Birthday','Football','Spider','Ninja','Treasure','Waterfall','Diamond','Skeleton','Popcorn','Balloon',
    'Fireworks','Detective','Vampire','Chocolate','Telescope','Cactus','Octopus','Parachute','Bicycle','Hurricane',
    'Kangaroo','Pancake','Compass','Scarecrow','Unicorn','Lightning','Campfire','Sunglasses','Skateboard','Honey',
    'Mountain','Giraffe','Candle','Ghost','Tractor','Surfing','Donut','Igloo','Superhero','Mirror',
    'Thunder','Cinema','Passport','Shark','Whale','Pumpkin','Fountain','Marathon','Hamburger','Piano',
    'Sunrise','Desert','Island','Circus','Clown','Lollipop','Taxi','Wedding','Earthquake','Jellyfish'
  ];

  /* ---------- Helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const EMOJI_RE = /(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:[\uFE0F\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*)/gu;

  function parseClue(text, secret) {
    text = String(text || '').normalize('NFC');
    const emojis = text.match(EMOJI_RE) || [];
    const rest = text.replace(EMOJI_RE, ' ').replace(/[\uFE0F\u200D]/g, '');
    const words = rest.split(/[\s,;.!?]+/).filter(Boolean);
    let error = null;
    if (!words.length && !emojis.length) error = 'Enter a clue.';
    else if (words.length > 3) error = 'Max 3 words!';
    else if (emojis.length > 3) error = 'Max 3 emojis!';
    else if (secret) {
      const s = norm(secret);
      const flat = s.replace(/\s/g, '');
      if (words.some((w) => norm(w).replace(/\s/g, '').includes(flat))) {
        error = "Don't use the secret word!";
      }
    }
    return { words, emojis, error };
  }

  function genCode() {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    return c;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  function showScreen(name) {
    ['home', 'wait', 'game'].forEach((s) => $('screen-' + s).classList.toggle('hidden', s !== name));
  }

  /* ---------- Networking state ---------- */
  let peer = null;
  let conn = null;
  let isHost = false;
  let myIdx = 0;
  let myName = '';
  let roomCode = '';
  let guestName = '';
  let state = null;   // host only: full authoritative state
  let view = null;    // what this device renders
  let lastKey = '';
  let usedWords = new Set();
  let connectTimer = null;

  function getName() {
    const n = $('nameInput').value.trim().slice(0, 16);
    if (!n) {
      $('homeMsg').textContent = 'Please enter your name first.';
      $('nameInput').focus();
      return null;
    }
    return n;
  }

  function resetNet() {
    clearTimeout(connectTimer);
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null; conn = null; state = null; view = null; lastKey = '';
  }

  /* ---------- Create room (host) ---------- */
  function createRoom(attempt = 0) {
    if (attempt === 0) {
      const n = getName(); if (!n) return;
      myName = n; isHost = true; myIdx = 0;
      $('homeMsg').textContent = '';
      resetNet();
    }
    roomCode = genCode();
    peer = new Peer(PEER_PREFIX + roomCode, PEER_OPTS);

    peer.on('open', () => {
      $('bigCode').textContent = roomCode;
      $('waitText').textContent = 'Waiting for Player 2 to join…';
      showScreen('wait');
      keepAwake();
    });

    peer.on('disconnected', () => {            // lost the signalling server -> room would vanish; reconnect
      try { if (peer && !peer.destroyed) peer.reconnect(); } catch (e) {}
    });

    peer.on('connection', (c) => {
      if (conn && conn.open) {               // strictly 2 players per room
        c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); });
        return;
      }
      conn = c;
      attachConn();
    });

    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && attempt < 6) {
        try { peer.destroy(); } catch (_) {}
        createRoom(attempt + 1);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        try { if (peer && !peer.destroyed) peer.reconnect(); } catch (_) {}
      } else {
        resetNet();
        showScreen('home');
        $('homeMsg').textContent = 'Connection problem (' + e.type + '). Please try again.';
      }
    });
  }

  /* ---------- Join room (guest) ---------- */
  function joinRoom() {
    const n = getName(); if (!n) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeMsg').textContent = 'Enter the 4-letter room code.'; return; }
    myName = n; isHost = false; myIdx = 1; roomCode = code;
    $('homeMsg').textContent = 'Connecting…';
    resetNet();

    let tries = 0;
    const MAX_TRIES = 4;
    const tryConnect = () => {
      tries++;
      clearTimeout(connectTimer);
      try { if (conn) conn.close(); } catch (e) {}
      conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      attachConn();
      connectTimer = setTimeout(() => {
        if (conn && conn.open) return;
        if (tries < MAX_TRIES) { $('homeMsg').textContent = 'Still trying… (' + tries + '/' + MAX_TRIES + ')'; tryConnect(); }
        else {
          resetNet();
          $('homeMsg').textContent = "Couldn't connect. Ask the host to keep the game open with the screen on, then try again.";
        }
      }, 9000);
    };

    peer = new Peer(undefined, PEER_OPTS);
    peer.on('open', tryConnect);
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable' && peer && !peer.destroyed && tries < MAX_TRIES) {
        $('homeMsg').textContent = 'Looking for room ' + code + '… (' + tries + '/' + MAX_TRIES + ')';
        clearTimeout(connectTimer);
        connectTimer = setTimeout(tryConnect, 2500);
        return;
      }
      resetNet();
      showScreen('home');
      $('homeMsg').textContent = e.type === 'peer-unavailable'
        ? 'Room not found. Check the code, and make sure the host is still on the "Waiting for Player 2" screen.'
        : 'Connection problem (' + e.type + '). Please try again.';
    });
  }

  function attachConn() {
    conn.on('open', () => {
      clearTimeout(connectTimer);
      if (!isHost) conn.send({ t: 'hello', name: myName });
    });
    conn.on('data', onData);
    conn.on('close', onClose);
    conn.on('error', () => onClose());
  }

  function onClose() {
    if (!view && !isHost) return;
    if (!view && isHost) { conn = null; return; } // guest left before match started
    toast('Your opponent disconnected.');
    setTimeout(() => location.reload(), 2200);
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (isHost) {
      if (msg.t === 'hello') {
        guestName = String(msg.name || 'Player 2').slice(0, 16);
        if (norm(guestName) === norm(myName)) guestName += ' (2)';
        newMatch();
      } else if (state) {
        handle(1, msg);
      }
    } else {
      if (msg.t === 'state') { view = msg.view; render(); }
      else if (msg.t === 'err') toast(msg.text);
      else if (msg.t === 'full') {
        resetNet(); showScreen('home');
        $('homeMsg').textContent = 'That room is already full.';
      }
    }
  }

  function send(msg) {
    if (isHost) handle(0, msg);
    else if (conn && conn.open) conn.send(msg);
  }

  /* ---------- Host: authoritative game logic ---------- */
  function pickWord() {
    if (usedWords.size >= WORDS.length) usedWords.clear();
    let w, tries = 0;
    do { w = WORDS[Math.floor(Math.random() * WORDS.length)]; tries++; }
    while (usedWords.has(w) && tries < 200);
    return w;
  }

  function newMatch() {
    usedWords = new Set();
    const w = pickWord(); usedWords.add(w);
    state = {
      phase: 'clue', names: [myName, guestName], scores: [0, 0], giver: 0,
      secret: w, clue: null, left: MAX_GUESSES, wrong: [], round: 1, result: null, winner: null
    };
    broadcast();
  }

  function viewFor(idx) {
    const v = JSON.parse(JSON.stringify(state));
    const reveal = v.phase === 'reveal' || v.phase === 'over';
    if (idx !== v.giver && !reveal) v.secret = null; // guesser must never receive the word
    return v;
  }

  function broadcast() {
    view = viewFor(0);
    render();
    if (conn && conn.open) conn.send({ t: 'state', view: viewFor(1) });
  }

  function sendErr(idx, text) {
    if (idx === 0) toast(text);
    else if (conn && conn.open) conn.send({ t: 'err', text });
  }

  function endRound() {
    state.phase = 'reveal';
    const [a, b] = state.scores;
    if ((a >= WIN || b >= WIN) && a !== b) {
      state.phase = 'over';
      state.winner = a > b ? 0 : 1;
    }
    broadcast();
  }

  function handle(idx, msg) {
    if (!state) return;
    const giver = state.giver;
    switch (msg.t) {
      case 'reroll':
        if (state.phase === 'clue' && idx === giver) {
          const w = pickWord(); usedWords.add(w);
          state.secret = w;
          broadcast();
        }
        break;

      case 'clue': {
        if (state.phase !== 'clue' || idx !== giver) return;
        const p = parseClue(msg.text, state.secret);
        if (p.error) return sendErr(idx, p.error);
        state.clue = { words: p.words, emojis: p.emojis };
        state.phase = 'guess';
        state.left = MAX_GUESSES;
        state.wrong = [];
        broadcast();
        break;
      }

      case 'guess': {
        if (state.phase !== 'guess' || idx === giver) return;
        const g = norm(msg.text);
        if (!g) return;
        if (g === norm(state.secret)) {
          const pts = state.left;               // 3, 2 or 1
          state.scores[idx] += pts;
          state.result = { correct: true, by: idx, pts };
          endRound();
        } else {
          state.wrong.push(String(msg.text).trim().slice(0, 30));
          state.left--;
          if (state.left <= 0) {
            state.scores[giver] += 3;               // guesser failed: clue-giver gets 3
            state.result = { correct: false, pts: 3 };
            endRound();
          } else broadcast();
        }
        break;
      }

      case 'next':
        if (state.phase !== 'reveal') return;
        state.round++;
        state.giver = 1 - state.giver;
        { const w = pickWord(); usedWords.add(w); state.secret = w; }
        state.clue = null; state.wrong = []; state.left = MAX_GUESSES; state.result = null;
        state.phase = 'clue';
        broadcast();
        break;

      case 'rematch':
        if (state.phase === 'over') newMatch();
        break;
    }
  }

  /* ---------- Rendering ---------- */
  function renderClue(el, clue) {
    el.textContent = '';
    if (!clue) return;
    clue.words.forEach((w) => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = w; el.appendChild(s); });
    clue.emojis.forEach((e) => { const s = document.createElement('span'); s.className = 'chip emoji'; s.textContent = e; el.appendChild(s); });
  }

  function renderPips(el, left) {
    el.textContent = '';
    for (let i = 0; i < MAX_GUESSES; i++) {
      const p = document.createElement('span');
      p.className = 'pip' + (i >= left ? ' used' : '');
      el.appendChild(p);
    }
  }

  function renderWrong(el, wrong) {
    el.textContent = '';
    wrong.forEach((w) => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = w; el.appendChild(s); });
  }

  function chancesText(n) { return n + (n === 1 ? ' chance left' : ' chances left'); }

  function render() {
    const v = view;
    if (!v) return;
    showScreen('game');
    $('roomTag').textContent = roomCode;
    $('roundTag').textContent = 'Round ' + v.round;

    for (let i = 0; i < 2; i++) {
      $('name' + i).textContent = v.names[i] + (i === myIdx ? ' (you)' : '');
      $('score' + i).textContent = v.scores[i];
      $('bar' + i).style.width = Math.min(100, (v.scores[i] / WIN) * 100) + '%';
      $('role' + i).textContent = (v.phase === 'over') ? '' : (i === v.giver ? '💡 Clue-giver' : '🔍 Guesser');
      $('card' + i).classList.toggle('me', i === myIdx);
    }

    const key = v.round + ':' + v.phase;
    if (key !== lastKey) {
      lastKey = key;
      $('clueInput').value = '';
      $('guessInput').value = '';
      updateClueCounter();
    }

    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    const iAmGiver = myIdx === v.giver;
    const giverName = v.names[v.giver];
    const guesserName = v.names[1 - v.giver];

    if (v.phase === 'clue') {
      if (iAmGiver) {
        $('pClueGive').classList.remove('hidden');
        $('secretWord1').textContent = v.secret;
        updateClueCounter();
      } else {
        $('pClueWait').classList.remove('hidden');
        $('waitClueText').textContent = 'Waiting for ' + giverName + ' to send a clue…';
      }
    } else if (v.phase === 'guess') {
      if (iAmGiver) {
        $('pGuessGiver').classList.remove('hidden');
        $('secretWord2').textContent = v.secret;
        renderClue($('clueView2'), v.clue);
        renderPips($('pips2'), v.left);
        renderWrong($('wrong2'), v.wrong);
        const last = v.wrong[v.wrong.length - 1];
        $('feedback2').textContent = last ? guesserName + ' guessed "' + last + '" — wrong! (' + chancesText(v.left) + ')' : '';
        $('watchText').textContent = guesserName + ' is guessing…';
      } else {
        $('pGuessGuess').classList.remove('hidden');
        $('clueFrom').textContent = giverName + "'s clue";
        renderClue($('clueView1'), v.clue);
        renderPips($('pips1'), v.left);
        renderWrong($('wrong1'), v.wrong);
        const last = v.wrong[v.wrong.length - 1];
        const fb = $('feedback1');
        fb.textContent = last ? '❌ Try Again! (' + chancesText(v.left) + ')' : '';
        if (last) { fb.classList.remove('shake'); void fb.offsetWidth; fb.classList.add('shake'); }
        setTimeout(() => { if (view && view.phase === 'guess' && !iAmGiver) $('guessInput').focus(); }, 30);
      }
    } else {
      // reveal or over
      $('pReveal').classList.remove('hidden');
      $('revWord').textContent = v.secret;
      const r = v.result || {};
      let title, detail;
      if (r.correct) {
        const who = v.names[r.by];
        title = (r.by === myIdx ? '🎉 You got it!' : '🎉 ' + who + ' got it!');
        detail = who + ' +' + r.pts + (r.pts === 1 ? ' point' : ' points');
      } else {
        title = '😬 Out of guesses!';
        detail = v.names[v.giver] + ' +3 points for stumping ' + v.names[1 - v.giver] + '!';
      }
      if (v.phase === 'over') {
        const winName = v.names[v.winner];
        title = v.winner === myIdx ? '🏆 You win the match!' : '🏆 ' + winName + ' wins the match!';
        detail = v.names[0] + ' ' + v.scores[0] + ' — ' + v.scores[1] + ' ' + v.names[1];
      } else if (v.scores[0] >= WIN && v.scores[0] === v.scores[1]) {
        detail += ' · Tied at ' + v.scores[0] + '! Sudden death — keep playing.';
      }
      $('revTitle').textContent = title;
      $('revDetail').textContent = detail;
      $('btnNext').classList.toggle('hidden', v.phase === 'over');
      $('btnRematch').classList.toggle('hidden', v.phase !== 'over');
    }
  }

  /* ---------- Clue input validation (client side) ---------- */
  function updateClueCounter() {
    const p = parseClue($('clueInput').value, view && view.secret);
    const empty = !$('clueInput').value.trim();
    $('clueCount').textContent = 'Words ' + p.words.length + '/3 · Emojis ' + p.emojis.length + '/3';
    $('clueErr').textContent = empty ? '' : (p.error || '');
    $('btnSendClue').disabled = !!p.error;
  }

  function sendClue() {
    const p = parseClue($('clueInput').value, view && view.secret);
    if (p.error) { toast(p.error); return; }
    send({ t: 'clue', text: $('clueInput').value });
  }

  function sendGuess() {
    const g = $('guessInput').value;
    if (!g.trim()) return;
    $('guessInput').value = '';
    send({ t: 'guess', text: g });
  }

  /* ---------- Events ---------- */
  $('btnCreate').addEventListener('click', () => createRoom(0));
  $('btnJoin').addEventListener('click', joinRoom);
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(0); });
  $('btnCancel').addEventListener('click', () => location.reload());
  $('btnLeave').addEventListener('click', () => { if (confirm('Leave the game?')) location.reload(); });
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode); toast('Code copied!'); }
    catch (e) { toast('Code: ' + roomCode); }
  });

  $('btnReroll').addEventListener('click', () => send({ t: 'reroll' }));
  $('clueInput').addEventListener('input', updateClueCounter);
  $('clueInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendClue(); });
  $('btnSendClue').addEventListener('click', sendClue);
  $('guessInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendGuess(); });
  $('btnGuess').addEventListener('click', sendGuess);
  $('btnNext').addEventListener('click', () => send({ t: 'next' }));
  $('btnRematch').addEventListener('click', () => send({ t: 'rematch' }));

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && peer && !peer.destroyed) {
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
      if (isHost) keepAwake();
    }
  });
  setInterval(() => {
    if (peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
  }, 5000);

  window.addEventListener('beforeunload', () => { try { if (peer) peer.destroy(); } catch (e) {} });
})();
