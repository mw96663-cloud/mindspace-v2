
"use strict";

/* =========================================================
   MINDSPACE V2 — AI DIRECTOR
   開放式故事、黏土角色、動作時間軸、技能記憶
   相容新版 sketch.js 的 original / transformed 資料結構
========================================================= */

(function () {
  const APP = "Mindspace AI Director";

  const old = {
    setupButtons,
    animateHeroes,
    drawScenes,
    saveHero
  };

  const D = {
    timeline: [],
    objects: new Map(),
    busy: false,
    autoTalk: false,
    recording: false,
    recorder: null,
    stream: null,
    timer: null,
    speaking: false,
    storageKey: "mindspace_v2_ai_skills"
  };

  const getHero = id =>
    state.heroes.find(h => h.id === id);

  const arr = value =>
    Array.isArray(value) ? value : [];

  const str = (value, max = 200) =>
    String(value ?? "").slice(0, max);

  const num = (value, min, max, fallback) => {
    const n = Number(value);
    return clamp(
      Number.isFinite(n) ? n : fallback,
      min,
      max
    );
  };

  const validColor = value =>
    /^#[0-9a-fA-F]{6}$/.test(value || "")
      ? value
      : "#ffd2e5";

  const ease = value => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  };

  const wait = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  /* ===== AI 動作資料安全轉換 ===== */

  const OPERATIONS = new Set([
    "move",
    "turn",
    "scale",
    "fade",
    "shake",
    "pulse",
    "orbit",
    "emit",
    "create",
    "remove",
    "morph",
    "wait",
    "speak"
  ]);

  function normalizeStep(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const op = str(raw.op, 30);

    if (!OPERATIONS.has(op)) {
      return null;
    }

    return {
      op,

      heroId: str(raw.heroId, 80),
      targetId: str(raw.targetId, 80),
      objectId: str(raw.objectId, 80),

      at: num(raw.at, 0, 45, 0),
      duration: num(raw.duration, 0.1, 20, 3),

      x: num(raw.x, 0, 1, 0.5),
      y: num(raw.y, 0, 1, 0.5),

      amount: num(raw.amount, -5, 5, 1),
      angle: num(raw.angle, -720, 720, 0),

      count: num(raw.count, 1, 60, 14),
      size: num(raw.size, 8, 240, 70),

      color: validColor(raw.color),

      shape: str(raw.shape, 40),
      label: str(raw.label, 35),
      emoji: str(raw.emoji, 8),

      description: str(raw.description, 300),

      path: arr(raw.path)
        .slice(0, 16)
        .map(point => ({
          x: num(point?.x, 0, 1, 0.5),
          y: num(point?.y, 0, 1, 0.5)
        }))
    };
  }

  /* ===== AI 時間軸 ===== */

  function addTimeline(steps) {
    const start = performance.now();

    for (const raw of arr(steps).slice(0, 40)) {
      const step = normalizeStep(raw);

      if (!step) continue;

      D.timeline.push({
        ...step,

        start: start + step.at * 1000,

        end:
          start +
          (step.at + step.duration) * 1000,

        created: false,
        from: null
      });
    }

    D.timeline = D.timeline.slice(-100);
  }

  function getPosition(id) {
    const hero = getHero(id);

    if (hero) {
      return {
        x: hero.x,
        y: hero.y
      };
    }

    const object = D.objects.get(id);

    if (object) {
      return {
        x: object.x,
        y: object.y
      };
    }

    return null;
  }

  function destination(step) {
    return getPosition(step.targetId) || {
      x: step.x,
      y: step.y
    };
  }

  /* ===== 黏土質感的數位物件 ===== */

  function createObject(step) {
    const owner = getHero(step.heroId);

    const id =
      step.objectId || uid();

    const x =
      owner && step.x === 0.5
        ? clamp(owner.x + 0.15, 0.05, 0.95)
        : step.x;

    const y =
      owner && step.y === 0.5
        ? owner.y
        : step.y;

    D.objects.set(id, {
      id,
      x,
      y,
      size: step.size,
      shape: step.shape,
      color: step.color,
      label: step.label,
      emoji: step.emoji,
      description: step.description,
      created: performance.now()
    });
  }

  function drawClayObject(p, object, t) {
    const x = object.x * p.width;
    const y = object.y * p.height;
    const size = object.size;

    p.push();
    p.translate(x, y);

    const wobble =
      Math.sin(t * 2 + x) * 0.035;

    p.rotate(wobble);

    // 黏土的柔和投影
    p.noStroke();
    p.fill(45, 35, 55, 35);

    p.ellipse(
      5,
      size * 0.43,
      size * 0.85,
      size * 0.18
    );

    const shape =
      object.shape.toLowerCase();

    const c = p.color(object.color);

    p.fill(c);
    p.stroke(110, 75, 100, 45);
    p.strokeWeight(1.5);

    if (shape === "star") {
      p.beginShape();

      for (let i = 0; i < 10; i++) {
        const a =
          -Math.PI / 2 + i * Math.PI / 5;

        const r =
          i % 2
            ? size * 0.22
            : size * 0.48;

        p.vertex(
          Math.cos(a) * r,
          Math.sin(a) * r
        );
      }

      p.endShape(p.CLOSE);

    } else if (
      ["square", "rect", "house"].includes(shape)
    ) {
      p.rectMode(p.CENTER);

      p.rect(
        0,
        0,
        size * 0.85,
        size * 0.78,
        size * 0.12
      );

      if (shape === "house") {
        p.fill("#e8a4b5");

        p.triangle(
          -size * 0.5,
          -size * 0.35,
          0,
          -size * 0.85,
          size * 0.5,
          -size * 0.35
        );
      }

    } else if (shape === "triangle") {
      p.triangle(
        0,
        -size * 0.5,
        -size * 0.45,
        size * 0.4,
        size * 0.45,
        size * 0.4
      );

    } else if (shape === "egg") {
      p.ellipse(
        0,
        0,
        size * 0.72,
        size
      );

    } else if (shape === "line") {
      p.strokeWeight(
        Math.max(6, size * 0.13)
      );

      p.line(
        -size * 0.45,
        0,
        size * 0.45,
        0
      );

    } else {
      // 未指定形狀時仍然有基本可見造型
      p.ellipse(
        0,
        0,
        size,
        size * 0.9
      );
    }

    // 手捏黏土的高光與不規則小斑點
    p.noStroke();

    p.fill(255, 255, 255, 75);

    p.ellipse(
      -size * 0.18,
      -size * 0.2,
      size * 0.27,
      size * 0.14
    );

    for (let i = 0; i < 12; i++) {
      const a = i * 2.39996;
      const r = size * (0.08 + (i % 4) * 0.06);

      p.fill(
        255,
        255,
        255,
        20 + (i % 3) * 10
      );

      p.circle(
        Math.cos(a) * r,
        Math.sin(a) * r,
        2 + i % 3
      );
    }

    if (object.emoji) {
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(Math.max(16, size * 0.5));
      p.text(object.emoji, 0, 0);
    }

    if (object.label) {
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(13);
      p.noStroke();

      p.fill(255, 255, 255, 225);

      p.rectMode(p.CENTER);
      p.rect(
        0,
        size * 0.7,
        Math.max(60, object.label.length * 15),
        25,
        12
      );

      p.fill("#58466a");

      p.text(
        object.label,
        0,
        size * 0.7
      );
    }

    p.pop();
  }

  /* ===== AI 動作演算 ===== */

  function animateStep(step, now) {
    if (
      step.op === "create" &&
      !step.created
    ) {
      createObject(step);
      step.created = true;
    }

    if (
      step.op === "remove" &&
      !step.created
    ) {
      D.objects.delete(step.objectId);
      step.created = true;
    }

    const hero = getHero(step.heroId);

    if (!hero) return;

    if (!step.from) {
      step.from = {
        x: hero.x,
        y: hero.y
      };
    }

    const progress = ease(
      (now - step.start) /
      (step.duration * 1000)
    );

    if (step.op === "move") {
      if (step.path.length) {
        const points = [
          step.from,
          ...step.path
        ];

        const index =
          progress * (points.length - 1);

        const i = Math.min(
          points.length - 2,
          Math.floor(index)
        );

        const fraction = ease(index - i);

        hero.x =
          points[i].x +
          (points[i + 1].x - points[i].x) *
          fraction;

        hero.y =
          points[i].y +
          (points[i + 1].y - points[i].y) *
          fraction;

      } else {
        const to = destination(step);

        hero.x =
          step.from.x +
          (to.x - step.from.x) *
          progress;

        hero.y =
          step.from.y +
          (to.y - step.from.y) *
          progress;
      }
    }

    if (step.op === "orbit") {
      const center = destination(step);

      const angle =
        progress *
        Math.PI *
        2 *
        Math.max(
          0.25,
          Math.abs(step.amount)
        );

      hero.x =
        center.x +
        Math.cos(angle) * 0.13;

      hero.y =
        center.y +
        Math.sin(angle) * 0.12;
    }

    // 左右水平翻身，不是上下顛倒
    if (step.op === "turn") {
      hero.aiTurn =
        Math.cos(
          progress *
          Math.PI *
          2 *
          Math.max(
            0.5,
            Math.abs(step.amount)
          )
        );
    }

    if (step.op === "scale") {
      hero.aiScale =
        1 +
        (step.amount - 1) *
        Math.sin(Math.PI * progress);
    }

    if (step.op === "fade") {
      hero.aiOpacity =
        clamp(
          1 -
          (1 - Math.max(0, step.amount)) *
          Math.sin(Math.PI * progress),
          0.05,
          1
        );
    }

    if (step.op === "shake") {
      hero.aiOffset =
        Math.sin(progress * 45) *
        step.amount *
        6;
    }

    if (step.op === "pulse") {
      hero.aiScale =
        1 +
        Math.sin(progress * 25) *
        Math.abs(step.amount) *
        0.13;
    }

    if (step.op === "morph") {
      hero.aiScale =
        1 +
        Math.sin(Math.PI * progress) *
        Math.abs(step.amount) *
        0.15;
    }
  }

  /* ===== 粒子與能力特效 ===== */

  function drawEmissions(p, step, now) {
    const origin =
      getPosition(step.heroId) ||
      getPosition(step.objectId) ||
      {
        x: step.x,
        y: step.y
      };

    const seconds =
      (now - step.start) / 1000;

    const count =
      Math.round(step.count);

    p.push();
    p.noStroke();

    for (let i = 0; i < count; i++) {
      const angle =
        i * 2.39996 +
        seconds * step.amount;

      const radius =
        12 +
        (seconds * 32 + i * 11) % 110;

      const x =
        origin.x * p.width +
        Math.cos(angle) * radius;

      const y =
        origin.y * p.height +
        Math.sin(angle) * radius;

      if (step.emoji) {
        p.textSize(
          12 + i % 3 * 5
        );

        p.text(
          step.emoji,
          x,
          y
        );

      } else {
        p.fill(step.color);

        p.circle(
          x,
          y,
          4 + i % 5
        );
      }
    }

    p.pop();
  }

  /* ===== 接管原本角色動畫 ===== */

  animateHeroes = function (p, t) {
    const now = performance.now();

    for (const hero of state.heroes) {
      hero.aiTurn = 1;
      hero.aiScale = 1;
      hero.aiOpacity = 1;
      hero.aiOffset = 0;
    }

    // 保留 sketch.js 原本的自主移動
    old.animateHeroes(p, t);

    const activeHeroes = new Set();

    for (const step of D.timeline) {
      if (
        now < step.start ||
        now > step.end
      ) {
        continue;
      }

      if (step.heroId) {
        activeHeroes.add(step.heroId);
      }

      animateStep(step, now);
    }

    for (const hero of state.heroes) {
      if (!hero.element) continue;

      hero.x = num(
        hero.x,
        0.06,
        0.94,
        0.5
      );

      hero.y = num(
        hero.y,
        0.1,
        0.9,
        0.5
      );

      hero.element.style.left =
        hero.x * 100 + "%";

      hero.element.style.top =
        hero.y * 100 + "%";

      if (activeHeroes.has(hero.id)) {
        const sx =
          (hero.face || 1) *
          hero.aiTurn *
          hero.aiScale;

        hero.element.style.transform =
          "translate(-50%,-50%) " +
          "translateX(" +
          hero.aiOffset +
          "px) " +
          "scale(" +
          sx +
          "," +
          hero.aiScale +
          ")";

        hero.element.style.opacity =
          String(hero.aiOpacity);
      }
    }

    D.timeline = D.timeline.filter(
      step => now < step.end + 1000
    );
  };

  /* ===== 接管場景特效 ===== */

  drawScenes = function (p, t) {
    old.drawScenes(p, t);

    const now = performance.now();

    for (const object of D.objects.values()) {
      drawClayObject(p, object, t);
    }

    for (const step of D.timeline) {
      if (
        step.op === "emit" &&
        now >= step.start &&
        now <= step.end
      ) {
        drawEmissions(p, step, now);
      }
    }
  };

  /* ===== AI 技能記憶 ===== */

  function saveSkills() {
    try {
      const data = state.heroes.map(hero => ({
        id: hero.id,
        name: hero.name,
        skills: arr(hero.aiSkills)
      }));

      localStorage.setItem(
        D.storageKey,
        JSON.stringify(data)
      );
    } catch (error) {
      console.warn(
        "無法儲存技能",
        error
      );
    }
  }

  function loadSkills() {
    try {
      const raw = JSON.parse(
        localStorage.getItem(D.storageKey) ||
        "[]"
      );

      return arr(raw);
    } catch (error) {
      return [];
    }
  }

  function restoreSkills(hero) {
    const record = loadSkills().find(
      item =>
        item.id === hero.id ||
        (
          !item.id &&
          item.name === hero.name
        )
    );

    if (!record) return;

    hero.aiSkills = arr(record.skills);
  }

  function rememberSkills(skills) {
    for (const raw of arr(skills)) {
      const hero = getHero(raw.heroId);

      if (!hero) continue;

      const name = str(raw.name, 50);

      if (!name) continue;

      const skill = {
        name,
        description:
          str(raw.description, 250),

        timeline: arr(raw.timeline)
          .slice(0, 20)
          .map(normalizeStep)
          .filter(Boolean)
      };

      hero.aiSkills = arr(
        hero.aiSkills
      ).filter(
        item => item.name !== name
      );

      hero.aiSkills.push(skill);
    }

    saveSkills();
    refreshHeroes();
  }

  function playSkill() {
    const hero = heroNow();

    if (!hero) {
      status("請先選擇黏土主角");
      return;
    }

    const skills = arr(hero.aiSkills);

    if (!skills.length) {
      status(
        "還沒有 AI 技能，可以請孩子先發明一個"
      );
      return;
    }

    const index =
      hero.aiSkillIndex || 0;

    const skill =
      skills[index % skills.length];

    hero.aiSkillIndex =
      index + 1;

    const steps = skill.timeline.map(
      step => ({
        ...step,
        heroId:
          step.heroId || hero.id
      })
    );

    if (!steps.length) {
      status(
        "這項技能沒有可播放的動畫步驟"
      );
      return;
    }

    addTimeline(steps);

    bubble(
      "⚡ " +
      hero.name +
      " 使用了「" +
      skill.name +
      "」！"
    );

    status(
      "✨ 正在播放技能：" +
      skill.name
    );
  }

  /* ===== AI 對話 ===== */

  async function command(message) {
    const text =
      str(message, 1500).trim();

    if (!text || D.busy) {
      return;
    }

    if (!state.heroes.length) {
      status(
        "請先拍照並建立黏土主角"
      );
      return;
    }

    D.busy = true;
    state.busy = true;

    $("sendButton").disabled = true;
    $("chatInput").value = "";

    chat(
      "🧒 孩子",
      text
    );

    status(
      "🧠 AI 正在理解想像並設計動畫……"
    );

    let reply = "";

    try {
      const result = await callAI(
        "mindspaceDirector",
        {
          message: text,

          selectedHeroId:
            state.selectedId,

          heroes: state.heroes.map(hero => ({
            id: hero.id,
            name: hero.name,
            appearance: hero.appearance,
            personality: hero.personality,

            skills: arr(
              hero.aiSkills
            ).map(skill => ({
              name: skill.name,
              description: skill.description
            }))
          })),

          objects: [
            ...D.objects.values()
          ].slice(-20).map(object => ({
            id: object.id,
            label: object.label,
            description:
              object.description
          })),

          history:
            state.history.slice(-12)
        },
        120000
      );

      /* 主角命名 */

      for (const item of arr(result.renames)) {
        const hero = getHero(
          item.heroId
        );

        if (!hero || !item.name) {
          continue;
        }

        hero.name =
          str(item.name, 30);

        if (hero.nameElement) {
          hero.nameElement.textContent =
            hero.name;
        }
      }

      /* AI 技能 */

      rememberSkills(result.skills);

      /* 實際動畫 */

      addTimeline(result.timeline);

      /* 黏土外型變身 */

      for (const change of arr(
        result.transforms
      ).slice(0, 2)) {
        const hero = getHero(
          change.heroId
        );

        if (
          !hero ||
          !change.description
        ) {
          continue;
        }

        try {
          await transformHero(
            hero,
            str(change.description, 350)
          );

        } catch (error) {
          status(
            "⚠️ 黏土造型生成失敗：" +
            error.message
          );
        }
      }

      /* AI 回答 */

      const speaker =
        getHero(result.speakerId) ||
        heroNow() ||
        state.heroes[0];

      reply = str(
        result.reply ||
        "哇！我們一起看看會發生什麼吧！",
        450
      );

      chat(
        "🐠 " + speaker.name,
        reply,
        true
      );

      bubble(
        "🐠 " +
        speaker.name +
        "：" +
        reply
      );

      state.history.push(
        {
          role: "user",
          content: text
        },
        {
          role: "assistant",
          content: reply
        }
      );

      state.history =
        state.history.slice(-24);

      refreshHeroes();
      saveSkills();

      status(
        "🌈 AI 故事與動畫已更新"
      );

    } catch (error) {
      status(
        "❌ AI 導演：" +
        error.message
      );

      chat(
        "⚠️ 系統",
        error.message,
        true
      );

      D.autoTalk = false;

    } finally {
      D.busy = false;
      state.busy = false;
      $("sendButton").disabled = false;
    }

    if (reply) {
      await speak(reply);

      if (D.autoTalk) {
        await wait(500);

        if (D.autoTalk) {
          await record(true);
        }
      }
    }
  }

  /* ===== AI 自動語音對話 ===== */

  async function record(auto = false) {
    if (D.recording || D.busy) {
      return;
    }

    if (!state.bridgeReady) {
      throw Error(
        "AI 尚未連線，請先測試連線"
      );
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      throw Error(
        "瀏覽器不支援麥克風錄音"
      );
    }

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

    const mime = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm"
    ].find(type =>
      MediaRecorder.isTypeSupported(type)
    );

    const recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime } : {}
    );

    D.stream = stream;
    D.recorder = recorder;
    D.recording = true;

    const chunks = [];

    recorder.ondataavailable = event => {
      if (event.data.size) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      clearTimeout(D.timer);

      D.recording = false;

      stream
        .getTracks()
        .forEach(track => track.stop());

      $("micButton").textContent =
        "🎙️ 開始說話";

      if (
        !chunks.length ||
        (auto && !D.autoTalk)
      ) {
        return;
      }

      try {
        status(
          "🧠 AI 正在辨識孩子的語音……"
        );

        const blob = new Blob(
          chunks,
          {
            type:
              recorder.mimeType ||
              "audio/webm"
          }
        );

        const wav =
          await wav16k(blob);

        const audio =
          await blobBase64(wav);

        if (audio.length > 7000000) {
          throw Error(
            "錄音過長，請縮短說話時間"
          );
        }

        const result = await callAI(
          "transcribe",
          { audio },
          120000
        );

        const text =
          str(result.text, 1500).trim();

        if (text) {
          await command(text);
        } else {
          status(
            "沒有辨識到說話內容"
          );
        }

      } catch (error) {
        status(
          "❌ 語音辨識：" +
          error.message
        );
      }
    };

    recorder.start();

    $("micButton").textContent =
      "⏹️ 結束錄音";

    status(
      auto
        ? "🎤 自動聆聽中，約 9 秒後送出"
        : "🎤 正在錄音，說完請按結束"
    );

    if (auto) {
      D.timer = setTimeout(
        () => {
          if (
            recorder.state === "recording"
          ) {
            recorder.stop();
          }
        },
        9000
      );
    }
  }

  /* ===== 防止重複按鈕事件 ===== */

  function takeOverClick(id, handler) {
    const button = $(id);

    if (!button) {
      console.warn(
        APP,
        "找不到按鈕",
        id
      );
      return;
    }

    // 使用捕獲階段，攔截 sketch.js 的舊事件。
    // 不需要複製 DOM，因此不會破壞其他元素參照。
    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          Promise.resolve(
            handler()
          ).catch(error => {
            status(
              "❌ " + error.message
            );
          });

        } catch (error) {
          status(
            "❌ " + error.message
          );
        }
      },
      true
    );
  }

  /* ===== 接管建立主角 ===== */

  saveHero = function () {
    const before = new Set(
      state.heroes.map(hero => hero.id)
    );

    // 保留原本的拍照、去背與建立主角流程
    old.saveHero();

    const hero = heroNow();

    if (
      hero &&
      !before.has(hero.id)
    ) {
      restoreSkills(hero);

      const message =
        "哇！我誕生了！" +
        "你想幫我取什麼名字？" +
        "我有什麼特別的能力呢？";

      bubble(message);

      chat(
        "🌱 新朋友",
        message,
        true
      );
    }

    refreshHeroes();
  };

  /* ===== 接管按鈕初始化 ===== */

  setupButtons = function () {
    // 先建立 sketch.js 原本的所有功能：
    // 拍照、去背、背景、連線測試等
    old.setupButtons();

    // 只接管 AI 對話相關功能
    takeOverClick(
      "sendButton",
      () => command(
        $("chatInput").value
      )
    );

    takeOverClick(
      "micButton",
      () => {
        if (D.recording) {
          if (
            D.recorder?.state ===
            "recording"
          ) {
            D.recorder.stop();
          }
          return;
        }

        return record(false);
      }
    );

    takeOverClick(
      "skillButton",
      playSkill
    );

    // 直接攔截舊版 Enter 事件
    $("chatInput").addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();

          command(
            $("chatInput").value
          );
        }
      },
      true
    );

    // 增加自動對話模式
    if (!$("aiAutoTalk")) {
      const button =
        document.createElement("button");

      button.id = "aiAutoTalk";
      button.type = "button";
      button.className = "full pink";
      button.textContent =
        "🎤 開啟自動對話";

      $("micButton")
        .parentElement
        .insertAdjacentElement(
          "afterend",
          button
        );

      button.addEventListener(
        "click",
        async () => {
          D.autoTalk =
            !D.autoTalk;

          button.textContent =
            D.autoTalk
              ? "🛑 停止自動對話"
              : "🎤 開啟自動對話";

          if (!D.autoTalk) {
            if (
              D.recorder?.state ===
              "recording"
            ) {
              D.recorder.stop();
            }

            return;
          }

          try {
            await record(true);

          } catch (error) {
            D.autoTalk = false;

            button.textContent =
              "🎤 開啟自動對話";

            status(
              "❌ " + error.message
            );
          }
        }
      );
    }

    takeOverClick(
      "stopVoice",
      () => {
        D.autoTalk = false;

        if ($("aiAutoTalk")) {
          $("aiAutoTalk").textContent =
            "🎤 開啟自動對話";
        }

        if (
          D.recorder?.state ===
          "recording"
        ) {
          D.recorder.stop();
        }

        stopSpeech();
      }
    );

    console.log(
      APP,
      "已接管 AI 對話與動畫"
    );
  };

  /* ===== 供除錯使用 ===== */

  window.MindspaceDirector = {
    get timeline() {
      return D.timeline;
    },

    get objects() {
      return [
        ...D.objects.values()
      ];
    },

    get busy() {
      return D.busy;
    },

    command,
    playSkill,
    addTimeline,

    clearObjects() {
      D.objects.clear();
      D.timeline = [];
    }
  };

})();
