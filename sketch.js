
"use strict";

/* =====================================================
   MINDSPACE V2 — SKETCH.JS
   與新版 index.html、ai-director.js、Code.gs 配合
===================================================== */

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbwUooMD69_NMBhTzxf0Os_D6BEGb3QsGyhXpTGv09emRcG_4du219K4qO_FggY1vnLHOg/exec";

const $ = id => document.getElementById(id);

const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));

const uid = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2, 9);

const state = {
  heroes: [],
  selectedId: null,
  world: "ocean",

  history: [],
  scenes: [],
  voiceEnabled: true,

  bridgeReady: false,
  bridgeWindow: null,
  bridgeOrigin: "",
  bridgeToken: uid() + uid(),
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
  editorLastPoint: null,

  audio: null,
  speechSerial: 0
};

/* ===== 基礎工具 ===== */

function status(message) {
  const el = $("status");

  if (el) {
    el.textContent = message;
  }

  console.log("[Mindspace]", message);
}

function bubble(message) {
  const el = $("speechBubble");

  if (el) {
    el.textContent = message;
  }
}

function modal(id, show) {
  const el = $(id);

  if (el) {
    el.classList.toggle(
      "hidden",
      !show
    );
  }
}

function heroNow() {
  return state.heroes.find(
    h => h.id === state.selectedId
  ) || null;
}

function click(id, fn) {
  const el = $(id);

  if (!el) {
    console.warn(
      "[Mindspace] 找不到按鈕：",
      id
    );
    return;
  }

  el.addEventListener(
    "click",
    () => {
      try {
        const result = fn();

        if (result?.catch) {
          result.catch(error => {
            status(
              "❌ " + error.message
            );
          });
        }
      } catch (error) {
        status(
          "❌ " + error.message
        );
      }
    }
  );
}

function imageLoad(src) {
  return new Promise(
    (resolve, reject) => {
      const image = new Image();

      image.onload = () =>
        resolve(image);

      image.onerror = () =>
        reject(
          Error("圖片載入失敗")
        );

      image.src = src;
    }
  );
}

function fileData(file) {
  return new Promise(
    (resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve(reader.result);

      reader.onerror = () =>
        reject(
          Error("無法讀取檔案")
        );

      reader.readAsDataURL(file);
    }
  );
}

async function scaledData(
  src,
  max = 650,
  format = "image/png"
) {
  const image = await imageLoad(src);

  const ratio = Math.min(
    1,
    max / Math.max(
      image.width,
      image.height
    )
  );

  const canvas =
    document.createElement("canvas");

  canvas.width = Math.max(
    1,
    Math.round(image.width * ratio)
  );

  canvas.height = Math.max(
    1,
    Math.round(image.height * ratio)
  );

  canvas
    .getContext("2d")
    .drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

  return canvas.toDataURL(
    format,
    format === "image/jpeg"
      ? 0.86
      : undefined
  );
}

/* =====================================================
   GAS BRIDGE
   GitHub Pages ↔ Google Apps Script
===================================================== */

function googleOrigin(origin) {
  try {
    const url = new URL(origin);
    const host =
      url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (
        host === "script.google.com" ||
        host === "script.googleusercontent.com" ||
        host.endsWith(
          ".googleusercontent.com"
        )
      )
    );

  } catch (error) {
    return false;
  }
}

function initializeBridge() {
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/
      .test(GAS_URL)
  ) {
    status(
      "❌ GAS_URL 不是有效的部署網址"
    );
    return;
  }

  const frame = $("bridgeFrame");

  if (!frame) {
    status(
      "❌ 找不到 GAS iframe"
    );
    return;
  }

  if (state.bridgeInitialized) {
    return;
  }

  state.bridgeInitialized = true;
  state.bridgeReady = false;
  state.bridgeWindow = null;
  state.bridgeOrigin = "";

  window.addEventListener(
    "message",
    event => {
      const message = event.data;

      if (!googleOrigin(event.origin)) {
        return;
      }

      if (
        !message ||
        typeof message !== "object"
      ) {
        return;
      }

      if (
        message.app !== "mindspace-v2"
      ) {
        return;
      }

      if (
        message.token !==
        state.bridgeToken
      ) {
        return;
      }

      if (message.kind === "ready") {
        if (!event.source) return;

        state.bridgeWindow =
          event.source;

        state.bridgeOrigin =
          event.origin;

        state.bridgeReady = true;

        status(
          "✅ GAS 橋接器已連線，可以測試 AI"
        );

        event.source.postMessage(
          {
            app: "mindspace-v2",
            kind: "ack",
            token: state.bridgeToken
          },
          "*"
        );

        return;
      }

      if (
        message.kind === "response"
      ) {
        const pending =
          state.pending.get(message.id);

        if (!pending) return;

        if (
          event.source !==
          state.bridgeWindow
        ) {
          return;
        }

        clearTimeout(
          pending.timer
        );

        state.pending.delete(
          message.id
        );

        if (message.ok) {
          pending.resolve(
            message.result
          );

        } else {
          pending.reject(
            new Error(
              message.error ||
              "GAS AI 後端執行失敗"
            )
          );
        }
      }
    }
  );

  const url = new URL(GAS_URL);

  url.searchParams.set(
    "bridgeToken",
    state.bridgeToken
  );

  url.searchParams.set(
    "parentOrigin",
    window.location.origin
  );

  frame.src = url.toString();

  frame.addEventListener(
    "error",
    () => {
      status(
        "❌ GAS iframe 載入失敗"
      );
    }
  );

  setTimeout(() => {
    if (!state.bridgeReady) {
      status(
        "⚠️ 尚未收到 GAS 連線訊息，" +
        "請檢查 Bridge.html 與部署版本"
      );
    }
  }, 15000);
}

function callAI(
  type,
  data = {},
  timeout = 120000
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !state.bridgeReady ||
        !state.bridgeWindow
      ) {
        reject(
          Error(
            "GAS 尚未連線，請先測試 AI 連線"
          )
        );
        return;
      }

      const id = uid();

      const timer = setTimeout(
        () => {
          state.pending.delete(id);

          reject(
            Error(
              "AI 回應逾時：" + type
            )
          );
        },
        timeout
      );

      state.pending.set(
        id,
        {
          resolve,
          reject,
          timer
        }
      );

      try {
        state.bridgeWindow.postMessage(
          {
            app: "mindspace-v2",
            kind: "request",
            token: state.bridgeToken,
            id,
            type,
            data
          },
          "*"
        );

      } catch (error) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(error);
      }
    }
  );
}

/* ===== AI 自然語音 ===== */

function stopSpeech() {
  state.speechSerial++;

  if (state.audio) {
    state.audio.pause();
    state.audio.src = "";
    state.audio = null;
  }

  if (
    "speechSynthesis" in window
  ) {
    speechSynthesis.cancel();
  }
}

function browserSpeech(text) {
  if (
    !state.voiceEnabled ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  const utterance =
    new SpeechSynthesisUtterance(text);

  utterance.lang = "zh-TW";
  utterance.rate = 0.96;
  utterance.pitch = 1.08;

  const voices =
    speechSynthesis.getVoices();

  utterance.voice =
    voices.find(
      v => v.lang === "zh-TW"
    ) ||
    voices.find(
      v => v.lang.startsWith("zh")
    ) ||
    null;

  speechSynthesis.speak(
    utterance
  );
}

async function speak(text) {
  if (
    !state.voiceEnabled ||
    !text
  ) {
    return;
  }

  stopSpeech();

  const serial =
    state.speechSerial;

  if (!state.bridgeReady) {
    browserSpeech(text);
    return;
  }

  try {
    const result = await callAI(
      "speakNatural",
      {
        text: text.slice(0, 550)
      }
    );

    if (
      serial !== state.speechSerial ||
      !state.voiceEnabled
    ) {
      return;
    }

    if (!result.audio) {
      throw Error(
        "沒有收到 AI 語音"
      );
    }

    const audio = new Audio(
      "data:audio/mpeg;base64," +
      result.audio
    );

    state.audio = audio;

    await audio.play();

  } catch (error) {
    console.warn(
      "AI 語音播放失敗：",
      error
    );

    if (
      serial === state.speechSerial
    ) {
      browserSpeech(text);
    }
  }
}

function chat(
  name,
  text,
  ai = false
) {
  const element =
    document.createElement("div");

  element.style.cssText =
    "padding:9px;" +
    "margin:6px 0;" +
    "border-radius:12px;" +
    "background:" +
    (
      ai
        ? "#ffe4ef"
        : "#e4f1ff"
    );

  element.textContent =
    name + "：" + text;

  $("chatLog").appendChild(
    element
  );

  $("chatLog").scrollTop =
    $("chatLog").scrollHeight;
}

function welcomeHero(hero) {
  const message =
    "哇！我誕生了！我是" +
    hero.name +
    "！你想讓我做什麼？" +
    "我們一起來玩吧！";

  chat(
    "🐠 " + hero.name,
    message,
    true
  );

  bubble(
    "🐠 " +
    hero.name +
    "：" +
    message
  );

  speak(message);
}

/* =====================================================
   攝影機
===================================================== */

function stopCamera() {
  state.cameraStream
    ?.getTracks()
    .forEach(track => {
      track.stop();
    });

  state.cameraStream = null;

  const video = $("cameraVideo");

  video.pause();
  video.srcObject = null;

  $("captureButton").disabled = true;
}

function closeCamera() {
  state.cameraRequestId++;

  stopCamera();

  modal(
    "cameraModal",
    false
  );
}

async function openCamera() {
  const requestId =
    ++state.cameraRequestId;

  stopCamera();

  modal(
    "cameraModal",
    true
  );

  $("cameraMessage").textContent =
    "正在開啟攝影機……";

  try {
    if (
      !navigator.mediaDevices
        ?.getUserMedia
    ) {
      throw Error(
        "需要 HTTPS 與攝影機權限"
      );
    }

    const stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: false,

          video: {
            facingMode: {
              ideal: state.cameraFacing
            },

            width: {
              ideal: 1280
            },

            height: {
              ideal: 720
            }
          }
        });

    if (
      requestId !==
      state.cameraRequestId
    ) {
      stream
        .getTracks()
        .forEach(track => {
          track.stop();
        });

      return;
    }

    state.cameraStream =
      stream;

    const video =
      $("cameraVideo");

    video.srcObject = stream;

    await video.play();

    $("captureButton").disabled =
      false;

    $("cameraMessage").textContent =
      "📸 攝影機已啟動，可以拍照！";

  } catch (error) {
    if (
      requestId ===
      state.cameraRequestId
    ) {
      stopCamera();

      $("cameraMessage").textContent =
        "⚠️ " + error.message;

      status(
        "❌ 攝影機：" +
        error.message
      );
    }
  }
}

async function capturePhoto() {
  const video =
    $("cameraVideo");

  if (!video.videoWidth) {
    throw Error(
      "攝影機尚未準備完成"
    );
  }

  const ratio = Math.min(
    1,
    1000 / video.videoWidth
  );

  const canvas =
    document.createElement("canvas");

  canvas.width = Math.round(
    video.videoWidth * ratio
  );

  canvas.height = Math.round(
    video.videoHeight * ratio
  );

  canvas
    .getContext("2d")
    .drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

  closeCamera();

  state.editorHeroId = null;

  await openEditor(
    canvas.toDataURL("image/png")
  );
}

/* =====================================================
   去背編輯器
===================================================== */

async function openEditor(src) {
  const image =
    await imageLoad(src);

  const canvas =
    $("editCanvas");

  const ratio = Math.min(
    1,
    1000 / Math.max(
      image.width,
      image.height
    )
  );

  canvas.width = Math.max(
    1,
    Math.round(
      image.width * ratio
    )
  );

  canvas.height = Math.max(
    1,
    Math.round(
      image.height * ratio
    )
  );

  const ctx = canvas.getContext(
    "2d",
    {
      willReadFrequently: true
    }
  );

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  state.editorOriginal =
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  state.editorHistory = [];
  state.editorMode = "erase";
  state.editorPainting = false;
  state.editorLastPoint = null;

  modal(
    "editorModal",
    true
  );
}

function editorHistory() {
  const canvas =
    $("editCanvas");

  const ctx =
    canvas.getContext("2d");

  state.editorHistory.push(
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )
  );

  if (
    state.editorHistory.length > 8
  ) {
    state.editorHistory.shift();
  }
}

function undoEditor() {
  const previous =
    state.editorHistory.pop();

  if (!previous) return;

  $("editCanvas")
    .getContext("2d")
    .putImageData(
      previous,
      0,
      0
    );
}

function resetEditor() {
  if (!state.editorOriginal) {
    return;
  }

  editorHistory();

  $("editCanvas")
    .getContext("2d")
    .putImageData(
      state.editorOriginal,
      0,
      0
    );
}

/* ===== 快速去背 ===== */

function quickRemoveBg() {
  const canvas =
    $("editCanvas");

  const width = canvas.width;
  const height = canvas.height;

  const ctx = canvas.getContext(
    "2d",
    {
      willReadFrequently: true
    }
  );

  const image = ctx.getImageData(
    0,
    0,
    width,
    height
  );

  const data = image.data;

  const bg = [0, 0, 0];

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];

  for (const [x, y] of corners) {
    const i =
      (y * width + x) * 4;

    for (let c = 0; c < 3; c++) {
      bg[c] += data[i + c] / 4;
    }
  }

  const seen = new Uint8Array(
    width * height
  );

  const queue = new Int32Array(
    width * height
  );

  let head = 0;
  let tail = 0;

  function enqueue(x, y) {
    if (
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ) {
      return;
    }

    const key =
      y * width + x;

    if (seen[key]) return;

    const i = key * 4;

    const difference =
      (data[i] - bg[0]) ** 2 +
      (data[i + 1] - bg[1]) ** 2 +
      (data[i + 2] - bg[2]) ** 2;

    if (difference > 4900) {
      return;
    }

    seen[key] = 1;

    queue[tail++] = key;
  }

  editorHistory();

  for (
    let x = 0;
    x < width;
    x++
  ) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (
    let y = 0;
    y < height;
    y++
  ) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const key = queue[head++];

    const x = key % width;
    const y = Math.floor(
      key / width
    );

    data[key * 4 + 3] = 0;

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  ctx.putImageData(
    image,
    0,
    0
  );

  status(
    "✨ 快速去背完成，可以用筆刷修整"
  );
}

/* ===== AI 自動去背 ===== */

async function aiRemoveBg() {
  const button =
    $("removeBgAI");

  button.disabled = true;

  status(
    "🤖 AI 正在辨識黏土與背景……"
  );

  try {
    const canvas =
      $("editCanvas");

    const image =
      await scaledData(
        canvas.toDataURL(
          "image/png"
        ),
        650
      );

    const result = await callAI(
      "removeBackgroundAI",
      {
        image
      },
      180000
    );

    if (!result.image) {
      throw Error(
        "AI 沒有回傳去背圖片"
      );
    }

    const removed =
      await imageLoad(
        result.image
      );

    editorHistory();

    const ctx =
      canvas.getContext("2d");

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      removed,
      0,
      0,
      canvas.width,
      canvas.height
    );

    status(
      "✅ AI 去背完成，" +
      "可以繼續用筆刷修整"
    );

  } finally {
    button.disabled = false;
  }
}

/* ===== 手動擦除與還原 ===== */

function editorPoint(event) {
  const canvas =
    $("editCanvas");

  const rect =
    canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      canvas.width /
      rect.width,

    y:
      (event.clientY - rect.top) *
      canvas.height /
      rect.height
  };
}

function paintEditor(event) {
  if (!state.editorPainting) {
    return;
  }

  event.preventDefault();

  const canvas =
    $("editCanvas");

  const ctx = canvas.getContext(
    "2d",
    {
      willReadFrequently: true
    }
  );

  const image = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const data = image.data;

  const original =
    state.editorOriginal.data;

  const point =
    editorPoint(event);

  const previous =
    state.editorLastPoint ||
    point;

  const radius =
    Number(
      $("brushSize").value
    ) / 2;

  const distance = Math.hypot(
    point.x - previous.x,
    point.y - previous.y
  );

  const steps = Math.max(
    1,
    Math.ceil(
      distance /
      Math.max(1, radius / 2)
    )
  );

  for (
    let step = 0;
    step <= steps;
    step++
  ) {
    const x =
      previous.x +
      (point.x - previous.x) *
      step / steps;

    const y =
      previous.y +
      (point.y - previous.y) *
      step / steps;

    const minY = Math.max(
      0,
      Math.floor(y - radius)
    );

    const maxY = Math.min(
      canvas.height - 1,
      Math.ceil(y + radius)
    );

    const minX = Math.max(
      0,
      Math.floor(x - radius)
    );

    const maxX = Math.min(
      canvas.width - 1,
      Math.ceil(x + radius)
    );

    for (
      let yy = minY;
      yy <= maxY;
      yy++
    ) {
      for (
        let xx = minX;
        xx <= maxX;
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
          (yy * canvas.width + xx) *
          4;

        if (
          state.editorMode === "erase"
        ) {
          data[i + 3] = 0;

        } else {
          for (
            let c = 0;
            c < 4;
            c++
          ) {
            data[i + c] =
              original[i + c];
          }
        }
      }
    }
  }

  ctx.putImageData(
    image,
    0,
    0
  );

  state.editorLastPoint =
    point;
}

/* ===== 自動裁切透明圖片 ===== */

function cropEditor() {
  const canvas =
    $("editCanvas");

  const width = canvas.width;
  const height = canvas.height;

  const data = canvas
    .getContext("2d")
    .getImageData(
      0,
      0,
      width,
      height
    ).data;

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (
    let y = 0;
    y < height;
    y++
  ) {
    for (
      let x = 0;
      x < width;
      x++
    ) {
      const alpha =
        data[
          (y * width + x) * 4 + 3
        ];

      if (alpha > 10) {
        left = Math.min(
          left,
          x
        );

        right = Math.max(
          right,
          x
        );

        top = Math.min(
          top,
          y
        );

        bottom = Math.max(
          bottom,
          y
        );
      }
    }
  }

  if (right < left) {
    throw Error(
      "圖片已全部透明，請先還原"
    );
  }

  left = Math.max(
    0,
    left - 5
  );

  top = Math.max(
    0,
    top - 5
  );

  right = Math.min(
    width - 1,
    right + 5
  );

  bottom = Math.min(
    height - 1,
    bottom + 5
  );

  const output =
    document.createElement("canvas");

  output.width =
    right - left + 1;

  output.height =
    bottom - top + 1;

  output
    .getContext("2d")
    .drawImage(
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

  return output.toDataURL(
    "image/png"
  );
}

/* ===== SKETCH.JS 上半段結束 ===== */

/* =====================================================
   MINDSPACE V2 — SKETCH.JS 下半段
   主角、語音、世界、背景、按鈕
===================================================== */

/* ===== 黏土主角 ===== */

function createHeroElement(h) {
  const el = document.createElement("div");
  el.className = "mindspace-hero";
  el.dataset.heroId = h.id;
  el.style.cssText =
    "position:absolute;width:145px;height:145px;" +
    "transform-origin:center;pointer-events:auto;" +
    "cursor:pointer;will-change:left,top,transform";

  const original = document.createElement("img");
  original.src = h.original;
  original.draggable = false;
  original.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;" +
    "object-fit:contain;filter:drop-shadow(0 5px 7px #2345)";

  const transformed = document.createElement("img");
  transformed.draggable = false;
  transformed.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;" +
    "object-fit:contain;display:none";

  const label = document.createElement("span");
  label.textContent = h.name;
  label.style.cssText =
    "position:absolute;bottom:-23px;left:50%;" +
    "transform:translateX(-50%);white-space:nowrap;" +
    "background:#ffffffed;border-radius:15px;" +
    "padding:4px 10px;font-size:12px;font-weight:bold";

  el.append(original, transformed, label);
  $("actors").appendChild(el);

  h.element = el;
  h.originalElement = original;
  h.transformedElement = transformed;
  h.nameElement = label;

  el.addEventListener("click", () => {
    state.selectedId = h.id;
    refreshHeroes();
  });
}

function refreshHeroes() {
  const list = $("heroList");
  const select = $("selectedHero");

  list.replaceChildren();
  select.replaceChildren();

  for (const h of state.heroes) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:7px;" +
      "padding:7px;margin-bottom:6px;border-radius:12px;" +
      "background:" +
      (h.id === state.selectedId ? "#e6d7ff" : "#f3ecff");

    const img = document.createElement("img");
    img.src = h.original;
    img.style.cssText =
      "width:43px;height:43px;object-fit:contain";

    const choose = document.createElement("button");
    choose.textContent = h.name;
    choose.style.flex = "1";
    choose.onclick = () => {
      state.selectedId = h.id;
      refreshHeroes();
    };

    const rename = document.createElement("button");
    rename.textContent = "✏️";
    rename.title = "重新命名黏土朋友";
    rename.onclick = () => {
      const name = prompt("幫黏土朋友取名字", h.name);
      if (!name?.trim()) return;
      h.name = name.trim().slice(0, 30);
      h.nameElement.textContent = h.name;
      refreshHeroes();
    };

    row.append(img, choose, rename);
    list.appendChild(row);

    const option = document.createElement("option");
    option.value = h.id;
    option.textContent = h.name;
    select.appendChild(option);

    if (h.element) {
      h.element.style.zIndex =
        h.id === state.selectedId ? "12" : "5";
    }
  }

  if (!state.heroes.length) {
    list.textContent = "🌱 還沒有黏土主角";
  }

  select.value = state.selectedId || "";

  const h = heroNow();
  $("appearance").textContent = h?.appearance
    ? "🧠 " + h.appearance +
      (h.personality ? "｜💭 " + h.personality : "")
    : "";
}

function saveHero() {
  const image = cropEditor();
  const first = state.heroes.length === 0;

  let h = state.heroes.find(
    x => x.id === state.editorHeroId
  );

  if (h) {
    h.original = image;
    h.transformed = null;
    h.originalElement.src = image;
    h.originalElement.style.display = "block";
    h.transformedElement.style.display = "none";
  } else {
    h = {
      id: uid(),
      name: "黏土朋友" + (state.heroes.length + 1),
      original: image,
      transformed: null,
      appearance: "",
      personality: "",
      skills: [],
      aiSkills: [],
      x: 0.23 + (state.heroes.length % 3) * 0.23,
      y: 0.37 + (state.heroes.length % 2) * 0.17,
      vx: 0.00025,
      face: 1,
      phase: Math.random() * Math.PI * 2,
      action: null,
      skillUntil: 0,
      activeSkillEffects: []
    };

    state.heroes.push(h);
    createHeroElement(h);
  }

  state.selectedId = h.id;
  state.editorHeroId = null;

  modal("editorModal", false);
  refreshHeroes();

  status("🌈 " + h.name + " 已放入世界！");

  if (first) welcomeHero(h);
}

function removeHero() {
  const h = heroNow();
  if (!h) return status("請先選擇主角");

  if (!confirm("確定移除「" + h.name + "」嗎？")) {
    return;
  }

  h.element?.remove();
  state.heroes = state.heroes.filter(x => x.id !== h.id);
  state.selectedId = state.heroes[0]?.id || null;

  refreshHeroes();
  status("已移除：" + h.name);
}

async function inspectHero() {
  const h = heroNow();
  if (!h) throw Error("請先創造黏土主角");

  status("🧠 AI 正在觀察黏土的形狀與材質……");

  const result = await callAI("inspect", {
    image: await scaledData(h.original, 650)
  });

  h.appearance = result.appearance || "";
  h.personality = result.personality || "";

  refreshHeroes();

  chat(
    "🧠 AI 觀察",
    h.appearance || "已完成觀察",
    true
  );

  status("✅ AI 已認識黏土朋友");
}

/* ===== AI 黏土造型變身 ===== */

async function transformHero(h, description) {
  if (!h) throw Error("請先選擇黏土主角");

  const text = String(description || "").trim();
  if (!text) throw Error("請描述想要的黏土造型");

  status("🎨 AI 正在保留手作黏土質感並創造新造型……");

  const result = await callAI(
    "transform",
    {
      image: await scaledData(h.original, 650),
      description: text.slice(0, 500)
    },
    180000
  );

  if (!result.image) {
    throw Error("AI 沒有回傳黏土變身圖片");
  }

  h.transformed = result.image;
  h.transformedElement.src = result.image;

  h.originalElement.style.display = "none";
  h.transformedElement.style.display = "block";

  status("✨ AI 黏土造型完成");
  return result.image;
}

function showOriginal() {
  const h = heroNow();
  if (!h) return;

  h.originalElement.style.display = "block";
  h.transformedElement.style.display = "none";

  status("已切換至孩子原本的黏土作品");
}

function showTransform() {
  const h = heroNow();
  if (!h) return;

  if (!h.transformed) {
    status("這個角色還沒有 AI 黏土變身造型");
    return;
  }

  h.originalElement.style.display = "none";
  h.transformedElement.style.display = "block";

  status("已切換至 AI 黏土造型");
}

/* ===== 麥克風與語音辨識 ===== */

function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(Error("錄音讀取失敗"));
    reader.readAsDataURL(blob);
  });
}

async function wav16k(blob) {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw Error("瀏覽器不支援音訊解碼");
  }

  const context = new AudioContextClass();

  try {
    const decoded = await context.decodeAudioData(
      await blob.arrayBuffer()
    );

    const rate = 16000;
    const length = Math.max(
      1,
      Math.floor(decoded.duration * rate)
    );

    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);

    function writeString(offset, value) {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint16(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, i) => decoded.getChannelData(i)
    );

    for (let i = 0; i < length; i++) {
      const position = i * decoded.sampleRate / rate;
      const a = Math.floor(position);
      const b = Math.min(a + 1, decoded.length - 1);
      const fraction = position - a;

      let sample = 0;

      for (const channel of channels) {
        sample +=
          (channel[a] || 0) * (1 - fraction) +
          (channel[b] || 0) * fraction;
      }

      sample = clamp(sample / channels.length, -1, 1);

      view.setInt16(
        44 + i * 2,
        sample < 0 ? sample * 32768 : sample * 32767,
        true
      );
    }

    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

async function toggleRecording() {
  if (state.recording) {
    if (state.recorder?.state === "recording") {
      state.recorder.stop();
    }
    return;
  }

  if (!state.bridgeReady) {
    throw Error("請先等待 AI 連線成功");
  }

  if (!navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder) {
    throw Error("瀏覽器不支援麥克風錄音");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true
    }
  });

  const formats = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm"
  ];

  const mime = formats.find(
    type => MediaRecorder.isTypeSupported(type)
  );

  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : {}
  );

  state.audioStream = stream;
  state.recorder = recorder;
  state.audioChunks = [];
  state.recording = true;

  recorder.ondataavailable = event => {
    if (event.data.size) {
      state.audioChunks.push(event.data);
    }
  };

  recorder.onstop = finishRecording;
  recorder.start();

  $("micButton").textContent = "⏹️ 結束說話";
  status("🎤 正在聆聽孩子說話……");
}

async function finishRecording() {
  state.recording = false;
  $("micButton").textContent = "🎙️ 開始說話";

  state.audioStream?.getTracks().forEach(
    track => track.stop()
  );
  state.audioStream = null;

  try {
    const blob = new Blob(state.audioChunks, {
      type: state.recorder?.mimeType || "audio/webm"
    });

    if (!blob.size) throw Error("沒有收到錄音");

    status("🧠 AI 正在辨識孩子的話……");

    const wav = await wav16k(blob);
    const audio = await blobBase64(wav);

    if (audio.length > 7000000) {
      throw Error("錄音太長，請縮短錄音時間");
    }

    const result = await callAI(
      "transcribe",
      { audio },
      120000
    );

    const text = String(result.text || "").trim();
    $("chatInput").value = text;

    if (text) {
      await sendStory();
    } else {
      status("沒有辨識到語音，請再試一次");
    }
  } catch (error) {
    status("❌ 語音辨識：" + error.message);
  } finally {
    state.recorder = null;
    state.audioChunks = [];
  }
}

/* ===== 基礎 AI 故事與角色動作 ===== */

const ACTION_TYPES = new Set([
  "swim", "stop", "hide", "dance", "spin",
  "jump", "bounce", "fly", "shake",
  "follow", "meet", "circle", "laser"
]);

function performAction(action) {
  const h = state.heroes.find(
    x => x.id === action.heroId
  );
  if (!h) return;

  const type = ACTION_TYPES.has(action.type)
    ? action.type
    : "swim";

  h.action = {
    type,
    targetId: action.targetId || "",
    until:
      performance.now() +
      clamp(Number(action.duration) || 6, 1, 20) * 1000
  };

  if (type === "laser") {
    const laser = { name: "雷射光", type: "laser", color: "#ff66cc" };
    if (!h.skills.some(s => s.type === "laser")) h.skills.push(laser);
    activateHeroSkill(h, laser, 4000);
  }
}

function addScene(scene) {
  state.scenes.push({
    type: scene.type || "sparkle",
    description: scene.description || "",
    start: performance.now(),
    duration:
      clamp(Number(scene.duration) || 7, 2, 20) * 1000
  });
}

/*
  基礎故事功能。
  載入 ai-director.js 後，
  AI 導演會接管主要對話與動畫流程。
*/

async function sendStory() {
  if (state.busy) return;

  const hero = heroNow();
  const message = $("chatInput").value.trim();

  if (!hero) {
    status("請先創造黏土主角");
    return;
  }

  if (!message) return;

  state.busy = true;
  $("sendButton").disabled = true;
  $("chatInput").value = "";

  chat("🧒 孩子", message);
  status("🤖 AI 正在理解故事……");

  try {
    const result = await callAI(
      "story",
      {
        message,
        selectedHeroId: hero.id,
        heroes: state.heroes.map(h => ({
          id: h.id,
          name: h.name,
          appearance: h.appearance,
          personality: h.personality,
          skills: h.skills.map(s => s.name)
        })),
        history: state.history.slice(-12)
      },
      120000
    );

    const speaker = state.heroes.find(
      h => h.id === result.speakerId
    ) || hero;

    const reply =
      result.reply || "哇！我們一起試試看吧！";

    chat("🐠 " + speaker.name, reply, true);
    bubble("🐠 " + speaker.name + "：" + reply);
    speak(reply);

    state.history.push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

    state.history = state.history.slice(-24);

    for (const action of result.actions || []) {
      performAction(action);
    }

    for (const scene of result.scenes || []) {
      addScene(scene);
    }

    for (const skill of result.skills || []) {
      const target = state.heroes.find(
        h => h.id === skill.heroId
      );

      if (!target) continue;

      const newSkill = {
        name: skill.name || "神奇技能",
        type: skill.type || "glow",
        description: skill.description || "",
        color: skill.color || "#ff66cc"
      };

      // 保留所有學會的能力；新能力不會覆蓋舊能力。
      if (!target.skills.some(s =>
        s.name === newSkill.name && s.type === newSkill.type
      )) {
        target.skills.push(newSkill);
      }

      activateHeroSkill(target, newSkill, 4500);
    }

    for (const change of result.transforms || []) {
      const target = state.heroes.find(
        h => h.id === change.heroId
      );

      if (!target) continue;

      try {
        await transformHero(target, change.description);
      } catch (error) {
        status("⚠️ AI 變身失敗：" + error.message);
      }
    }

    status("🌈 故事已更新");
  } catch (error) {
    status("❌ AI 故事：" + error.message);
    chat("⚠️ 系統", error.message, true);
  } finally {
    state.busy = false;
    $("sendButton").disabled = false;
  }
}

/* ===== p5.js 三個世界 ===== */

function drawEnvironment(p, t) {
  p.push();

  if (state.world === "ocean") {
    // 水泡
    for (let i = 0; i < 32; i++) {
      const x =
        (i * 137 + Math.sin(t + i) * 18) % p.width;

      const y =
        (p.height - (t * 20 + i * 83) % p.height +
          p.height) % p.height;

      p.noFill();
      p.stroke(255, 255, 255, 100);
      p.strokeWeight(2);
      p.circle(x, y, 8 + (i % 5) * 4);
    }

    p.noStroke();
    p.fill(226, 211, 164, 180);
    p.rect(0, p.height * 0.95, p.width, p.height * 0.05);

    for (let i = 0; i < 14; i++) {
      const x = (i + 0.5) * p.width / 14;
      const sway = Math.sin(t * 1.5 + i) * 13;

      p.noFill();
      p.stroke(69, 159, 129, 175);
      p.strokeWeight(7);
      p.bezier(
        x, p.height,
        x - 16, p.height - 35,
        x + sway, p.height - 65,
        x + sway, p.height - 85
      );
    }
  }

  if (state.world === "forest") {
    p.noStroke();
    p.fill(126, 190, 112, 180);
    p.rect(
      0, p.height * 0.83,
      p.width, p.height * 0.17
    );

    for (let i = 0; i < 8; i++) {
      const x = (i + 0.5) * p.width / 8;
      const y = p.height * 0.7;

      p.fill(143, 105, 77, 190);
      p.rect(x - 7, y, 14, p.height * 0.17);

      p.fill(83, 164, 103, 165);
      p.circle(x, y - 35, 82);

      p.fill(145, 209, 130, 145);
      p.circle(x - 20, y - 49, 39);
    }

    for (let i = 0; i < 18; i++) {
      const x =
        (i * 107 + Math.sin(t + i) * 15) % p.width;

      const y =
        (i * 83 + Math.cos(t + i) * 20) %
        (p.height * 0.8);

      p.fill(255, 246, 160, 160);
      p.circle(x, y, 5);
    }
  }

  if (state.world === "space") {
    for (let i = 0; i < 95; i++) {
      const x = (i * 131) % p.width;
      const y = (i * 97) % p.height;

      p.noStroke();
      p.fill(
        255, 255, 230,
        155 + Math.sin(t * 2 + i) * 80
      );
      p.circle(x, y, 2 + (i % 3));
    }

    p.noStroke();
    p.fill(190, 160, 255, 100);
    p.circle(
      p.width * 0.82,
      p.height * 0.2,
      115
    );

    p.noFill();
    p.stroke(226, 208, 255, 120);
    p.strokeWeight(7);
    p.ellipse(
      p.width * 0.82,
      p.height * 0.2,
      160,
      48
    );
  }

  p.pop();
}

/* ===== 角色技能特效 ===== */

function activateHeroSkill(h, skill, duration = 4500) {
  if (!h || !skill) return;
  const now = performance.now();
  if (!Array.isArray(h.activeSkillEffects)) h.activeSkillEffects = [];
  const key = String(skill.type || "") + ":" + String(skill.name || "");
  const existing = h.activeSkillEffects.find(e => e.key === key && e.until > now);
  if (existing) {
    existing.until = now + duration;
  } else {
    h.activeSkillEffects.push({ key, skill, start: now, until: now + duration });
  }
  h.skillUntil = Math.max(h.skillUntil || 0, now + duration);
}

function heroSkillKind(skill) {
  const text = [skill?.type, skill?.name, skill?.description]
    .filter(Boolean).join(" ").toLowerCase();
  if (/laser|雷射|激光|光束/.test(text)) return "laser";
  if (/bubble|泡泡|氣泡/.test(text)) return "bubble";
  if (/fire|flame|火焰|噴火|火球/.test(text)) return "fire";
  if (/lightning|electric|閃電|雷電|電擊/.test(text)) return "lightning";
  if (/ice|snow|冰|雪|冷凍/.test(text)) return "ice";
  if (/wind|tornado|風|龍捲/.test(text)) return "wind";
  if (/heart|love|愛心|愛|治癒/.test(text)) return "heart";
  if (/star|sparkle|星星|星光/.test(text)) return "star";
  return "glow";
}

function drawOneHeroSkill(p, h, t, skill, index) {
  const x = h.x * p.width;
  const y = h.y * p.height;
  const face = h.face >= 0 ? 1 : -1;
  const kind = heroSkillKind(skill);
  const seed = index * 1.618;
  p.push();
  if (kind === "laser") {
    const sx = x + face * 32, sy = y - 17;
    const ex = sx + face * 205;
    const pulse = 1 + Math.sin(t * 17 + seed) * 0.15;
    p.strokeCap(p.ROUND);
    p.stroke(255, 65, 190, 50); p.strokeWeight(27 * pulse);
    p.line(sx, sy, ex, sy);
    p.stroke(255, 120, 220, 190); p.strokeWeight(11 * pulse);
    p.line(sx, sy, ex, sy);
    p.stroke(255, 255, 255, 245); p.strokeWeight(3);
    p.line(sx, sy, ex, sy);
    p.noStroke(); p.fill(255, 170, 235, 180); p.circle(ex, sy, 23);
  } else if (kind === "bubble") {
    for (let i = 0; i < 24; i++) {
      const age = (t * 0.33 + i / 24 + seed) % 1;
      const bx = x + face * (24 + age * 105) + Math.sin(t * 2 + i) * 11;
      const by = y - 5 - age * 145 + Math.sin(i * 2) * 8;
      const size = 7 + i % 5 * 4;
      p.noFill(); p.stroke(175, 245, 255, 195 * (1 - age));
      p.strokeWeight(1.8); p.circle(bx, by, size);
    }
  } else if (kind === "fire") {
    p.noStroke();
    for (let i = 0; i < 42; i++) {
      const age = (t * 0.8 + i * 0.137 + seed) % 1;
      const px = x + face * (26 + age * 160);
      const py = y + Math.sin(i * 3 + t * 7) * (6 + age * 25);
      p.fill(255, 240 - age * 165, 40 + age * 30, 210 * (1 - age));
      p.circle(px, py, Math.max(2, (1 - age) * (15 + i % 12)));
    }
  } else if (kind === "lightning") {
    const frame = Math.floor(t * 13);
    for (let b = 0; b < 3; b++) {
      const points = [];
      for (let i = 0; i <= 12; i++) {
        const q = i / 12;
        points.push([x + face * (25 + q * 175),
          y + (b - 1) * q * 55 + Math.sin(frame * 17 + i * 39 + b * 7) * 17]);
      }
      for (const layer of [[13, 70], [5, 195], [2, 255]]) {
        p.noFill(); p.stroke(135, 215, 255, layer[1]);
        p.strokeWeight(layer[0]); p.beginShape();
        for (const point of points) p.vertex(point[0], point[1]);
        p.endShape();
      }
    }
  } else if (kind === "wind") {
    p.noFill();
    for (let i = 0; i < 9; i++) {
      const age = (t * 0.65 + i / 9 + seed) % 1;
      const wx = x + face * (35 + age * 165);
      const wy = y + Math.sin(i * 2.5 + t * 3) * (15 + age * 42);
      p.stroke(195, 250, 240, 200 * (1 - age));
      p.strokeWeight(2 + (i % 3));
      p.arc(wx, wy, 30 + age * 28, 15 + age * 16, -1, 1.6);
    }
  } else {
    const colors = kind === "ice" ? [145, 225, 255]
      : kind === "heart" ? [255, 125, 185]
      : kind === "star" ? [255, 235, 130] : [255, 180, 220];
    p.noStroke();
    for (let i = 0; i < 22; i++) {
      const angle = t * 1.6 + i * Math.PI * 2 / 22 + seed;
      const radius = 52 + Math.sin(t * 4 + i) * 16;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      p.fill(...colors, 175);
      if (kind === "heart") {
        p.textAlign(p.CENTER, p.CENTER); p.textSize(13 + i % 5);
        p.text("♥", px, py);
      } else {
        p.circle(px, py, 4 + i % 5);
      }
    }
  }
  p.pop();
}

function drawHeroSkill(p, h, t) {
  const now = performance.now();
  if (!Array.isArray(h.activeSkillEffects)) h.activeSkillEffects = [];
  h.activeSkillEffects = h.activeSkillEffects.filter(e => e.until > now);
  // 多個技能可以同時啟動、同時顯示，互不覆蓋。
  for (let i = 0; i < h.activeSkillEffects.length; i++) {
    drawOneHeroSkill(p, h, t, h.activeSkillEffects[i].skill, i);
  }
}

/* ===== 黏土角色動畫 ===== */

function animateHeroes(p, t) {
  const now = performance.now();

  for (const h of state.heroes) {
    const active =
      h.action && h.action.until > now
        ? h.action
        : null;

    const type = active?.type || "swim";
    const target = state.heroes.find(
      x => x.id === active?.targetId
    );

    let dx = h.vx || 0;
    let dy = Math.sin(t * 2 + h.phase) * 0.0003;
    let angle = 0;
    let scale = 1;
    let flip = 1;

    if (type === "stop" || type === "hide") {
      dx = 0;
      dy = 0;
    }

    if (type === "dance") {
      angle = Math.sin(t * 6) * 12;
      scale = 1 + Math.sin(t * 6) * 0.08;
    }

    // 水平左右翻身，不是上下顛倒
    if (type === "spin") {
      flip = Math.cos(t * 5);
    }

    if (type === "jump" || type === "bounce") {
      dy -= Math.abs(Math.sin(t * 5)) * 0.001;
    }

    if (type === "fly") {
      dy -= 0.0006;
    }

    if (type === "shake") {
      angle = Math.sin(t * 14) * 12;
    }

    if (target &&
        ["follow", "meet", "circle"].includes(type)) {
      const ox =
        type === "circle"
          ? Math.cos(t * 2) * 0.14
          : 0.1;

      const oy =
        type === "circle"
          ? Math.sin(t * 2) * 0.14
          : 0;

      dx = (target.x + ox - h.x) * 0.018;
      dy = (target.y + oy - h.y) * 0.018;
    }

    h.x += dx;
    h.y += dy;

    if (h.x > 0.94) {
      h.x = 0.94;
      h.vx = -Math.abs(h.vx);
      h.face = -1;
    }

    if (h.x < 0.06) {
      h.x = 0.06;
      h.vx = Math.abs(h.vx);
      h.face = 1;
    }

    h.y = clamp(h.y, 0.12, 0.88);

    if (h.element) {
      h.element.style.left = h.x * 100 + "%";
      h.element.style.top = h.y * 100 + "%";

      h.element.style.transform =
        "translate(-50%,-50%) " +
        "rotate(" + angle + "deg) " +
        "scale(" +
        h.face * flip * scale +
        "," + scale + ")";

      h.element.style.opacity =
        type === "hide" ? "0.3" : "1";

      // 父元素翻轉時，文字以相反方向翻回正常閱讀方向。
      if (h.nameElement) {
        const mirrored = h.face * flip * scale < 0;
        h.nameElement.style.transform =
          "translateX(-50%) scaleX(" + (mirrored ? -1 : 1) + ")";
        h.nameElement.style.direction = "ltr";
        h.nameElement.style.unicodeBidi = "isolate";
      }
    }

    drawHeroSkill(p, h, t);
  }
}

/* ===== 故事場景效果 ===== */

function drawScenes(p, t) {
  const now = performance.now();

  for (let i = state.scenes.length - 1; i >= 0; i--) {
    const scene = state.scenes[i];
    const progress =
      (now - scene.start) / scene.duration;

    if (progress >= 1) {
      state.scenes.splice(i, 1);
      continue;
    }

    p.push();
    p.noStroke();

    const cx = p.width / 2;
    const cy = p.height / 2;

    for (let j = 0; j < 22; j++) {
      const angle = j * Math.PI / 11 + t;
      const radius = 35 + progress * 160;

      p.fill(
        255, 222, 150,
        175 * (1 - progress)
      );

      p.circle(
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        6
      );
    }

    p.pop();
  }
}

/* ===== 啟動 p5.js ===== */

function startP5World() {
  if (typeof p5 === "undefined") {
    status("❌ p5.js 載入失敗");
    return;
  }

  new p5(p => {
    p.setup = () => {
      const world = $("world");

      p.createCanvas(
        Math.max(1, world.clientWidth),
        Math.max(1, world.clientHeight)
      ).parent("scene");

      p.frameRate(60);
    };

    p.draw = () => {
      const t = performance.now() / 1000;

      p.clear();
      drawEnvironment(p, t);
      animateHeroes(p, t);
      drawScenes(p, t);
    };

    p.windowResized = () => {
      const world = $("world");

      p.resizeCanvas(
        Math.max(1, world.clientWidth),
        Math.max(1, world.clientHeight)
      );
    };
  });
}

function resizeWorld() {
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 250);
}

/* ===== 更換背景圖片 ===== */

const defaultBackgrounds = {
  ocean:
    "linear-gradient(#66c5eb,#aee9f5 75%,#73c8cb)",
  forest:
    "linear-gradient(#c2e9fa,#d4edba 75%,#90c988)",
  space:
    "linear-gradient(#101733,#323c78)"
};

let customBackgroundUrl = null;

function applyWorldBackground() {
  const world = $("world");

  if (customBackgroundUrl) {
    world.style.backgroundImage =
      'url("' + customBackgroundUrl + '")';
    world.style.backgroundSize = "cover";
    world.style.backgroundPosition = "center";
    return;
  }

  world.style.background =
    defaultBackgrounds[state.world] ||
    defaultBackgrounds.ocean;
}

function setupBackgroundButtons() {
  $("teacherBg").addEventListener(
    "change",
    async event => {
      const file = event.target.files?.[0];

      if (!file) return;

      if (!file.type.startsWith("image/")) {
        status("請選擇圖片檔案");
        return;
      }

      try {
        const data = await fileData(file);
        await imageLoad(data);

        customBackgroundUrl = data;
        applyWorldBackground();

        status("🖼️ 背景圖片更換成功");
      } catch (error) {
        status("❌ 背景圖片：" + error.message);
      }
    }
  );

  click("clearTeacherBg", () => {
    customBackgroundUrl = null;
    $("teacherBg").value = "";

    applyWorldBackground();

    status("已恢復預設背景");
  });
}

/* ===== 按鈕初始化 ===== */

function setupButtons() {
  // 開始
  click("startButton", () => {
    modal("startScreen", false);
    bubble("🌈 創造你的第一個黏土朋友吧！");
  });

  // 攝影機
  click("openCamera", openCamera);
  click("captureButton", capturePhoto);
  click("closeCamera", closeCamera);
  click("retryCamera", openCamera);

  click("switchCamera", () => {
    state.cameraFacing =
      state.cameraFacing === "environment"
        ? "user"
        : "environment";

    return openCamera();
  });

  // 上傳圖片
  click("uploadPhoto", () => $("photoFile").click());

  $("photoFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      state.editorHeroId = null;
      await openEditor(await fileData(file));
    } catch (error) {
      status("❌ 照片：" + error.message);
    }
  });

  // 編輯角色
  click("editHero", async () => {
    const h = heroNow();
    if (!h) throw Error("請先選擇黏土主角");

    state.editorHeroId = h.id;
    await openEditor(h.original);
  });

  click("deleteHero", removeHero);
  click("inspectHero", inspectHero);

  // AI 去背
  click("removeBgAI", aiRemoveBg);

  // 快速去背
  click("removeBg", quickRemoveBg);

  // 手動編輯
  click("eraseMode", () => {
    state.editorMode = "erase";
    status("🧽 擦除模式");
  });

  click("restoreMode", () => {
    state.editorMode = "restore";
    status("🖌️ 還原模式");
  });

  click("undoEdit", undoEditor);
  click("resetEdit", resetEditor);
  click("saveEditor", saveHero);

  click("closeEditor", () => {
    modal("editorModal", false);
  });

  const canvas = $("editCanvas");

  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();

    editorHistory();

    state.editorPainting = true;
    state.editorLastPoint = editorPoint(event);

    canvas.setPointerCapture(event.pointerId);
    paintEditor(event);
  });

  canvas.addEventListener("pointermove", paintEditor);

  for (const type of [
    "pointerup",
    "pointercancel",
    "lostpointercapture"
  ]) {
    canvas.addEventListener(type, () => {
      state.editorPainting = false;
      state.editorLastPoint = null;
    });
  }

  // 語音與對話
  click("micButton", toggleRecording);
  click("sendButton", sendStory);

  click("voiceButton", () => {
    state.voiceEnabled = !state.voiceEnabled;

    $("voiceButton").textContent =
      "🔊 語音：" +
      (state.voiceEnabled ? "開" : "關");

    if (!state.voiceEnabled) stopSpeech();
  });

  click("stopVoice", () => {
    stopSpeech();

    if (state.recorder?.state === "recording") {
      state.recorder.stop();
    }
  });

  $("chatInput").addEventListener("keydown", event => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      sendStory();
    }
  });

  // 主角選擇
  $("selectedHero").addEventListener("change", event => {
    state.selectedId = event.target.value;
    refreshHeroes();
  });

  // 黏土變身
  click("transformButton", async () => {
    const button = $("transformButton");
    button.disabled = true;

    try {
      await transformHero(
        heroNow(),
        $("transformInput").value.trim()
      );
    } finally {
      button.disabled = false;
    }
  });

  click("restoreButton", showOriginal);
  click("showTransform", showTransform);

  // 技能
  click("skillButton", () => {
    const h = heroNow();

    if (!h) {
      status("請先選擇主角");
      return;
    }

    if (!h.skills.length && !h.aiSkills?.length) {
      status("請先透過 AI 對話創造技能");
      return;
    }

    // 啟動角色已學會的全部技能，讓技能能夠疊加。
    const allSkills = [...(h.skills || []), ...(h.aiSkills || [])];
    const unique = new Map();
    for (const skill of allSkills) {
      unique.set(String(skill.type || "") + ":" + String(skill.name || ""), skill);
    }
    for (const skill of unique.values()) activateHeroSkill(h, skill, 4000);
    bubble("⚡ " + h.name + "：" +
      [...unique.values()].map(s => s.name || "魔法").join("＋"));
  });

  // 切換世界
  $("worldSelect").addEventListener("change", event => {
    state.world = event.target.value;

    const titles = {
      ocean: "🌊 Mindspace｜海底世界",
      forest: "🌳 Mindspace｜森林世界",
      space: "🚀 Mindspace｜太空世界"
    };

    $("worldTitle").textContent =
      titles[state.world] || titles.ocean;

    applyWorldBackground();
  });

  setupBackgroundButtons();

  // 清空主角
  click("resetButton", () => {
    if (!confirm("確定清除所有主角與故事嗎？")) {
      return;
    }

    stopSpeech();

    for (const h of state.heroes) {
      h.element?.remove();
    }

    state.heroes = [];
    state.selectedId = null;
    state.history = [];
    state.scenes = [];

    $("chatLog").replaceChildren();

    refreshHeroes();

    bubble("🌱 一起創造新的黏土朋友吧！");
    status("已開始新創作");
  });

  // 側邊欄
  click("mobileToggle", () => {
    const collapsed =
      $("sidebar").classList.toggle("collapsed");

    $("mobileToggle").textContent =
      collapsed ? "☰ 展開" : "☰ 收合";

    resizeWorld();
  });

  // 全螢幕
  click("fullscreenButton", async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if ($("app").requestFullscreen) {
      await $("app").requestFullscreen();
    } else {
      status("此瀏覽器不支援網頁全螢幕");
    }

    resizeWorld();
  });

  document.addEventListener("fullscreenchange", () => {
    $("fullscreenButton").textContent =
      document.fullscreenElement
        ? "⛶ 退出"
        : "⛶ 全螢幕";

    resizeWorld();
  });

  // AI 連線測試
  click("testBridge", async () => {
    const button = $("testBridge");
    button.disabled = true;

    status("🔍 正在測試 GAS / AI 後端……");

    try {
      const result = await callAI(
        "ping",
        {},
        30000
      );

      status(
        "✅ AI 後端連線成功：" +
        (result.message || "PONG")
      );
    } catch (error) {
      status(
        "❌ AI 連線測試失敗：" +
        error.message
      );
    } finally {
      button.disabled = false;
    }
  });
}

/* ===== 系統初始化 ===== */

function initializeMindspace() {
  setupButtons();
  refreshHeroes();
  applyWorldBackground();
  startP5World();
  initializeBridge();

  status("🌈 Mindspace 已啟動，正在連接 AI……");
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

/* ===== SKETCH.JS END ===== */
