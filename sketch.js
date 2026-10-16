
"use strict";

/* ==========================================
   MINDSPACE V2 — sketch.js
   GitHub Pages 前端互動程式
   ========================================== */

// 完成 GAS 部署後，把這裡改成你的 /exec 網址
const GAS_URL = "https://script.google.com/macros/s/AKfycbzL7hGiCD_Hzk_G2tXDRkntToCTWwWFOUXIm9W17qbAR0w3lVV7FNEDmZGW5lsHVZuTrQ/exec";

const $ = id => document.getElementById(id);

const state = {
  heroes: [],
  selectedId: null,
  world: "ocean",
  history: [],
  scenes: [],
  particles: [],
  voiceEnabled: true,
  bridgeReady: false,
  pending: new Map(),
  cameraStream: null,
  cameraFacing: "environment",
  cameraRequestId: 0,
  recorder: null,
  audioStream: null,
  audioChunks: [],
  recording: false,
  busy: false,
  editorOriginal: null,
  editorHeroId: null,
  editorHistory: [],
  editorMode: "erase",
  editorPainting: false,
  editorLastPoint: null
};

function makeId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setStatus(message) {
  $("status").textContent = message;
  console.log("[Mindspace]", message);
}

function setSpeech(message) {
  $("speechBubble").textContent = message;
}

function modal(id, visible) {
  $(id).classList.toggle("hidden", !visible);
}

function selectedHero() {
  return state.heroes.find(
    hero => hero.id === state.selectedId
  ) || null;
}

function loadImageAsync(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(
      new Error("圖片載入失敗")
    );
    image.src = source;
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(
      new Error("無法讀取照片")
    );
    reader.readAsDataURL(file);
  });
}

function addClick(id, callback) {
  $(id).addEventListener("click", () => {
    try {
      const result = callback();
      if (result && typeof result.catch === "function") {
        result.catch(error => {
          setStatus("❌ " + error.message);
        });
      }
    } catch (error) {
      setStatus("❌ " + error.message);
    }
  });
}

/* ==========================================
   GAS BRIDGE
   ========================================== */

function initializeBridge() {
  if (!GAS_URL.startsWith("https://")) {
    setStatus("⚠️ 尚未設定 GAS_URL，AI 暫時無法使用");
    return;
  }

  const frame = $("bridgeFrame");
  const gasOrigin = new URL(GAS_URL).origin;

  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow) {
      return;
    }

    if (
      event.origin !== gasOrigin &&
      event.origin !==
        "https://script.googleusercontent.com"
    ) {
      return;
    }

    const message = event.data;

    if (!message || message.app !== "mindspace") {
      return;
    }

    if (message.kind === "ready") {
      state.bridgeReady = true;
      setStatus("✅ AI 後端已連線");
      return;
    }

    if (message.kind === "response") {
      const pending = state.pending.get(message.id);
      if (!pending) return;

      state.pending.delete(message.id);

      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new Error(message.error || "AI 執行失敗")
        );
      }
    }
  });

  frame.src = GAS_URL;
}

function callAI(type, data) {
  return new Promise((resolve, reject) => {
    if (!state.bridgeReady) {
      reject(new Error(
        "AI 尚未連線，請先完成 GAS 部署"
      ));
      return;
    }

    const id = makeId();

    state.pending.set(id, {
      resolve,
      reject
    });

    $("bridgeFrame").contentWindow.postMessage({
      app: "mindspace",
      kind: "request",
      id,
      type,
      data
    }, "*");

    setTimeout(() => {
      if (!state.pending.has(id)) return;

      state.pending.delete(id);
      reject(new Error("AI 回應逾時"));
    }, 120000);
  });
}

/* ==========================================
   語音輸出
   ========================================== */

function speak(text) {
  if (
    !state.voiceEnabled ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  speechSynthesis.cancel();

  const utterance =
    new SpeechSynthesisUtterance(text);

  utterance.lang = "zh-TW";
  utterance.rate = 0.93;
  utterance.pitch = 1.12;

  const voices = speechSynthesis.getVoices();

  utterance.voice =
    voices.find(v => v.lang === "zh-TW") ||
    voices.find(v => v.lang.startsWith("zh")) ||
    null;

  speechSynthesis.speak(utterance);
}

function addChat(name, message, isAI = false) {
  const div = document.createElement("div");

  div.style.padding = "9px";
  div.style.margin = "6px 0";
  div.style.borderRadius = "12px";
  div.style.background = isAI
    ? "#ffe4ef"
    : "#e4f1ff";

  div.textContent = name + "：" + message;

  $("chatLog").appendChild(div);
  $("chatLog").scrollTop =
    $("chatLog").scrollHeight;
}

async function welcomeHero(hero) {
  let message =
    "哇！我終於誕生了！我會好多好多技能喔！" +
    "你想要我表演什麼厲害的能力？";

  try {
    const result = await callAI("welcome", {
      name: hero.name,
      appearance: hero.appearance
    });

    if (result.reply) {
      message = result.reply;
    }
  } catch (error) {
    console.warn(error);
  }

  addChat("🐠 " + hero.name, message, true);
  setSpeech("🐠 " + hero.name + "：" + message);
  speak(message);
}

/* ==========================================
   攝影機
   ========================================== */

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(
      track => track.stop()
    );
    state.cameraStream = null;
  }

  const video = $("cameraVideo");
  video.pause();
  video.srcObject = null;
  $("captureButton").disabled = true;
}

function closeCamera() {
  state.cameraRequestId++;
  stopCamera();
  modal("cameraModal", false);
}

async function openCamera() {
  const requestId = ++state.cameraRequestId;

  stopCamera();
  modal("cameraModal", true);

  $("cameraMessage").textContent =
    "正在開啟攝影機……";

  try {
    if (!window.isSecureContext) {
      throw new Error("攝影機需要 HTTPS 網址");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "目前瀏覽器不支援即時攝影機"
      );
    }

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {
            ideal: state.cameraFacing
          },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach(
        track => track.stop()
      );
      return;
    }

    state.cameraStream = stream;

    const video = $("cameraVideo");
    video.srcObject = stream;

    await video.play();

    $("captureButton").disabled = false;

    $("cameraMessage").textContent =
      "📸 攝影機已啟動，可以拍照！";

    setStatus("📷 攝影機已啟動");
  } catch (error) {
    if (requestId !== state.cameraRequestId) {
      return;
    }

    stopCamera();

    $("cameraMessage").textContent =
      "⚠️ " + error.message;

    setStatus("❌ 攝影機：" + error.message);
  }
}

async function capturePhoto() {
  const video = $("cameraVideo");

  if (!state.cameraStream || !video.videoWidth) {
    setStatus("請等待攝影機準備完成");
    return;
  }

  const scale =
    Math.min(1, 1000 / video.videoWidth);

  const canvas =
    document.createElement("canvas");

  canvas.width =
    Math.round(video.videoWidth * scale);

  canvas.height =
    Math.round(video.videoHeight * scale);

  canvas.getContext("2d").drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const image = canvas.toDataURL("image/png");

  closeCamera();

  state.editorHeroId = null;
  await openEditor(image);
}

/* ==========================================
   黏土去背
   ========================================== */

async function openEditor(source) {
  const image = await loadImageAsync(source);

  const canvas = $("editCanvas");
  const scale = Math.min(
    1,
    1000 / Math.max(image.width, image.height)
  );

  canvas.width =
    Math.round(image.width * scale);

  canvas.height =
    Math.round(image.height * scale);

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  ctx.clearRect(
    0, 0, canvas.width, canvas.height
  );

  ctx.drawImage(
    image, 0, 0,
    canvas.width, canvas.height
  );

  state.editorOriginal = ctx.getImageData(
    0, 0, canvas.width, canvas.height
  );

  state.editorHistory = [];
  state.editorMode = "erase";

  modal("editorModal", true);
}

function saveEditorHistory() {
  const canvas = $("editCanvas");
  const ctx = canvas.getContext("2d");

  state.editorHistory.push(
    ctx.getImageData(
      0, 0,
      canvas.width,
      canvas.height
    )
  );

  if (state.editorHistory.length > 6) {
    state.editorHistory.shift();
  }
}

function undoEditor() {
  const previous =
    state.editorHistory.pop();

  if (!previous) return;

  $("editCanvas")
    .getContext("2d")
    .putImageData(previous, 0, 0);
}

function autoRemoveBackground() {
  const canvas = $("editCanvas");
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const w = canvas.width;
  const h = canvas.height;

  const image =
    ctx.getImageData(0, 0, w, h);

  const data = image.data;

  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1]
  ];

  const background = [0, 0, 0];

  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;

    for (let j = 0; j < 3; j++) {
      background[j] += data[i + j] / 4;
    }
  }

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);

  let head = 0;
  let tail = 0;

  function similar(index) {
    const i = index * 4;

    const dr = data[i] - background[0];
    const dg = data[i + 1] - background[1];
    const db = data[i + 2] - background[2];

    return (
      dr * dr +
      dg * dg +
      db * db
    ) < 4900;
  }

  function enqueue(x, y) {
    if (
      x < 0 || y < 0 ||
      x >= w || y >= h
    ) {
      return;
    }

    const index = y * w + x;

    if (
      visited[index] ||
      !similar(index)
    ) {
      return;
    }

    visited[index] = 1;
    queue[tail++] = index;
  }

  saveEditorHistory();

  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }

  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];

    const x = index % w;
    const y = Math.floor(index / w);

    data[index * 4 + 3] = 0;

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  ctx.putImageData(image, 0, 0);

  setStatus("✨ 自動去背完成，可繼續修整");
}

function editorPointer(event) {
  const canvas = $("editCanvas");
  const rect = canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      canvas.width / rect.width,

    y:
      (event.clientY - rect.top) *
      canvas.height / rect.height
  };
}

function paintEditor(event) {
  if (!state.editorPainting) return;

  const canvas = $("editCanvas");
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const image = ctx.getImageData(
    0, 0,
    canvas.width,
    canvas.height
  );

  const data = image.data;
  const original = state.editorOriginal.data;

  const current = editorPointer(event);
  const previous =
    state.editorLastPoint || current;

  const radius =
    Number($("brushSize").value) / 2;

  const distance = Math.hypot(
    current.x - previous.x,
    current.y - previous.y
  );

  const steps = Math.max(
    1,
    Math.ceil(distance / Math.max(1, radius / 2))
  );

  for (let step = 0; step <= steps; step++) {
    const x =
      previous.x +
      (current.x - previous.x) * step / steps;

    const y =
      previous.y +
      (current.y - previous.y) * step / steps;

    for (
      let yy = Math.max(0, Math.floor(y - radius));
      yy <= Math.min(
        canvas.height - 1,
        Math.ceil(y + radius)
      );
      yy++
    ) {
      for (
        let xx = Math.max(0, Math.floor(x - radius));
        xx <= Math.min(
          canvas.width - 1,
          Math.ceil(x + radius)
        );
        xx++
      ) {
        if (
          (xx - x) ** 2 +
          (yy - y) ** 2 >
          radius ** 2
        ) {
          continue;
        }

        const i =
          (yy * canvas.width + xx) * 4;

        if (state.editorMode === "erase") {
          data[i + 3] = 0;
        } else {
          for (let j = 0; j < 4; j++) {
            data[i + j] = original[i + j];
          }
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  state.editorLastPoint = current;
}

function cropEditedImage() {
  const canvas = $("editCanvas");
  const w = canvas.width;
  const h = canvas.height;

  const pixels =
    canvas.getContext("2d")
      .getImageData(0, 0, w, h).data;

  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > 10) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left) {
    throw new Error("圖片已全部透明");
  }

  left = Math.max(0, left - 5);
  top = Math.max(0, top - 5);
  right = Math.min(w - 1, right + 5);
  bottom = Math.min(h - 1, bottom + 5);

  const output =
    document.createElement("canvas");

  output.width = right - left + 1;
  output.height = bottom - top + 1;

  output.getContext("2d").drawImage(
    canvas,
    left,
    top,
    output.width,
    output.height,
    0,
    0,
    output.width,
    output.height
  );

  return output.toDataURL("image/png");
}

/* ==========================================
   主角管理
   ========================================== */

function createHeroElement(hero) {
  const element =
    document.createElement("div");

  element.style.position = "absolute";
  element.style.width = "145px";
  element.style.height = "145px";
  element.style.transformOrigin = "center";

  const original =
    document.createElement("img");

  original.src = hero.original;
  original.style.position = "absolute";
  original.style.inset = "0";
  original.style.width = "100%";
  original.style.height = "100%";
  original.style.objectFit = "contain";
  original.style.filter =
    "drop-shadow(0 5px 6px #236e8344)";

  const transformed =
    document.createElement("img");

  transformed.style.position = "absolute";
  transformed.style.inset = "0";
  transformed.style.width = "100%";
  transformed.style.height = "100%";
  transformed.style.objectFit = "contain";
  transformed.style.display = "none";

  const name =
    document.createElement("span");

  name.textContent = hero.name;
  name.style.position = "absolute";
  name.style.bottom = "-20px";
  name.style.left = "50%";
  name.style.transform = "translateX(-50%)";
  name.style.whiteSpace = "nowrap";
  name.style.background = "#ffffffdd";
  name.style.borderRadius = "10px";
  name.style.padding = "4px 8px";
  name.style.fontSize = "12px";

  element.append(
    original,
    transformed,
    name
  );

  $("actors").appendChild(element);

  hero.element = element;
  hero.originalElement = original;
  hero.transformedElement = transformed;
  hero.nameElement = name;
}

function refreshHeroList() {
  const list = $("heroList");
  const select = $("selectedHero");

  list.replaceChildren();
  select.replaceChildren();

  for (const hero of state.heroes) {
    const row = document.createElement("div");

    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "6px";
    row.style.marginBottom = "5px";
    row.style.borderRadius = "12px";
    row.style.background =
      hero.id === state.selectedId
        ? "#e6d7ff"
        : "#f4efff";

    const image =
      document.createElement("img");

    image.src = hero.original;
    image.style.width = "44px";
    image.style.height = "44px";
    image.style.objectFit = "contain";

    const button =
      document.createElement("button");

    button.textContent = hero.name;
    button.style.flex = "1";

    button.onclick = () => {
      state.selectedId = hero.id;
      refreshHeroList();
    };

    const rename =
      document.createElement("button");

    rename.textContent = "✏️";

    rename.onclick = () => {
      const value = prompt(
        "幫黏土朋友取名字",
        hero.name
      );

      if (value?.trim()) {
        hero.name = value.trim().slice(0, 30);
        hero.nameElement.textContent = hero.name;
        refreshHeroList();
      }
    };

    row.append(image, button, rename);
    list.append(row);

    const option =
      document.createElement("option");

    option.value = hero.id;
    option.textContent = hero.name;

    select.append(option);
  }

  if (!state.heroes.length) {
    list.textContent = "🌱 還沒有黏土主角";
  }

  select.value = state.selectedId || "";
}

function saveHeroFromEditor() {
  const image = cropEditedImage();
  const firstHero = state.heroes.length === 0;

  let hero = state.heroes.find(
    item => item.id === state.editorHeroId
  );

  if (hero) {
    hero.original = image;
    hero.transformed = null;
    hero.originalElement.src = image;
    hero.originalElement.style.display = "block";
    hero.transformedElement.style.display = "none";
  } else {
    hero = {
      id: makeId(),
      name:
        "黏土朋友" +
        (state.heroes.length + 1),
      original: image,
      transformed: null,
      appearance: "",
      personality: "",
      skills: [],
      x:
        0.25 +
        (state.heroes.length % 3) * 0.2,
      y:
        0.4 +
        (state.heroes.length % 2) * 0.15,
      vx: 0.00045,
      face: 1,
      phase: Math.random() * Math.PI * 2,
      action: null,
      skillUntil: 0
    };

    createHeroElement(hero);
    state.heroes.push(hero);
  }

  state.selectedId = hero.id;
  state.editorHeroId = null;

  modal("editorModal", false);
  refreshHeroList();

  setStatus("🌈 " + hero.name + " 已誕生！");

  if (firstHero) {
    welcomeHero(hero);
  }
}

function removeSelectedHero() {
  const hero = selectedHero();

  if (!hero) {
    setStatus("請先選擇主角");
    return;
  }

  if (!confirm("要移除 " + hero.name + " 嗎？")) {
    return;
  }

  hero.element.remove();

  state.heroes = state.heroes.filter(
    item => item.id !== hero.id
  );

  state.selectedId =
    state.heroes[0]?.id || null;

  refreshHeroList();
}

/* ==========================================
   AI 觀察黏土
   ========================================== */

async function inspectHero() {
  const hero = selectedHero();

  if (!hero) {
    setStatus("請先建立黏土主角");
    return;
  }

  setStatus("🧠 AI 正在觀察黏土……");

  const image =
    await loadImageAsync(hero.original);

  const canvas =
    document.createElement("canvas");

  const scale = Math.min(
    1,
    512 / Math.max(image.width, image.height)
  );

  canvas.width =
    Math.round(image.width * scale);

  canvas.height =
    Math.round(image.height * scale);

  canvas.getContext("2d").drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const result = await callAI("inspect", {
    image: canvas.toDataURL("image/png")
  });

  hero.appearance = result.appearance || "";
  hero.personality = result.personality || "";

  $("appearance").textContent =
    "🔍 " + hero.appearance +
    "｜💭 " + hero.personality;

  setStatus("✅ AI 已認識黏土主角");
}

/* ==========================================
   AI 黏土變身
   ========================================== */

async function transformHero(hero, description) {
  if (!hero) {
    throw new Error("請先選擇黏土主角");
  }

  if (!description?.trim()) {
    throw new Error("請描述想增加的造型");
  }

  setStatus("🎨 AI 正在製作黏土風格造型……");

  const result = await callAI("transform", {
    image: hero.original,
    description
  });

  const accessory =
    await loadImageAsync(result.image);

  const original =
    await loadImageAsync(hero.original);

  const canvas =
    document.createElement("canvas");

  canvas.width = 1024;
  canvas.height = 1024;

  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, 1024, 1024);

  ctx.drawImage(
    accessory,
    0,
    0,
    1024,
    1024
  );

  const scale = Math.min(
    820 / original.width,
    820 / original.height
  );

  const w = original.width * scale;
  const h = original.height * scale;

  ctx.drawImage(
    original,
    (1024 - w) / 2,
    (1024 - h) / 2,
    w,
    h
  );

  hero.transformed =
    canvas.toDataURL("image/png");

  hero.transformedElement.src =
    hero.transformed;

  hero.transformedElement.style.display =
    "block";

  hero.originalElement.style.display =
    "none";

  setStatus("✨ 黏土造型變化完成");
}

function showOriginalHero() {
  const hero = selectedHero();
  if (!hero) return;

  hero.originalElement.style.display =
    "block";

  hero.transformedElement.style.display =
    "none";

  setStatus("↩️ 已切換回原始黏土造型");
}

function showTransformedHero() {
  const hero = selectedHero();

  if (!hero?.transformed) {
    setStatus("目前還沒有 AI 造型");
    return;
  }

  hero.originalElement.style.display =
    "none";

  hero.transformedElement.style.display =
    "block";

  setStatus("👀 正在顯示 AI 黏土造型");
}

/* ==========================================
   麥克風錄音與 WAV
   ========================================== */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(
        String(reader.result).split(",")[1]
      );
    };

    reader.onerror = () => {
      reject(new Error("錄音讀取失敗"));
    };

    reader.readAsDataURL(blob);
  });
}

async function convertAudioToWav(blob) {
  const buffer = await blob.arrayBuffer();

  const AudioContextClass =
    window.AudioContext ||
    window.webkitAudioContext;

  const audioContext =
    new AudioContextClass();

  try {
    const decoded =
      await audioContext.decodeAudioData(buffer);

    const sampleRate = 16000;
    const length = Math.floor(
      decoded.duration * sampleRate
    );

    const output =
      new ArrayBuffer(44 + length * 2);

    const view = new DataView(output);

    function writeString(offset, value) {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(
          offset + i,
          value.charCodeAt(i)
        );
      }
    }

    writeString(0, "RIFF");
    view.setUint32(
      4, 36 + length * 2, true
    );

    writeString(8, "WAVE");
    writeString(12, "fmt ");

    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    writeString(36, "data");

    view.setUint32(
      40, length * 2, true
    );

    const channels = [];

    for (
      let i = 0;
      i < decoded.numberOfChannels;
      i++
    ) {
      channels.push(
        decoded.getChannelData(i)
      );
    }

    for (let i = 0; i < length; i++) {
      const position =
        i * decoded.sampleRate / sampleRate;

      const a = Math.floor(position);

      const b = Math.min(
        a + 1,
        decoded.length - 1
      );

      const fraction = position - a;

      let sample = 0;

      for (const channel of channels) {
        sample +=
          channel[a] * (1 - fraction) +
          channel[b] * fraction;
      }

      sample /= channels.length;
      sample = clamp(sample, -1, 1);

      view.setInt16(
        44 + i * 2,
        sample < 0
          ? sample * 32768
          : sample * 32767,
        true
      );
    }

    return new Blob(
      [output],
      { type: "audio/wav" }
    );
  } finally {
    await audioContext.close();
  }
}

async function toggleRecording() {
  if (state.recording) {
    if (
      state.recorder &&
      state.recorder.state === "recording"
    ) {
      state.recorder.stop();
    }
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("瀏覽器不支援麥克風");
    return;
  }

  try {
    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });

    const formats = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm"
    ];

    const supported = formats.find(
      type => MediaRecorder.isTypeSupported(type)
    );

    const recorder = new MediaRecorder(
      stream,
      supported
        ? { mimeType: supported }
        : {}
    );

    state.audioStream = stream;
    state.recorder = recorder;
    state.audioChunks = [];
    state.recording = true;

    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    recorder.onstop = finishRecording;

    recorder.start();

    $("micButton").textContent =
      "⏹️ 結束說話";

    setStatus("🎤 正在聆聽孩子說話……");
  } catch (error) {
    setStatus("❌ 麥克風：" + error.message);
  }
}

async function finishRecording() {
  state.recording = false;

  $("micButton").textContent =
    "🎙️ 開始說話";

  state.audioStream?.getTracks().forEach(
    track => track.stop()
  );

  state.audioStream = null;

  try {
    const blob = new Blob(
      state.audioChunks,
      {
        type:
          state.recorder?.mimeType ||
          "audio/webm"
      }
    );

    if (!blob.size) {
      throw new Error("沒有收到錄音");
    }

    setStatus("🧠 AI 正在辨識語音……");

    const wav =
      await convertAudioToWav(blob);

    const base64 =
      await blobToBase64(wav);

    if (base64.length > 7000000) {
      throw new Error(
        "錄音過長，請縮短到約15秒"
      );
    }

    const result = await callAI(
      "transcribe",
      { audio: base64 }
    );

    $("chatInput").value =
      result.text || "";

    if (result.text?.trim()) {
      await sendStory();
    } else {
      setStatus("沒有辨識到語音內容");
    }
  } catch (error) {
    setStatus(
      "❌ 語音辨識：" + error.message
    );
  } finally {
    state.recorder = null;
    state.audioChunks = [];
  }
}

/* ==========================================
   故事、技能與角色互動
   ========================================== */

function performAction(action) {
  const hero = state.heroes.find(
    item => item.id === action.heroId
  );

  if (!hero) return;

  hero.action = {
    type: action.type,
    targetId: action.targetId || "",
    until:
      performance.now() +
      (action.duration || 6) * 1000
  };

  if (action.type === "laser") {
    hero.skillUntil =
      performance.now() + 4000;
  }
}

function addScene(scene) {
  state.scenes.push({
    type: scene.type,
    description: scene.description || "",
    start: performance.now(),
    duration:
      (scene.duration || 7) * 1000
  });
}

async function sendStory() {
  if (state.busy) return;

  const hero = selectedHero();
  const message =
    $("chatInput").value.trim();

  if (!hero) {
    setStatus("請先創造黏土主角");
    return;
  }

  if (!message) return;

  state.busy = true;
  $("sendButton").disabled = true;
  $("chatInput").value = "";

  addChat("🧒 孩子", message);

  setStatus("🤖 AI 正在理解故事……");

  try {
    const result = await callAI(
      "story",
      {
        message,
        selectedHeroId: hero.id,
        heroes: state.heroes.map(item => ({
          id: item.id,
          name: item.name,
          appearance: item.appearance,
          personality: item.personality,
          skills: item.skills.map(
            skill => skill.name
          )
        })),
        history: state.history.slice(-12),
        activeScenes: state.scenes.map(
          scene => scene.type
        )
      }
    );

    const speaker = state.heroes.find(
      item => item.id === result.speakerId
    ) || hero;

    const reply =
      result.reply ||
      "哇！我們一起試試看吧！";

    addChat(
      "🐠 " + speaker.name,
      reply,
      true
    );

    setSpeech(
      "🐠 " + speaker.name +
      "：" + reply
    );

    speak(reply);

    state.history.push(
      {
        role: "user",
        content: message
      },
      {
        role: "assistant",
        content: reply
      }
    );

    if (state.history.length > 24) {
      state.history.splice(
        0,
        state.history.length - 24
      );
    }

    for (const action of result.actions || []) {
      performAction(action);
    }

    for (const scene of result.scenes || []) {
      addScene(scene);
    }

    for (const skill of result.skills || []) {
      const target = state.heroes.find(
        item => item.id === skill.heroId
      );

      if (!target) continue;

      target.skills.push(skill);
      target.skillUntil =
        performance.now() + 4000;
    }

    for (
      const transformation of
      result.transforms || []
    ) {
      const target = state.heroes.find(
        item =>
          item.id === transformation.heroId
      );

      if (!target) continue;

      try {
        await transformHero(
          target,
          transformation.description
        );
      } catch (error) {
        setStatus(
          "⚠️ AI 造型生成失敗：" +
          error.message
        );
      }
    }

    setStatus("🌈 故事已更新");
  } catch (error) {
    setStatus("❌ " + error.message);

    addChat(
      "⚠️ 系統",
      error.message,
      true
    );
  } finally {
    state.busy = false;
    $("sendButton").disabled = false;
  }
}

/* ==========================================
   p5.js 世界
   ========================================== */

function startP5World() {
  if (typeof p5 === "undefined") {
    setStatus("❌ p5.js 載入失敗");
    return;
  }

  new p5(p => {
    p.setup = () => {
      const world = $("world");

      p.createCanvas(
        world.clientWidth,
        world.clientHeight
      ).parent("scene");
    };

    p.draw = () => {
      const time =
        performance.now() / 1000;

      p.clear();

      drawEnvironment(p, time);
      animateHeroes(p, time);
      drawScenes(p, time);
    };

    p.windowResized = () => {
      const world = $("world");

      p.resizeCanvas(
        world.clientWidth,
        world.clientHeight
      );
    };
  });
}

function drawEnvironment(p, time) {
  p.push();
  p.noStroke();

  if (state.world === "ocean") {
    for (let i = 0; i < 28; i++) {
      const x =
        (i * 137 + Math.sin(time + i) * 18) %
        p.width;

      const y =
        (
          p.height -
          (time * 22 + i * 89) %
          p.height +
          p.height
        ) % p.height;

      p.fill(255, 255, 255, 55);
      p.circle(x, y, 8 + (i % 5) * 4);
    }

    p.fill("#78c6b5");

    for (let i = 0; i < 14; i++) {
      const x =
        i * p.width / 13;

      p.ellipse(
        x,
        p.height + 10,
        26,
        75 + Math.sin(time + i) * 17
      );
    }
  }

  if (state.world === "forest") {
    p.fill("#85c77c");

    p.rect(
      0,
      p.height * 0.8,
      p.width,
      p.height * 0.2
    );

    for (let i = 0; i < 8; i++) {
      const x =
        (i + 0.5) * p.width / 8;

      p.fill("#96725d");

      p.rect(
        x - 6,
        p.height * 0.56,
        12,
        p.height * 0.25
      );

      p.fill("#7bc488");
      p.circle(
        x,
        p.height * 0.53,
        80
      );
    }
  }

  if (state.world === "space") {
    p.fill("#fff6b0");

    for (let i = 0; i < 80; i++) {
      p.circle(
        i * 131 % p.width,
        i * 97 % p.height,
        2 + i % 3
      );
    }
  }

  p.pop();
}

function animateHeroes(p, time) {
  const now = performance.now();

  for (const hero of state.heroes) {
    const action =
      hero.action?.until > now
        ? hero.action
        : null;

    const type =
      action?.type || "swim";

    const target = state.heroes.find(
      item =>
        item.id === action?.targetId
    );

    let dx = hero.vx;
    let dy =
      Math.sin(time * 2 + hero.phase) *
      0.00025;

    let rotation = 0;
    let scale = 1;

    if (
      type === "stop" ||
      type === "hide"
    ) {
      dx = 0;
      dy = 0;
    }

    if (type === "dance") {
      rotation =
        Math.sin(time * 6) * 25;

      scale =
        1 + Math.sin(time * 6) * 0.08;
    }

    if (type === "spin") {
      rotation =
        time * 170 % 360;
    }

    if (
      type === "jump" ||
      type === "bounce"
    ) {
      dy =
        -Math.abs(Math.sin(time * 5)) *
        0.001;
    }

    if (type === "fly") {
      dy -= 0.0007;
    }

    if (type === "shake") {
      rotation =
        Math.sin(time * 15) * 12;
    }

    if (
      target &&
      ["follow", "meet", "circle"].includes(type)
    ) {
      const offsetX =
        type === "circle"
          ? Math.cos(time * 2) * 0.14
          : 0.1;

      const offsetY =
        type === "circle"
          ? Math.sin(time * 2) * 0.14
          : 0;

      dx =
        (target.x + offsetX - hero.x) *
        0.018;

      dy =
        (target.y + offsetY - hero.y) *
        0.018;
    }

    hero.x += dx;
    hero.y += dy;

    if (hero.x > 0.92) {
      hero.x = 0.92;
      hero.vx = -Math.abs(hero.vx);
      hero.face = -1;
    }

    if (hero.x < 0.08) {
      hero.x = 0.08;
      hero.vx = Math.abs(hero.vx);
      hero.face = 1;
    }

    hero.y = clamp(
      hero.y, 0.12, 0.87
    );

    hero.element.style.left =
      hero.x * 100 + "%";

    hero.element.style.top =
      hero.y * 100 + "%";

    hero.element.style.transform =
      "translate(-50%, -50%) " +
      "rotate(" + rotation + "deg) " +
      "scale(" +
      hero.face * scale +
      "," +
      scale +
      ")";

    if (hero.skillUntil > now) {
      drawHeroSkill(p, hero, time);
    }
  }
}

function drawHeroSkill(p, hero, time) {
  const skill = hero.skills.at(-1);
  if (!skill) return;

  const x = hero.x * p.width;
  const y = hero.y * p.height;

  const color =
    skill.color || "#ff66cc";

  p.push();

  if (
    ["laser", "lightning", "rainbow"].includes(
      skill.type
    )
  ) {
    p.stroke("white");
    p.strokeWeight(11);

    p.line(
      x,
      y - 16,
      x + hero.face * 240,
      y - 16
    );

    p.stroke(color);
    p.strokeWeight(5);

    p.line(
      x,
      y - 16,
      x + hero.face * 240,
      y - 16
    );
  } else if (skill.type === "glow") {
    p.noFill();
    p.stroke(color);
    p.strokeWeight(5);

    p.circle(
      x,
      y,
      150 + Math.sin(time * 6) * 15
    );
  } else {
    for (let i = 0; i < 5; i++) {
      const angle =
        time * 3 + i * Math.PI * 2 / 5;

      p.noStroke();
      p.fill(color);

      p.circle(
        x + Math.cos(angle) * 70,
        y + Math.sin(angle) * 70,
        12
      );
    }
  }

  p.pop();
}

function drawEgg(p, x, y, progress, time) {
  p.push();

  p.translate(x, y);

  p.rotate(
    Math.sin(time * 10) *
    (progress > 0.6 ? 0.12 : 0.03)
  );

  p.noStroke();
  p.fill("#fff1c4");
  p.ellipse(0, 0, 80, 100);

  if (progress > 0.5) {
    p.stroke("#c49471");
    p.strokeWeight(3);
    p.noFill();

    p.beginShape();
    p.vertex(-36, 5);
    p.vertex(-23, -8);
    p.vertex(-8, 7);
    p.vertex(7, -8);
    p.vertex(20, 5);
    p.vertex(36, -5);
    p.endShape();
  }

  if (progress > 0.8) {
    p.noStroke();
    p.fill(255, 238, 149, 160);

    p.circle(
      0,
      -10,
      90 + Math.sin(time * 10) * 20
    );
  }

  p.pop();
}

function drawScenes(p, time) {
  const now = performance.now();

  for (
    let i = state.scenes.length - 1;
    i >= 0;
    i--
  ) {
    const scene = state.scenes[i];

    const progress =
      (now - scene.start) /
      scene.duration;

    const x = p.width * 0.5;
    const y = p.height * 0.58;

    p.push();

    switch (scene.type) {
      case "egg":
        drawEgg(
          p, x, y, progress, time
        );
        break;

      case "rain":
      case "candyRain":
        for (let j = 0; j < 90; j++) {
          const xx =
            (j * 89 + time * 35) %
            p.width;

          const yy =
            (j * 127 + time * 200) %
            p.height;

          if (scene.type === "rain") {
            p.stroke("#e5faff");
            p.strokeWeight(2);

            p.line(
              xx, yy,
              xx - 5, yy + 16
            );
          } else {
            p.noStroke();

            p.fill(
              [
                "#ff98ba",
                "#ffdf86",
                "#b4a0ff",
                "#a5e8cb"
              ][j % 4]
            );

            p.circle(xx, yy, 12);
          }
        }
        break;

      case "rainbow":
        p.noFill();
        p.strokeWeight(10);

        [
          "#ff8b9e",
          "#ffba75",
          "#ffe98a",
          "#9de1ac",
          "#95c8ff",
          "#c3a2f2"
        ].forEach((color, j) => {
          p.stroke(color);

          p.arc(
            p.width / 2,
            p.height * 0.9,
            p.width * 0.7 - j * 20,
            p.height * 0.9 - j * 20,
            Math.PI,
            Math.PI * 2
          );
        });
        break;

      case "treasure":
        p.noStroke();
        p.fill("#a9784c");

        p.rect(
          x - 45,
          y - 20,
          90,
          55,
          7
        );

        p.fill("#ffe28c");

        p.rect(
          x - 45,
          y - 24,
          90,
          16,
          6
        );

        p.circle(x, y + 10, 15);
        break;

      case "night":
        p.noStroke();
        p.fill(18, 26, 70, 100);
        p.rect(
          0, 0,
          p.width, p.height
        );
        break;

      case "storm":
        p.stroke("#d5e5ff");
        p.strokeWeight(3);

        for (let j = 0; j < 70; j++) {
          const xx =
            (j * 101 + time * 60) %
            p.width;

          const yy =
            (j * 89 + time * 260) %
            p.height;

          p.line(
            xx, yy,
            xx - 12, yy + 23
          );
        }
        break;

      default:
        for (let j = 0; j < 12; j++) {
          const angle =
            time * 2 +
            j * Math.PI / 6;

          p.noStroke();
          p.fill("#fff2a2");

          p.circle(
            x + Math.cos(angle) * 80,
            y + Math.sin(angle) * 80,
            8
          );
        }
    }

    p.pop();

    if (progress > 1) {
      state.scenes.splice(i, 1);

      if (scene.type === "egg") {
        setSpeech(
          "🥚✨ 蛋孵化了！接下來會發生什麼呢？"
        );
      }
    }
  }
}

/* ==========================================
   介面按鈕
   ========================================== */

function setupButtons() {
  addClick("startButton", () => {
    modal("startScreen", false);

    if ("speechSynthesis" in window) {
      const unlock =
        new SpeechSynthesisUtterance(" ");
      speechSynthesis.speak(unlock);
    }

    setSpeech(
      "🌈 拍下你的第一個黏土朋友吧！"
    );
  });

  addClick("openCamera", openCamera);

  addClick("captureButton", capturePhoto);

  addClick("closeCamera", closeCamera);

  addClick("retryCamera", openCamera);

  addClick("switchCamera", () => {
    state.cameraFacing =
      state.cameraFacing === "environment"
        ? "user"
        : "environment";

    return openCamera();
  });

  addClick("uploadPhoto", () => {
    $("photoFile").click();
  });

  $("photoFile").addEventListener(
    "change",
    async event => {
      const file =
        event.target.files?.[0];

      event.target.value = "";

      if (!file) return;

      state.editorHeroId = null;

      try {
        await openEditor(
          await readFileAsDataURL(file)
        );
      } catch (error) {
        setStatus("❌ " + error.message);
      }
    }
  );

  addClick("editHero", async () => {
    const hero = selectedHero();

    if (!hero) {
      setStatus("請先選擇主角");
      return;
    }

    state.editorHeroId = hero.id;

    await openEditor(hero.original);
  });

  addClick(
    "deleteHero",
    removeSelectedHero
  );

  addClick("inspectHero", inspectHero);

  addClick(
    "removeBg",
    autoRemoveBackground
  );

  addClick("eraseMode", () => {
    state.editorMode = "erase";
    setStatus("🧽 擦除模式");
  });

  addClick("restoreMode", () => {
    state.editorMode = "restore";
    setStatus("🖌️ 還原模式");
  });

  addClick("undoEdit", undoEditor);

  addClick(
    "saveEditor",
    saveHeroFromEditor
  );

  addClick("closeEditor", () => {
    modal("editorModal", false);
  });

  const canvas = $("editCanvas");

  canvas.addEventListener(
    "pointerdown",
    event => {
      event.preventDefault();

      saveEditorHistory();

      state.editorPainting = true;

      state.editorLastPoint =
        editorPointer(event);

      canvas.setPointerCapture(
        event.pointerId
      );

      paintEditor(event);
    }
  );

  canvas.addEventListener(
    "pointermove",
    paintEditor
  );

  for (const eventName of [
    "pointerup",
    "pointercancel",
    "lostpointercapture"
  ]) {
    canvas.addEventListener(
      eventName,
      () => {
        state.editorPainting = false;
        state.editorLastPoint = null;
      }
    );
  }

  addClick(
    "micButton",
    toggleRecording
  );

  addClick(
    "sendButton",
    sendStory
  );

  addClick("voiceButton", () => {
    state.voiceEnabled =
      !state.voiceEnabled;

    $("voiceButton").textContent =
      "🔊 語音：" +
      (state.voiceEnabled ? "開" : "關");

    if (!state.voiceEnabled) {
      speechSynthesis.cancel();
    }
  });

  addClick("stopVoice", () => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    if (
      state.recorder?.state === "recording"
    ) {
      state.recorder.stop();
    }
  });

  $("selectedHero").addEventListener(
    "change",
    event => {
      state.selectedId =
        event.target.value;

      refreshHeroList();
    }
  );

  $("chatInput").addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        sendStory();
      }
    }
  );

  addClick("transformButton", async () => {
    const hero = selectedHero();

    const description =
      $("transformInput").value.trim();

    const button =
      $("transformButton");

    button.disabled = true;

    try {
      await transformHero(
        hero,
        description
      );
    } finally {
      button.disabled = false;
    }
  });

  addClick(
    "restoreButton",
    showOriginalHero
  );

  addClick(
    "showTransform",
    showTransformedHero
  );

  addClick("skillButton", () => {
    const hero = selectedHero();

    if (!hero?.skills.length) {
      setStatus(
        "請先讓主角學會技能"
      );
      return;
    }

    hero.skillUntil =
      performance.now() + 4000;

    setSpeech(
      "⚡ " + hero.name +
      " 表演：" +
      hero.skills.at(-1).name
    );
  });

  $("worldSelect").addEventListener(
    "change",
    event => {
      state.world =
        event.target.value;

      const themes = {
        ocean: [
          "🌊 Mindspace｜海底世界",
          "linear-gradient(#66c5eb,#aee9f5 75%,#73c8cb)"
        ],
        forest: [
          "🌳 Mindspace｜森林世界",
          "linear-gradient(#c2e9fa,#d4edba 75%,#90c988)"
        ],
        space: [
          "🚀 Mindspace｜太空世界",
          "linear-gradient(#101733,#323c78)"
        ]
      };

      $("worldTitle").textContent =
        themes[state.world][0];

      $("world").style.background =
        themes[state.world][1];
    }
  );

  addClick("resetButton", () => {
    if (!confirm(
      "確定要清除所有主角與故事嗎？"
    )) {
      return;
    }

    for (const hero of state.heroes) {
      hero.element.remove();
    }

    state.heroes = [];
    state.selectedId = null;
    state.history = [];
    state.scenes = [];

    $("chatLog").replaceChildren();
    $("appearance").textContent = "";

    refreshHeroList();

    setSpeech(
      "🌱 一起創造新的黏土朋友吧！"
    );

    setStatus("已開始新創作");
  });

  addClick("mobileToggle", () => {
    $("sidebar").classList.toggle(
      "collapsed"
    );

    setTimeout(() => {
      window.dispatchEvent(
        new Event("resize")
      );
    }, 250);
  });
}

/* ==========================================
   初始化
   ========================================== */

function initializeMindspace() {
  setupButtons();
  refreshHeroList();
  startP5World();
  initializeBridge();

  if (!GAS_URL.startsWith("https://")) {
    setStatus(
      "🌈 網頁已啟動，AI 後端尚未設定"
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeMindspace,
    { once: true }
  );
} else {
  initializeMindspace();
}
