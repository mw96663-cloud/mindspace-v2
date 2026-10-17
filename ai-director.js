
"use strict";

/*
  Mindspace AI Director
  AI 產生動畫時間軸，瀏覽器負責執行。
  不執行 AI 回傳的任意 JavaScript。
*/

(function () {
  const old = {
    setupButtons,
    animateHeroes,
    drawScenes,
    saveHero,
    stopSpeech
  };

  const D = {
    timeline: [],
    objects: new Map(),
    skills: new Map(),
    busy: false,
    auto: false,
    recording: false,
    rec: null,
    stream: null,
    audio: null,
    utterance: null,
    micTimer: null,
    key: "mindspace_ai_director_skills"
  };

  const byId = id =>
    state.heroes.find(h => h.id === id);

  const num = (x, a, b, d) =>
    Math.max(
      a,
      Math.min(b, Number.isFinite(+x) ? +x : d)
    );

  const arr = x =>
    Array.isArray(x) ? x : [];

  const str = (x, n = 100) =>
    String(x ?? "").slice(0, n);

  const wait = ms =>
    new Promise(r => setTimeout(r, ms));

  const color = x =>
    /^#[0-9a-fA-F]{6}$/.test(x || "")
      ? x
      : "#ffd5e7";

  const ease = x => {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  };

  const objPos = id => {
    const o = D.objects.get(id);
    return o ? { x: o.x, y: o.y } : null;
  };

  function showMessage(s) {
    status(s);
  }

  function store() {
    try {
      localStorage.setItem(
        D.key,
        JSON.stringify(
          state.heroes.map(h => ({
            name: h.name,
            skills: arr(h.aiSkills)
          }))
        )
      );
    } catch (e) {
      console.warn(e);
    }
  }

  function load() {
    try {
      return JSON.parse(
        localStorage.getItem(D.key) || "[]"
      );
    } catch (_) {
      return [];
    }
  }

  function attachSkills(h) {
    const item = load().find(
      x => x.name === h.name
    );

    if (item && !h.aiSkills) {
      h.aiSkills = arr(item.skills);
    }
  }

  function normalizeStep(step) {
    if (!step || typeof step !== "object") {
      return null;
    }

    const ops = new Set([
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

    if (!ops.has(step.op)) return null;

    return {
      op: step.op,

      heroId: str(step.heroId, 80),
      targetId: str(step.targetId, 80),
      objectId: str(step.objectId, 80),

      at: num(step.at, 0, 45, 0),
      duration: num(step.duration, 0.2, 20, 3),

      x: num(step.x, 0, 1, 0.5),
      y: num(step.y, 0, 1, 0.5),

      amount: num(step.amount, -5, 5, 1),
      angle: num(step.angle, -720, 720, 0),

      count: num(step.count, 1, 60, 14),
      size: num(step.size, 8, 240, 72),

      color: color(step.color),
      shape: str(step.shape, 30),
      label: str(step.label, 32),
      description: str(step.description, 180),
      emoji: str(step.emoji, 8),

      path: arr(step.path)
        .slice(0, 16)
        .map(pt => ({
          x: num(pt.x, 0, 1, 0.5),
          y: num(pt.y, 0, 1, 0.5)
        }))
    };
  }

  function addTimeline(steps) {
    const start = performance.now();

    for (const raw of arr(steps).slice(0, 40)) {
      const s = normalizeStep(raw);

      if (!s) continue;

      D.timeline.push({
        ...s,
        start: start + s.at * 1000,
        end:
          start +
          (s.at + s.duration) * 1000,
        created: false,
        from: null
      });
    }

    D.timeline = D.timeline.slice(-100);
  }

  function heroCenter(h) {
    return {
      x: h.x,
      y: h.y
    };
  }

  function targetPoint(s) {
    const target =
      byId(s.targetId) ||
      objPos(s.targetId);

    return target
      ? { x: target.x, y: target.y }
      : { x: s.x, y: s.y };
  }

  function animateStep(s, now) {
    const h = byId(s.heroId);

    const p = ease(
      (now - s.start) /
      (s.duration * 1000)
    );

    // 建立新的故事物件
    if (s.op === "create" && !s.created) {
      const owner = byId(s.heroId);

      const pt = owner
        ? heroCenter(owner)
        : { x: s.x, y: s.y };

      const id =
        s.objectId ||
        (
          "object-" +
          Math.random().toString(36).slice(2)
        );

      D.objects.set(id, {
        id,

        x:
          s.x === 0.5 && owner
            ? Math.min(0.9, pt.x + 0.13)
            : s.x,

        y:
          s.y === 0.5 && owner
            ? pt.y
            : s.y,

        size: s.size,
        color: s.color,
        shape: s.shape,
        label: s.label,
        emoji: s.emoji,
        description: s.description,
        created: now
      });

      s.created = true;
    }

    // 移除故事物件
    if (s.op === "remove" && !s.created) {
      D.objects.delete(s.objectId);
      s.created = true;
    }

    if (!h) return;

    if (!s.from) {
      s.from = {
        x: h.x,
        y: h.y
      };
    }

    // 自由路徑移動
    if (s.op === "move") {
      const dest = targetPoint(s);

      if (s.path.length) {
        const points = [
          s.from,
          ...s.path
        ];

        const f =
          p * (points.length - 1);

        const i = Math.min(
          points.length - 2,
          Math.floor(f)
        );

        const q = ease(f - i);

        h.x =
          points[i].x +
          (
            points[i + 1].x -
            points[i].x
          ) * q;

        h.y =
          points[i].y +
          (
            points[i + 1].y -
            points[i].y
          ) * q;

      } else {
        h.x =
          s.from.x +
          (dest.x - s.from.x) * p;

        h.y =
          s.from.y +
          (dest.y - s.from.y) * p;
      }
    }

    // 繞著目標移動
    if (s.op === "orbit") {
      const c = targetPoint(s);

      const a =
        p *
        Math.PI *
        2 *
        Math.max(
          0.2,
          Math.abs(s.amount)
        );

      h.x =
        c.x +
        Math.cos(a) * 0.13;

      h.y =
        c.y +
        Math.sin(a) * 0.12;
    }

    // 水平轉身，不上下顛倒
    if (s.op === "turn") {
      h.aiTurn = Math.cos(
        p *
        Math.PI *
        2 *
        Math.max(
          0.5,
          Math.abs(s.amount)
        )
      );
    }

    if (s.op === "scale") {
      h.aiScale =
        1 +
        (s.amount - 1) *
        Math.sin(Math.PI * p);
    }

    if (s.op === "fade") {
      h.aiOpacity = Math.max(
        0.05,
        1 -
        (
          1 -
          Math.max(0, s.amount)
        ) *
        Math.sin(Math.PI * p)
      );
    }

    if (s.op === "shake") {
      h.aiOffset =
        Math.sin(p * 45) *
        num(s.amount, -5, 5, 1) *
        6;
    }

    if (s.op === "pulse") {
      h.aiScale =
        1 +
        Math.sin(p * 25) *
        Math.abs(s.amount) *
        0.13;
    }
  }

  function drawObject(p, o, t) {
    const x = o.x * p.width;
    const y = o.y * p.height;
    const size = o.size;

    p.push();
    p.translate(x, y);
    p.noStroke();
    p.fill(o.color);

    const shape =
      o.shape.toLowerCase();

    if (shape === "star") {
      p.beginShape();

      for (let i = 0; i < 10; i++) {
        const a =
          -Math.PI / 2 +
          i * Math.PI / 5;

        const r =
          i % 2
            ? size * 0.22
            : size * 0.5;

        p.vertex(
          Math.cos(a) * r,
          Math.sin(a) * r
        );
      }

      p.endShape(p.CLOSE);

    } else if (
      shape === "rect" ||
      shape === "house" ||
      shape === "square"
    ) {
      p.rectMode(p.CENTER);

      p.rect(
        0,
        0,
        size,
        size * 0.8,
        12
      );

      if (shape === "house") {
        p.fill("#ff9eac");

        p.triangle(
          -size * 0.6,
          -size * 0.35,
          0,
          -size,
          size * 0.6,
          -size * 0.35
        );
      }

    } else if (shape === "egg") {
      p.ellipse(
        0,
        0,
        size * 0.7,
        size
      );

      const age =
        (
          performance.now() -
          o.created
        ) / 1000;

      if (age > 2) {
        p.noFill();
        p.stroke("#b98c78");
        p.strokeWeight(3);

        p.beginShape();

        for (let i = 0; i < 7; i++) {
          p.vertex(
            -size * 0.3 +
            i * size * 0.1,
            i % 2 ? 0 : 8
          );
        }

        p.endShape();
      }

      if (age > 5) {
        p.noStroke();
        p.fill("#ffbad6");

        p.circle(
          0,
          -size * 0.3,
          size * 0.4
        );

        p.fill("#35304b");
        p.circle(-6, -size * 0.34, 3);
        p.circle(6, -size * 0.34, 3);
      }

    } else if (shape === "triangle") {
      p.triangle(
        0,
        -size * 0.5,
        -size * 0.5,
        size * 0.4,
        size * 0.5,
        size * 0.4
      );

    } else {
      p.circle(0, 0, size);
    }

    if (o.emoji) {
      p.textAlign(
        p.CENTER,
        p.CENTER
      );

      p.textSize(
        Math.max(
          16,
          size * 0.55
        )
      );

      p.text(
        o.emoji,
        0,
        0
      );
    }

    if (o.label) {
      p.fill("#fff");
      p.stroke("#584f68");
      p.strokeWeight(3);
      p.textSize(15);
      p.textAlign(p.CENTER);

      p.text(
        o.label,
        0,
        size * 0.65
      );
    }

    p.pop();
  }

  function drawEmissions(p, s, now) {
    const h = byId(s.heroId);
    const o = objPos(s.objectId);

    const origin = h
      ? heroCenter(h)
      : o || {
          x: s.x,
          y: s.y
        };

    const time =
      (now - s.start) / 1000;

    const count =
      Math.round(s.count);

    p.push();
    p.noStroke();
    p.fill(s.color);

    for (let i = 0; i < count; i++) {
      const a =
        i * 2.39996 +
        time * (s.amount || 1);

      const r =
        12 +
        (
          time * 32 +
          i * 11
        ) % 110;

      const x =
        origin.x * p.width +
        Math.cos(a) * r;

      const y =
        origin.y * p.height +
        Math.sin(a) * r;

      if (s.emoji) {
        p.textSize(
          12 + (i % 3) * 5
        );

        p.text(
          s.emoji,
          x,
          y
        );
      } else {
        p.circle(
          x,
          y,
          4 + i % 5
        );
      }
    }

    p.pop();
  }

  const oldAnimate =
    old.animateHeroes;

  animateHeroes = function (p, t) {
    const now = performance.now();

    for (const h of state.heroes) {
      h.aiTurn = 1;
      h.aiScale = 1;
      h.aiOpacity = 1;
      h.aiOffset = 0;
    }

    // 保留原本的角色動畫
    oldAnimate(p, t);

    // 執行 AI 產生的動畫時間軸
    for (const s of D.timeline) {
      if (
        now < s.start ||
        now > s.end
      ) {
        continue;
      }

      animateStep(s, now);
    }

    for (const h of state.heroes) {
      h.x = num(
        h.x,
        0.06,
        0.94,
        0.5
      );

      h.y = num(
        h.y,
        0.10,
        0.90,
        0.5
      );

      h.element.style.left =
        (h.x * 100) + "%";

      h.element.style.top =
        (h.y * 100) + "%";

      const sx =
        (h.face || 1) *
        h.aiTurn *
        h.aiScale;

      h.element.style.transform =
        `translate(-50%,-50%) ` +
        `translateX(${h.aiOffset}px) ` +
        `scale(${sx},${h.aiScale})`;

      h.element.style.opacity =
        String(h.aiOpacity);
    }

    D.timeline =
      D.timeline.filter(
        s => now < s.end + 1000
      );
  };

  drawScenes = function (p, t) {
    old.drawScenes(p, t);

    const now = performance.now();

    for (const o of D.objects.values()) {
      drawObject(p, o, t);
    }

    for (const s of D.timeline) {
      if (
        s.op === "emit" &&
        now >= s.start &&
        now <= s.end
      ) {
        drawEmissions(p, s, now);
      }
    }
  };

  function rememberSkills(skills) {
    for (const s of arr(skills)) {
      const h = byId(s.heroId);

      if (!h) continue;

      const name = str(s.name, 50);

      if (!name) continue;

      const skill = {
        name,
        description: str(
          s.description,
          200
        ),
        timeline: arr(s.timeline)
          .slice(0, 20)
          .map(normalizeStep)
          .filter(Boolean)
      };

      h.aiSkills = arr(
        h.aiSkills
      ).filter(
        x => x.name !== name
      );

      h.aiSkills.push(skill);
    }

    store();
    refreshHeroes();
  }

  function playSkill() {
    const h = heroNow();

    if (!h) {
      return showMessage(
        "請先選擇角色"
      );
    }

    const skills = arr(h.aiSkills);

    if (!skills.length) {
      return showMessage(
        "請先請 AI 教角色一項技能"
      );
    }

    const i =
      h.aiSkillIndex || 0;

    const skill =
      skills[i % skills.length];

    h.aiSkillIndex = i + 1;

    addTimeline(
      skill.timeline.map(s => ({
        ...s,
        heroId:
          s.heroId || h.id
      }))
    );

    bubble(
      "⚡ " +
      h.name +
      "：" +
      skill.name
    );
  }

  function stopAudio() {
    if (D.audio) {
      D.audio.pause();
      D.audio.src = "";
      D.audio = null;
    }

    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    old.stopSpeech();
  }

  async function speakFull(text) {
    if (!state.voiceEnabled) return;

    stopAudio();

    try {
      const r = await callAI(
        "speakNatural",
        {
          text: str(text, 550)
        }
      );

      if (!r.audio) {
        throw Error("無音訊");
      }

      const audio = new Audio(
        "data:audio/mpeg;base64," +
        r.audio
      );

      D.audio = audio;

      await new Promise(
        (resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;

          audio.play().catch(reject);
        }
      );

    } catch (e) {
      await new Promise(resolve => {
        if (
          !("speechSynthesis" in window)
        ) {
          return resolve();
        }

        const u =
          new SpeechSynthesisUtterance(
            text
          );

        u.lang = "zh-TW";
        u.onend = resolve;
        u.onerror = resolve;

        speechSynthesis.speak(u);
      });
    }
  }

  async function command(message) {
    message = str(
      message,
      1500
    ).trim();

    if (
      !message ||
      D.busy ||
      !state.heroes.length
    ) {
      return;
    }

    D.busy = true;
    state.busy = true;

    $("sendButton").disabled = true;
    $("chatInput").value = "";

    chat(
      "🧒 孩子",
      message
    );

    showMessage(
      "🧠 AI 正在設計故事與動畫…"
    );

    try {
      const r = await callAI(
        "mindspaceDirector",
        {
          message,

          selectedHeroId:
            state.selectedId,

          heroes:
            state.heroes.map(h => ({
              id: h.id,
              name: h.name,
              appearance: h.appearance,
              personality: h.personality,

              skills:
                arr(h.aiSkills).map(s => ({
                  name: s.name,
                  description:
                    s.description
                }))
            })),

          objects:
            [...D.objects.values()]
              .map(o => ({
                id: o.id,
                label: o.label,
                description:
                  o.description
              }))
              .slice(-20),

          history:
            state.history.slice(-12)
        },
        120000
      );

      // AI 命名
      for (
        const rename of arr(r.renames)
      ) {
        const h = byId(
          rename.heroId
        );

        if (
          h &&
          rename.name
        ) {
          h.name = str(
            rename.name,
            30
          );

          attachSkills(h);
        }
      }

      // 儲存 AI 生成的技能
      rememberSkills(r.skills);

      // 執行 AI 動畫
      addTimeline(r.timeline);

      // AI 生成造型
      for (
        const tr of arr(r.transforms)
      ) {
        const h = byId(
          tr.heroId
        );

        if (
          !h ||
          !tr.description
        ) {
          continue;
        }

        try {
          await transformHero(
            h,
            str(
              tr.description,
              350
            )
          );
        } catch (e) {
          showMessage(
            "⚠️ 外型生成失敗：" +
            e.message
          );
        }
      }

      const speaker =
        byId(r.speakerId) ||
        heroNow() ||
        state.heroes[0];

      const reply = str(
        r.reply ||
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
          content: message
        },
        {
          role: "assistant",
          content: reply
        }
      );

      state.history =
        state.history.slice(-24);

      refreshHeroes();
      store();

      showMessage(
        "🌈 動畫已開始演出"
      );

      D.busy = false;
      state.busy = false;

      $("sendButton").disabled = false;

      await speakFull(reply);

      if (D.auto) {
        await wait(400);

        if (D.auto) {
          await record(true);
        }
      }

    } catch (e) {
      showMessage(
        "❌ " + e.message
      );

      chat(
        "⚠️ 系統",
        e.message,
        true
      );

      D.auto = false;

    } finally {
      D.busy = false;
      state.busy = false;

      $("sendButton").disabled = false;
    }
  }

  function toBase64(blob) {
    return blobBase64(blob);
  }

  async function record(auto = false) {
    if (
      D.recording ||
      D.busy
    ) {
      return;
    }

    if (
      !navigator.mediaDevices
        ?.getUserMedia ||
      !window.MediaRecorder
    ) {
      throw Error(
        "瀏覽器不支援錄音"
      );
    }

    const stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          }
        });

    D.stream = stream;

    const chunks = [];

    const mime = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm"
    ].find(
      x => MediaRecorder.isTypeSupported(x)
    );

    const rec =
      new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : {}
      );

    D.rec = rec;
    D.recording = true;

    $("micButton").textContent =
      "⏹️ 結束錄音";

    rec.ondataavailable = e => {
      if (e.data.size) {
        chunks.push(e.data);
      }
    };

    rec.onstop = async () => {
      clearTimeout(
        D.micTimer
      );

      D.recording = false;

      stream
        .getTracks()
        .forEach(x => x.stop());

      $("micButton").textContent =
        "🎙️ 開始說話";

      if (
        !chunks.length ||
        (auto && !D.auto)
      ) {
        return;
      }

      try {
        showMessage(
          "🧠 正在辨識語音…"
        );

        const wav = await wav16k(
          new Blob(
            chunks,
            { type: rec.mimeType }
          )
        );

        const r = await callAI(
          "transcribe",
          {
            audio:
              await toBase64(wav)
          },
          120000
        );

        if (r.text?.trim()) {
          await command(
            r.text.trim()
          );
        } else {
          showMessage(
            "沒有辨識到說話"
          );
        }

      } catch (e) {
        showMessage(
          "❌ 語音辨識失敗：" +
          e.message
        );
      }
    };

    rec.start();

    showMessage(
      auto
        ? "🎤 請說話，約 9 秒後自動送出"
        : "🎤 說完請按結束錄音"
    );

    if (auto) {
      D.micTimer = setTimeout(
        () => {
          if (
            D.rec?.state ===
            "recording"
          ) {
            D.rec.stop();
          }
        },
        9000
      );
    }
  }

  function replaceButton(
    id,
    handler
  ) {
    const b = $(id);

    if (!b) return;

    const copy =
      b.cloneNode(true);

    b.replaceWith(copy);

    copy.addEventListener(
      "click",
      () =>
        Promise.resolve()
          .then(handler)
          .catch(e =>
            showMessage(
              "❌ " + e.message
            )
          )
    );
  }

  function addTeacherBackground() {
    const select =
      $("worldSelect");

    if (!select) return;

    const box =
      document.createElement("div");

    box.style.cssText =
      "padding:10px;" +
      "margin:8px 0;" +
      "border:1px solid #e7d9ed;" +
      "border-radius:12px";

    box.innerHTML =
      '<strong>👩‍🏫 教師自訂背景</strong>' +
      '<input id="teacherBg" ' +
      'type="file" accept="image/*" ' +
      'style="width:100%;margin-top:8px">' +
      '<button id="clearTeacherBg" ' +
      'style="margin-top:6px">' +
      '恢復內建背景</button>';

    select.parentElement
      .appendChild(box);

    $("teacherBg").onchange =
      async e => {
        const f =
          e.target.files?.[0];

        if (!f) return;

        const src = await scaledData(
          await fileData(f),
          1400,
          "image/jpeg"
        );

        $("world").style.backgroundImage =
          `url("${src}")`;

        $("world").style.backgroundSize =
          "cover";
      };

    $("clearTeacherBg").onclick =
      () => {
        $("world").style.backgroundImage =
          "";

        select.dispatchEvent(
          new Event("change")
        );
      };
  }

  saveHero = function () {
    const ids = new Set(
      state.heroes.map(
        h => h.id
      )
    );

    const previousWelcome =
      welcomeHero;

    welcomeHero = function () {};

    try {
      old.saveHero();
    } finally {
      welcomeHero =
        previousWelcome;
    }

    const h = heroNow();

    if (
      h &&
      !ids.has(h.id)
    ) {
      attachSkills(h);

      const msg =
        "哇！我誕生了！" +
        "你想幫我取什麼名字？" +
        "我又有什麼特別能力呢？";

      chat(
        "🌱 新朋友",
        msg,
        true
      );

      bubble(msg);

      speakFull(msg).then(
        () => {
          if (D.auto) {
            record(true);
          }
        }
      );
    }
  };

  setupButtons = function () {
    old.setupButtons();

    addTeacherBackground();

    replaceButton(
      "sendButton",
      () => command(
        $("chatInput").value
      )
    );

    replaceButton(
      "micButton",
      () => {
        if (D.recording) {
          D.rec?.stop();
          return;
        }

        return record(false);
      }
    );

    replaceButton(
      "skillButton",
      playSkill
    );

    replaceButton(
      "saveEditor",
      saveHero
    );

    replaceButton(
      "stopVoice",
      () => {
        D.auto = false;

        if (
          D.rec?.state ===
          "recording"
        ) {
          D.rec.stop();
        }

        stopAudio();
      }
    );

    const input =
      $("chatInput");

    const copy =
      input.cloneNode(true);

    input.replaceWith(copy);

    copy.addEventListener(
      "keydown",
      e => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.isComposing
        ) {
          e.preventDefault();

          command(
            copy.value
          );
        }
      }
    );

    const b =
      document.createElement(
        "button"
      );

    b.id = "aiAutoTalk";
    b.textContent =
      "🎤 開啟自動對話";

    b.className =
      "full pink";

    $("micButton")
      .parentElement
      .appendChild(b);

    b.onclick = async () => {
      D.auto = !D.auto;

      b.textContent =
        D.auto
          ? "🛑 停止自動對話"
          : "🎤 開啟自動對話";

      if (!D.auto) {
        if (
          D.rec?.state ===
          "recording"
        ) {
          D.rec.stop();
        }

        return;
      }

      try {
        await record(true);

      } catch (e) {
        D.auto = false;

        showMessage(
          "❌ " + e.message
        );
      }
    };
  };
})();
