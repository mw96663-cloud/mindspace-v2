
/* ===================================================
   MINDSPACE V2 — COMPLETE FRONTEND
   GitHub Pages + p5.js + Google Apps Script
   =================================================== */

const GAS_URL = "請貼上你原本的GAS網頁應用程式網址";

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const state = {
  heroes: [],
  selectedId: null,
  world: "ocean",
  scenes: [],
  history: [],
  cameraStream: null,
  facingMode: "environment",
  editor: null,
  brushMode: "erase",
  undo: [],
  voiceEnabled: true,
  recording: false,
  recorder: null,
  micStream: null,
  audioChunks: [],
  currentAudio: null,
  speechToken: 0,
  bridgeReady: false,
  pending: new Map(),
  nextRequest: 0,
  started: false,
  busy: false
};

const AI_TIMEOUT = 150000;

function setStatus(text) {
  $("status").textContent = text;
  console.log("[Mindspace]", text);
}

function makeId() {
  return "hero_" + Date.now() + "_" +
    Math.random().toString(36).slice(2, 8);
}

function selectedHero() {
  return state.heroes.find(h => h.id === state.selectedId) || null;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function addChat(who, message, kind = "ai") {
  const line = document.createElement("div");
  line.className = "msg " + kind;
  line.textContent = who + "：" + message;
  $("chatLog").appendChild(line);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

function showBubble(message, ms = 4500) {
  const bubble = $("speechBubble");
  bubble.textContent = message;
  bubble.style.display = "block";
  const token = Date.now() + Math.random();
  bubble.dataset.token = String(token);
  setTimeout(() => {
    if (bubble.dataset.token === String(token)) {
      bubble.style.display = "none";
    }
  }, ms);
}

/* =============== GAS BRIDGE =============== */

function initializeBridge() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(GAS_URL)) {
    setStatus("尚未填入 GAS_URL；基本功能仍可使用");
    return;
  }

  const frame = $("bridgeFrame");

  window.addEventListener("message", event => {
    const permitted =
      event.origin === "https://script.google.com" ||
      event.origin === "https://script.googleusercontent.com";

    if (!permitted) return;

    const message = event.data;
    if (!message || message.app !== "mindspace") return;

    if (message.kind === "ready") {
      state.bridgeReady = true;
      setStatus("AI 通訊橋接器已就緒");
      return;
    }

    if (message.kind !== "response") return;

    const key = String(message.id);
    const entry = state.pending.get(key);
    if (!entry) return;

    clearTimeout(entry.timer);
    state.pending.delete(key);

    if (message.ok === false ||
        (message.result && message.result.ok === false)) {
      entry.reject(new Error(
        message.error ||
        message.result?.error ||
        "AI 呼叫失敗"
      ));
    } else {
      entry.resolve(message.result ?? message.data);
    }
  });

  frame.addEventListener("load", () => {
    sendBridgeHello();
  });

  frame.src = GAS_URL;

  const helloTimer = setInterval(() => {
    if (state.bridgeReady) {
      clearInterval(helloTimer);
    } else {
      sendBridgeHello();
    }
  }, 1200);

  setTimeout(() => clearInterval(helloTimer), 30000);
}

function sendBridgeHello() {
  const frame = $("bridgeFrame");
  if (!frame.contentWindow) return;
  frame.contentWindow.postMessage({
    app: "mindspace",
    kind: "hello"
  }, "*");
}

async function callAI(type, data = {}) {
  if (!state.bridgeReady) {
    sendBridgeHello();
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (state.bridgeReady) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 16000) {
          clearInterval(timer);
          reject(new Error("GAS 橋接器無法連線"));
        } else {
          sendBridgeHello();
        }
      }, 400);
    });
  }

  return new Promise((resolve, reject) => {
    const id = "req_" + (++state.nextRequest) + "_" + Date.now();

    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error("AI 回應逾時"));
    }, AI_TIMEOUT);

    state.pending.set(id, { resolve, reject, timer });

    $("bridgeFrame").contentWindow.postMessage({
      app: "mindspace",
      kind: "request",
      id,
      type,
      data
    }, "*");
  });
}

/* =============== NATURAL AI VOICE =============== */

function stopVoice() {
  state.speechToken++;

  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.src = "";
    state.currentAudio = null;
  }

  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
}

function browserSpeak(text) {
  if (!("speechSynthesis" in window)) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 1.08;
  utterance.pitch = 1.17;
  speechSynthesis.speak(utterance);
}

async function speak(text) {
  if (!state.voiceEnabled || !text) return;

  stopVoice();
  const token = state.speechToken;

  try {
    const result = await callAI("speakNatural", {
      text: String(text).slice(0, 350),
      voice: "coral"
    });

    if (token !== state.speechToken) return;
    if (!result.audio) throw new Error("沒有音訊資料");

    const audio = new Audio(result.audio);
    state.currentAudio = audio;
    audio.onended = () => {
      if (state.currentAudio === audio) {
        state.currentAudio = null;
      }
    };
    await audio.play();

  } catch (error) {
    if (token !== state.speechToken) return;
    console.warn("AI 自然語音：", error);
    browserSpeak(text);
  }
}

async function welcomeHero(hero) {
  let reply = `哇！我誕生了！我是${hero.name}！你想讓我表演什麼神奇技能呢？`;

  try {
    const result = await callAI("welcome", {
      name: hero.name,
      appearance: hero.appearance
    });
    if (result.reply) reply = result.reply;
  } catch (error) {
    console.warn(error);
  }

  addChat(hero.name, reply);
  showBubble(reply);
  speak(reply);
}

/* =============== CAMERA =============== */

async function openCamera() {
  $("cameraModal").classList.add("open");

  try {
    stopCamera();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    state.cameraStream = stream;
    $("cameraVideo").srcObject = stream;
    await $("cameraVideo").play();
    $("cameraMessage").textContent = "請把整個黏土角色放入畫面。";
  } catch (error) {
    $("cameraMessage").textContent =
      "無法開啟攝影機：" + error.message;
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  $("cameraVideo").srcObject = null;
}

function capturePhoto() {
  const video = $("cameraVideo");
  if (!video.videoWidth) {
    alert("攝影機還沒準備好");
    return;
  }

  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1200 / Math.max(
    video.videoWidth, video.videoHeight
  ));

  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  canvas.getContext("2d").drawImage(
    video, 0, 0, canvas.width, canvas.height
  );

  stopCamera();
  $("cameraModal").classList.remove("open");
  openEditor(canvas.toDataURL("image/png"), null);
}

function uploadPhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => openEditor(reader.result, null);
  reader.readAsDataURL(file);
}

/* =============== PHOTO EDITOR =============== */

function imageFromURL(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片載入失敗"));
    image.src = src;
  });
}

async function openEditor(src, editingId) {
  try {
    const image = await imageFromURL(src);
    const canvas = $("editCanvas");

    const ratio = Math.min(
      1, 1100 / Math.max(image.width, image.height)
    );

    canvas.width = Math.round(image.width * ratio);
    canvas.height = Math.round(image.height * ratio);

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true
    });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    state.editor = {
      original: src,
      editingId,
      sourceImage: image
    };

    state.undo = [];
    state.brushMode = "erase";
    $("editorStatus").textContent =
      "可以先點「AI 智慧去背」，也能手動修正。";
    $("editorModal").classList.add("open");
  } catch (error) {
    alert(error.message);
  }
}

function pushUndo() {
  const canvas = $("editCanvas");
  state.undo.push(canvas.toDataURL("image/png"));
  if (state.undo.length > 10) state.undo.shift();
}

async function setEditorImage(src) {
  const image = await imageFromURL(src);
  const canvas = $("editCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(
    canvas.width / image.width,
    canvas.height / image.height
  );

  const w = image.width * scale;
  const h = image.height * scale;

  ctx.drawImage(
    image,
    (canvas.width - w) / 2,
    (canvas.height - h) / 2,
    w, h
  );
}

async function restoreOriginalPhoto() {
  if (!state.editor) return;
  pushUndo();
  await setEditorImage(state.editor.original);
  $("editorStatus").textContent = "已還原原始照片";
}

async function undoEdit() {
  const previous = state.undo.pop();
  if (!previous) return;
  await setEditorImage(previous);
}

function quickRemoveBackground() {
  const canvas = $("editCanvas");
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  pushUndo();

  const image = ctx.getImageData(
    0, 0, canvas.width, canvas.height
  );
  const d = image.data;
  const w = canvas.width;
  const h = canvas.height;

  const corners = [
    0, (w - 1) * 4,
    ((h - 1) * w) * 4,
    (h * w - 1) * 4
  ];

  const bg = [0, 1, 2].map(c =>
    corners.reduce((sum, i) => sum + d[i + c], 0) / 4
  );

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;

  function tryAdd(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const pos = y * w + x;
    if (visited[pos]) return;
    visited[pos] = 1;

    const i = pos * 4;
    const dist = Math.sqrt(
      (d[i] - bg[0]) ** 2 +
      (d[i + 1] - bg[1]) ** 2 +
      (d[i + 2] - bg[2]) ** 2
    );

    if (dist < 90) {
      queue[tail++] = pos;
    }
  }

  for (let x = 0; x < w; x++) {
    tryAdd(x, 0);
    tryAdd(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryAdd(0, y);
    tryAdd(w - 1, y);
  }

  while (head < tail) {
    const pos = queue[head++];
    d[pos * 4 + 3] = 0;
    const x = pos % w;
    const y = Math.floor(pos / w);
    tryAdd(x - 1, y);
    tryAdd(x + 1, y);
    tryAdd(x, y - 1);
    tryAdd(x, y + 1);
  }

  ctx.putImageData(image, 0, 0);
  $("editorStatus").textContent =
    "快速去背完成，可使用橡皮擦修正。";
}

async function aiRemoveBackground() {
  if (!state.editor) return;

  const button = $("aiRemoveBg");
  button.disabled = true;
  button.textContent = "✨ AI 去背處理中...";

  try {
    const canvas = $("editCanvas");
    const image = canvas.toDataURL("image/png");

    $("editorStatus").textContent =
      "AI 正在辨識黏土輪廓，請稍候...";

    const result = await callAI("removeBackgroundAI", {
      image
    });

    if (!result.image) {
      throw new Error("AI 沒有回傳圖片");
    }

    pushUndo();
    await setEditorImage(result.image);

    $("editorStatus").textContent =
      "AI 去背完成！請檢查形狀，必要時手動修正。";

  } catch (error) {
    $("editorStatus").textContent =
      "AI 去背失敗：" + error.message;
    alert(
      "AI 去背失敗：" + error.message +
      "\n你仍可以使用快速去背與手動工具。"
    );
  } finally {
    button.disabled = false;
    button.textContent = "✨ AI 智慧去背";
  }
}

let painting = false;

function editorPointer(event) {
  const canvas = $("editCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) *
    canvas.width / rect.width;
  const y = (event.clientY - rect.top) *
    canvas.height / rect.height;

  const ctx = canvas.getContext("2d");
  const radius = Number($("brushSize").value) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (state.brushMode === "erase") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
  } else if (state.editor?.sourceImage) {
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(
      state.editor.sourceImage,
      0, 0, canvas.width, canvas.height
    );
  }
  ctx.restore();
}

function trimTransparent(src) {
  return new Promise(async resolve => {
    const image = await imageFromURL(src);
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d", {
      willReadFrequently: true
    });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(
      0, 0, c.width, c.height
    ).data;

    let minX = c.width, minY = c.height;
    let maxX = -1, maxY = -1;

    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 15) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX) {
      resolve(src);
      return;
    }

    const padding = 12;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const w = Math.min(c.width - x, maxX - x + 1 + padding);
    const h = Math.min(c.height - y, maxY - y + 1 + padding);

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(
      c, x, y, w, h, 0, 0, w, h
    );
    resolve(out.toDataURL("image/png"));
  });
}

async function saveEditor() {
  if (!state.editor) return;

  const png = await trimTransparent(
    $("editCanvas").toDataURL("image/png")
  );

  if (state.editor.editingId) {
    const hero = state.heroes.find(
      h => h.id === state.editor.editingId
    );

    if (hero) {
      hero.original = png;
      hero.current = png;
      hero.transformed = null;
      hero.element.src = png;
    }
  } else {
    const name = prompt(
      "幫你的黏土生命取個名字：",
      "小生命" + (state.heroes.length + 1)
    ) || "小生命";

    const hero = createHero(name, png);
    if (state.heroes.length === 1) {
      welcomeHero(hero);
    }
  }

  $("editorModal").classList.remove("open");
  state.editor = null;
  renderHeroList();
  setStatus("黏土生命已加入心智小宇宙！");
}

/* =============== HEROES =============== */

function createHero(name, png) {
  const hero = {
    id: makeId(),
    name,
    original: png,
    current: png,
    transformed: null,
    appearance: "",
    skills: [],
    x: rand(18, 72),
    y: rand(30, 70),
    vx: rand(-0.018, 0.018),
    vy: rand(-0.012, 0.012),
    action: null,
    actionUntil: 0,
    targetId: null,
    skillUntil: 0,
    phase: rand(0, Math.PI * 2),
    element: document.createElement("img")
  };

  hero.element.className = "hero";
  hero.element.src = png;
  hero.element.alt = name;
  hero.element.addEventListener(
    "click", () => selectHero(hero.id)
  );

  $("actors").appendChild(hero.element);
  state.heroes.push(hero);
  selectHero(hero.id);
  return hero;
}

function selectHero(id) {
  state.selectedId = id;
  renderHeroList();
}

function renderHeroList() {
  const list = $("heroList");
  const select = $("selectedHero");
  list.innerHTML = "";
  select.innerHTML = "";

  if (!state.heroes.length) {
    select.innerHTML =
      '<option value="">請先新增角色</option>';
    $("appearance").textContent = "";
    return;
  }

  for (const hero of state.heroes) {
    const chip = document.createElement("button");
    chip.className = "hero-chip" +
      (hero.id === state.selectedId ? " active" : "");

    const img = document.createElement("img");
    img.src = hero.current;

    const span = document.createElement("span");
    span.textContent = hero.name;

    chip.append(img, span);
    chip.onclick = () => selectHero(hero.id);
    list.appendChild(chip);

    const option = document.createElement("option");
    option.value = hero.id;
    option.textContent = hero.name;
    select.appendChild(option);

    hero.element.classList.toggle(
      "selected", hero.id === state.selectedId
    );
  }

  select.value = state.selectedId || "";
  $("appearance").textContent =
    selectedHero()?.appearance || "";
}

function deleteHero() {
  const hero = selectedHero();
  if (!hero) return;
  if (!confirm("確定要刪除「" + hero.name + "」嗎？")) return;

  hero.element.remove();
  state.heroes = state.heroes.filter(h => h.id !== hero.id);
  state.selectedId = state.heroes[0]?.id || null;
  renderHeroList();
}

async function inspectHero() {
  const hero = selectedHero();
  if (!hero) return;

  setStatus("AI 正在觀察黏土角色...");
  try {
    const result = await callAI("inspect", {
      image: hero.original
    });
    hero.appearance = result.appearance || "";
    renderHeroList();
    setStatus("AI 已完成角色外觀觀察");
  } catch (error) {
    setStatus(error.message);
  }
}

async function transformHero(hero, description) {
  if (!hero || !description) return;

  setStatus("AI 正在製作黏土變身...");
  try {
    const result = await callAI("transform", {
      image: hero.original,
      description
    });

    if (!result.image) {
      throw new Error("沒有收到變身圖片");
    }

    hero.transformed = result.image;
    hero.current = result.image;
    hero.element.src = hero.current;
    renderHeroList();
    setStatus("黏土變身完成！");
  } catch (error) {
    setStatus("變身失敗：" + error.message);
  }
}

function restoreHero() {
  const hero = selectedHero();
  if (!hero) return;
  hero.current = hero.original;
  hero.element.src = hero.original;
  renderHeroList();
}

function toggleHeroTransform() {
  const hero = selectedHero();
  if (!hero || !hero.transformed) return;

  hero.current =
    hero.current === hero.original
      ? hero.transformed
      : hero.original;
  hero.element.src = hero.current;
  renderHeroList();
}

/* =============== STORY & SKILLS =============== */

function performAction(action) {
  const hero = state.heroes.find(
    h => h.id === action.heroId
  );
  if (!hero) return;

  hero.action = action.type;
  hero.targetId = action.targetId || null;
  hero.actionUntil = Date.now() +
    clamp(Number(action.duration) || 3500, 500, 12000);

  if (action.type === "laser" ||
      action.type === "sparkle") {
    hero.skillUntil = hero.actionUntil;
  }
}

function addScene(scene) {
  state.scenes.push({
    type: scene.type,
    description: scene.description || "",
    until: Date.now() +
      clamp(Number(scene.duration) || 5000, 1000, 15000),
    start: Date.now()
  });
}

async function sendStory(message) {
  const text = String(message || "").trim();
  if (!text || !state.heroes.length || state.busy) return;

  state.busy = true;
  addChat("孩子", text, "user");
  $("chatInput").value = "";
  setStatus("AI 正在理解你的想像...");

  try {
    const result = await callAI("story", {
      message: text,
      selectedHeroId: state.selectedId,
      heroes: state.heroes.map(h => ({
        id: h.id,
        name: h.name,
        appearance: h.appearance,
        skills: h.skills
      })),
      history: state.history.slice(-8),
      activeScenes: state.scenes.map(s => s.type)
    });

    const speaker =
      state.heroes.find(h => h.id === result.speakerId) ||
      selectedHero();

    const reply = result.reply || "好呀！我們一起來試試！";

    addChat(speaker.name, reply);
    showBubble(reply);
    speak(reply);

    for (const action of result.actions || []) {
      performAction(action);
    }

    for (const scene of result.scenes || []) {
      addScene(scene);
    }

    for (const skill of result.skills || []) {
      const hero = state.heroes.find(
        h => h.id === skill.heroId
      );
      if (!hero) continue;

      hero.skills.push(skill);
      hero.skillUntil = Date.now() + 5000;

      if (skill.type === "laser" ||
          skill.type === "sparkle") {
        performAction({
          heroId: hero.id,
          type: skill.type,
          duration: 4500
        });
      }
    }

    for (const transform of result.transforms || []) {
      const hero = state.heroes.find(
        h => h.id === transform.heroId
      );
      if (hero) {
        await transformHero(hero, transform.description);
      }
    }

    state.history.push({
      user: text,
      speaker: speaker.name,
      reply
    });

    setStatus("你的故事正在發生！");

  } catch (error) {
    setStatus("AI 故事失敗：" + error.message);
    showBubble("我還在想故事，再跟我說一次好嗎？");
  } finally {
    state.busy = false;
  }
}

/* =============== MICROPHONE =============== */

async function toggleMicrophone() {
  if (state.recording) {
    state.recorder.stop();
    state.recording = false;
    $("micButton").textContent = "🎤 說話";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    state.micStream = stream;
    state.audioChunks = [];

    const recorder = new MediaRecorder(stream);
    state.recorder = recorder;

    recorder.ondataavailable = event => {
      if (event.data.size) {
        state.audioChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());

      try {
        setStatus("正在辨識孩子說的話...");
        const blob = new Blob(state.audioChunks, {
          type: recorder.mimeType
        });
        const wav = await convertToWav(blob);
        const audio = await blobToBase64(wav);
        const result = await callAI("transcribe", { audio });

        if (result.text) {
          await sendStory(result.text);
        } else {
          setStatus("沒有聽清楚，請再說一次");
        }
      } catch (error) {
        setStatus("語音辨識失敗：" + error.message);
      }
    };

    recorder.start();
    state.recording = true;
    $("micButton").textContent = "⏹ 結束錄音";
    setStatus("正在聽你說話...");

  } catch (error) {
    setStatus("麥克風無法使用：" + error.message);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function convertToWav(blob) {
  const buffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext ||
    window.webkitAudioContext;
  const ctx = new AudioCtx();
  const decoded = await ctx.decodeAudioData(buffer);
  const input = decoded.getChannelData(0);
  const targetRate = 16000;
  const outputLength = Math.ceil(
    input.length * targetRate / decoded.sampleRate
  );
  const samples = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * decoded.sampleRate / targetRate;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const t = position - left;
    samples[i] = input[left] * (1 - t) + input[right] * t;
  }

  await ctx.close();

  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);

  function str(offset, value) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const sample = clamp(samples[i], -1, 1);
    view.setInt16(
      44 + i * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true
    );
  }

  return new Blob([bytes], { type: "audio/wav" });
}

/* =============== P5 WORLD =============== */

let particles = [];

function setup() {
  const world = $("world");
  const canvas = createCanvas(
    world.clientWidth, world.clientHeight
  );
  canvas.parent("scene");
  canvas.style("display", "block");

  for (let i = 0; i < 65; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      r: random(2, 8),
      speed: random(.3, 1.4)
    });
  }
}

function windowResized() {
  resizeCanvas(
    $("world").clientWidth,
    $("world").clientHeight
  );
}

function draw() {
  drawWorld();
  drawScenes();
  updateHeroes();
  drawSkills();
}

function drawWorld() {
  if (state.world === "ocean") {
    background(24, 123, 177);

    noStroke();
    for (let y = 0; y < height; y += 5) {
      fill(20, 105, 166, map(y, 0, height, 0, 85));
      rect(0, y, width, 6);
    }

    for (const p of particles) {
      noFill();
      stroke(195, 240, 255, 100);
      strokeWeight(1.5);
      circle(p.x, p.y, p.r * 2);
      p.y -= p.speed;
      if (p.y < -10) {
        p.y = height + 10;
        p.x = random(width);
      }
    }

    noStroke();
    fill(225, 202, 146);
    ellipse(width / 2, height + 28, width * 1.6, 110);

    for (let x = 20; x < width; x += 85) {
      stroke(30, 163, 120, 170);
      strokeWeight(6);
      noFill();
      const sway = sin(frameCount * .03 + x) * 12;
      bezier(x, height, x + sway, height - 55,
        x - sway, height - 95, x + sway, height - 125);
    }
  }

  if (state.world === "forest") {
    background(171, 225, 190);
    noStroke();
    fill(109, 177, 118);
    rect(0, height * .76, width, height * .24);

    for (let x = 35; x < width; x += 145) {
      fill(116, 89, 62);
      rect(x, height * .43, 24, height * .39);
      fill(70, 151, 90, 220);
      circle(x + 12, height * .37, 140);
      fill(101, 180, 112, 180);
      circle(x - 20, height * .32, 90);
    }
  }

  if (state.world === "space") {
    background(17, 22, 61);
    noStroke();

    for (const p of particles) {
      fill(255, 255, 255, 130 + sin(frameCount * .04 + p.x) * 90);
      circle(p.x, p.y, p.r * .55);
    }

    fill(115, 100, 201, 65);
    ellipse(width * .72, height * .3, 280, 220);
    fill(236, 183, 107);
    circle(width * .82, height * .22, 85);
  }
}

function drawScenes() {
  const now = Date.now();
  state.scenes = state.scenes.filter(s => s.until > now);

  for (const scene of state.scenes) {
    const elapsed = (now - scene.start) / 1000;

    push();

    if (scene.type === "rain" ||
        scene.type === "storm" ||
        scene.type === "candyRain") {
      for (let i = 0; i < 85; i++) {
        const x = (i * 79 + elapsed * 28) % width;
        const y = (i * 61 + elapsed * 210) % height;

        if (scene.type === "candyRain") {
          noStroke();
          fill(i % 2 ? "#ff80bd" : "#ffdb63");
          circle(x, y, 9);
        } else {
          stroke(200, 239, 255, 180);
          strokeWeight(2);
          line(x, y, x - 7, y + 20);
        }
      }
    }

    if (scene.type === "rainbow") {
      noFill();
      strokeWeight(11);
      const colors = [
        "#f66b77", "#ffc66b", "#fff28b",
        "#88e5a1", "#80c9ff", "#bca4f2"
      ];
      colors.forEach((c, i) => {
        stroke(c);
        arc(width / 2, height * .9,
          350 - i * 24, 350 - i * 24,
          PI, TWO_PI);
      });
    }

    if (scene.type === "egg") {
      noStroke();
      fill("#fff3d5");
      ellipse(width * .5, height * .7, 85, 112);
      stroke("#d4a5a0");
      strokeWeight(3);
      line(width * .47, height * .68,
        width * .5, height * .72);
      line(width * .5, height * .72,
        width * .53, height * .66);
    }

    if (scene.type === "treasure") {
      noStroke();
      fill("#9d5d33");
      rect(width * .46, height * .75, 105, 60, 12);
      fill("#ffe477");
      rect(width * .48, height * .76, 18, 60);
    }

    if (scene.type === "night") {
      noStroke();
      fill(0, 10, 50, 120);
      rect(0, 0, width, height);
    }

    if (scene.type === "sparkle") {
      for (let i = 0; i < 25; i++) {
        fill(255, 240, 140, 160);
        noStroke();
        circle(
          (i * 83 + elapsed * 17) % width,
          (i * 47 + sin(elapsed + i) * 30) % height,
          4 + i % 5
        );
      }
    }

    if (scene.description) {
      noStroke();
      fill(255, 255, 255, 200);
      textAlign(CENTER);
      textSize(15);
      text(scene.description, width / 2, height - 35);
    }

    pop();
  }
}

function updateHeroes() {
  const now = Date.now();

  for (const hero of state.heroes) {
    if (hero.actionUntil < now) {
      hero.action = null;
    }

    const target = state.heroes.find(
      h => h.id === hero.targetId
    );

    switch (hero.action) {
      case "dance":
        hero.x += sin(frameCount * .16 + hero.phase) * .18;
        break;
      case "spin":
        break;
      case "fly":
        hero.y -= .09;
        break;
      case "jump":
        hero.y += sin(frameCount * .18) * .28;
        break;
      case "follow":
      case "meet":
        if (target) {
          hero.x += Math.sign(target.x - hero.x) * .08;
          hero.y += Math.sign(target.y - hero.y) * .06;
        }
        break;
      case "circle":
        hero.x += cos(frameCount * .06 + hero.phase) * .16;
        hero.y += sin(frameCount * .06 + hero.phase) * .16;
        break;
      case "stop":
        break;
      default:
        hero.x += hero.vx;
        hero.y += hero.vy;
        if (hero.x < 9 || hero.x > 84) hero.vx *= -1;
        if (hero.y < 18 || hero.y > 77) hero.vy *= -1;
    }

    hero.x = clamp(hero.x, 5, 85);
    hero.y = clamp(hero.y, 13, 80);

    const bob = sin(frameCount * .04 + hero.phase) * 7;
    const rotation = hero.action === "spin"
      ? frameCount * 7
      : hero.action === "dance"
        ? sin(frameCount * .15) * 15
        : sin(frameCount * .025 + hero.phase) * 4;

    hero.element.style.left = hero.x + "%";
    hero.element.style.top = hero.y + "%";
    hero.element.style.transform =
      `translate(-50%,-50%) translateY(${bob}px) rotate(${rotation}deg)`;
  }
}

function drawSkills() {
  const now = Date.now();

  for (const hero of state.heroes) {
    if (hero.skillUntil < now) continue;

    const skill = hero.skills.at(-1);
    const type = hero.action === "laser"
      ? "laser"
      : hero.action === "sparkle"
        ? "sparkle"
        : skill?.type || "sparkle";

    const x = width * hero.x / 100;
    const y = height * hero.y / 100;
    const color = skill?.color || "#ff5d7d";

    push();
    if (type === "laser") {
      stroke(color);
      strokeWeight(8);
      line(x + 30, y - 20, x + 240, y - 45);
      stroke(255, 255, 255, 200);
      strokeWeight(2);
      line(x + 30, y - 20, x + 240, y - 45);
    } else {
      noStroke();
      for (let i = 0; i < 16; i++) {
        fill(i % 2 ? "#ffdd78" : "#fff");
        const angle = frameCount * .05 + i * TWO_PI / 16;
        circle(
          x + cos(angle) * 90,
          y + sin(angle) * 75,
          5 + i % 5
        );
      }
    }
    pop();
  }
}

/* =============== UI EVENTS =============== */

function bindEvents() {
  $("startButton").onclick = () => {
    state.started = true;
    $("startScreen").style.display = "none";
    setStatus("歡迎來到心智小宇宙！");
  };

  $("mobileToggle").onclick = () =>
    $("sidebar").classList.toggle("open");

  $("openCamera").onclick = openCamera;

  $("closeCamera").onclick = () => {
    stopCamera();
    $("cameraModal").classList.remove("open");
  };

  $("captureButton").onclick = capturePhoto;

  $("switchCamera").onclick = () => {
    state.facingMode =
      state.facingMode === "environment"
        ? "user"
        : "environment";
    openCamera();
  };

  $("retryCamera").onclick = openCamera;

  $("uploadPhoto").onclick = () => $("photoFile").click();

  $("photoFile").onchange = event => {
    uploadPhoto(event.target.files[0]);
    event.target.value = "";
  };

  $("closeEditor").onclick = () =>
    $("editorModal").classList.remove("open");

  $("aiRemoveBg").onclick = aiRemoveBackground;
  $("removeBg").onclick = quickRemoveBackground;
  $("restoreOriginalPhoto").onclick = restoreOriginalPhoto;
  $("undoEdit").onclick = undoEdit;
  $("saveEditor").onclick = saveEditor;

  $("eraseMode").onclick = () => {
    state.brushMode = "erase";
    $("editorStatus").textContent = "橡皮擦模式";
  };

  $("restoreMode").onclick = () => {
    state.brushMode = "restore";
    $("editorStatus").textContent = "恢復原照片筆刷模式";
  };

  const canvas = $("editCanvas");

  canvas.addEventListener("pointerdown", event => {
    painting = true;
    pushUndo();
    canvas.setPointerCapture(event.pointerId);
    editorPointer(event);
  });

  canvas.addEventListener("pointermove", event => {
    if (painting) editorPointer(event);
  });

  canvas.addEventListener("pointerup", () => {
    painting = false;
  });

  canvas.addEventListener("pointercancel", () => {
    painting = false;
  });

  $("selectedHero").onchange = event =>
    selectHero(event.target.value);

  $("deleteHero").onclick = deleteHero;
  $("inspectHero").onclick = inspectHero;

  $("editHero").onclick = () => {
    const hero = selectedHero();
    if (hero) openEditor(hero.original, hero.id);
  };

  $("sendButton").onclick = () =>
    sendStory($("chatInput").value);

  $("micButton").onclick = toggleMicrophone;

  $("voiceButton").onclick = () => {
    state.voiceEnabled = !state.voiceEnabled;
    $("voiceButton").textContent =
      state.voiceEnabled
        ? "🔊 自然語音：開"
        : "🔇 自然語音：關";
    if (!state.voiceEnabled) stopVoice();
  };

  $("stopVoice").onclick = stopVoice;

  $("transformButton").onclick = async () => {
    const hero = selectedHero();
    if (hero) {
      await transformHero(
        hero,
        $("transformInput").value.trim()
      );
    }
  };

  $("restoreButton").onclick = restoreHero;
  $("showTransform").onclick = toggleHeroTransform;

  $("skillButton").onclick = () => {
    const hero = selectedHero();
    if (!hero) return;
    const skill = hero.skills.at(-1);
    performAction({
      heroId: hero.id,
      type: skill?.type === "laser" ? "laser" : "sparkle",
      duration: 4500
    });
  };

  $("worldSelect").onchange = event => {
    state.world = event.target.value;
  };

  $("resetButton").onclick = () => {
    if (!confirm("確定要重新開始冒險嗎？")) return;
    stopVoice();
    state.heroes.forEach(h => h.element.remove());
    state.heroes = [];
    state.selectedId = null;
    state.scenes = [];
    state.history = [];
    $("chatLog").innerHTML = "";
    renderHeroList();
    setStatus("新的冒險開始了！");
  };
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  initializeBridge();
  renderHeroList();
});
