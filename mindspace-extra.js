
"use strict";

/*
  Mindspace V2 — Dynamic Skills & Auto Conversation
  動態技能 + 角色命名 + 自動語音循環 + 教師背景

  依賴原本 sketch.js：
  state, callAI, heroNow, refreshHeroes,
  chat, bubble, status, performAction,
  addScene, transformHero, scaledData,
  fileData, wav16k, blobBase64 等。

  不修改原本 GAS Bridge 連線。
*/

(function () {

  const X = {
    autoTalk: false,
    listening: false,
    processing: false,
    speechToken: 0,
    micToken: 0,
    recorder: null,
    stream: null,
    chunks: [],
    context: null,
    analyser: null,
    source: null,
    monitor: null,
    heardVoice: false,
    silenceStart: 0,
    startedAt: 0,
    voiceAudio: null,
    voiceUtterance: null,
    background: "",
    backgroundName: "",
    currentSkillIndex: {},
    memoryKey: "mindspace_v2_character_memory"
  };

  const get = id => document.getElementById(id);

  const old = {
    setupButtons,
    saveHero,
    removeHero,
    refreshHeroes,
    animateHeroes,
    drawEnvironment,
    stopSpeech
  };

  const wait = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function sayStatus(message) {
    status(message);
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function selectedHero() {
    return heroNow();
  }

  function heroById(id) {
    return state.heroes.find(h => h.id === id) || null;
  }

  function skillKind(value) {
    const kinds = new Set([
      "spin", "dance", "fly", "jump", "bounce",
      "shake", "hide", "swim", "stop",
      "follow", "meet", "circle",
      "laser", "lightning", "rainbow",
      "glow", "sparkle", "teleport"
    ]);

    return kinds.has(value) ? value : "sparkle";
  }

  function skillColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value))
      ? value
      : "#ff66cc";
  }

  function skillDuration(value) {
    return Math.max(
      1,
      Math.min(20, Number(value) || 6)
    );
  }

  function normalizeSkill(skill) {
    return {
      name: String(skill.name || "神奇技能")
        .trim()
        .slice(0, 50),
      type: skillKind(skill.type),
      color: skillColor(skill.color),
      duration: skillDuration(skill.duration),
      description: String(skill.description || "")
        .slice(0, 150)
    };
  }

  /*
    角色記憶

    每個角色都擁有自己的名字、技能。
    儲存角色資訊，不把大型圖片強行塞進 localStorage。
  */

  function rememberCharacters() {
    const characters = state.heroes.map(h => ({
      id: h.id,
      name: h.name,
      appearance: h.appearance || "",
      personality: h.personality || "",
      skills: safeArray(h.skills).map(normalizeSkill)
    }));

    try {
      localStorage.setItem(
        X.memoryKey,
        JSON.stringify(characters)
      );
    } catch (error) {
      console.warn("角色記憶儲存失敗", error);
    }
  }

  function renameHero(hero, name) {
    if (!hero) return;

    const newName = String(name || "").trim().slice(0, 30);

    if (!newName) return;

    hero.name = newName;

    if (hero.nameElement) {
      hero.nameElement.textContent = newName;
    }

    old.refreshHeroes();
    rememberCharacters();
  }

  function learnSkill(hero, input) {
    if (!hero || !input) return null;

    const skill = normalizeSkill(input);

    if (!Array.isArray(hero.skills)) {
      hero.skills = [];
    }

    const existing = hero.skills.find(
      item => item.name === skill.name
    );

    if (existing) {
      Object.assign(existing, skill);
    } else {
      hero.skills.push(skill);
    }

    rememberCharacters();
    return skill;
  }

  /*
    動態技能

    所有技能都作用在現有黏土角色上。
    不產生新的角色圖片。
  */

  function playSkill(hero, input) {
    if (!hero || !input) return;

    const skill = normalizeSkill(input);
    const now = performance.now();
    const until = now + skill.duration * 1000;

    hero.extraActions = hero.extraActions || [];

    hero.extraActions.push({
      ...skill,
      started: now,
      until
    });

    // 限制同時播放的效果數量。
    hero.extraActions = hero.extraActions.slice(-8);

    const movementTypes = new Set([
      "spin", "dance", "fly", "jump",
      "bounce", "shake", "hide",
      "swim", "stop", "follow",
      "meet", "circle"
    ]);

    if (movementTypes.has(skill.type)) {
      performAction({
        heroId: hero.id,
        type: skill.type,
        duration: skill.duration
      });
    }

    if (skill.type === "teleport") {
      hero.x = Math.max(
        0.12,
        Math.min(0.88, Math.random())
      );

      hero.y = Math.max(
        0.16,
        Math.min(0.8, Math.random())
      );
    }

    if ([
      "laser", "lightning", "rainbow",
      "glow", "sparkle"
    ].includes(skill.type)) {
      hero.skillUntil = until;
    }

    bubble(
      "⚡ " + hero.name + "正在表演：" + skill.name
    );
  }

  function playRememberedSkill(hero) {
    if (!hero) {
      sayStatus("請先選擇黏土主角");
      return;
    }

    if (!hero.skills?.length) {
      sayStatus(
        "這位朋友還沒有技能，試著告訴它能做什麼！"
      );
      return;
    }

    const index = X.currentSkillIndex[hero.id] || 0;
    const skill = hero.skills[index % hero.skills.length];

    X.currentSkillIndex[hero.id] =
      (index + 1) % hero.skills.length;

    playSkill(hero, skill);

    sayStatus(
      "⚡ " + hero.name + "表演：" + skill.name
    );
  }

  /*
    在原本 p5 動畫之後，
    疊加多技能動畫及特效。
  */

  function drawExtraEffect(p, hero, effect, now) {
    const x = hero.x * p.width;
    const y = hero.y * p.height;
    const t = now / 1000;

    p.push();

    if (effect.type === "laser") {
      p.stroke(255);
      p.strokeWeight(10);
      p.line(
        x, y - 20,
        x + hero.face * 260,
        y - 20
      );

      p.stroke(effect.color);
      p.strokeWeight(5);
      p.line(
        x, y - 20,
        x + hero.face * 260,
        y - 20
      );
    }

    if (effect.type === "lightning") {
      p.noFill();
      p.stroke(effect.color);
      p.strokeWeight(5);

      p.beginShape();

      for (let i = 0; i <= 8; i++) {
        const xx = x + hero.face * i * 30;
        const yy = y - 20 + (i % 2 ? 20 : -20);

        p.vertex(xx, yy);
      }

      p.endShape();
    }

    if (effect.type === "rainbow") {
      const colors = [
        "#ff7899", "#ffb86b", "#ffe67c",
        "#8cde9e", "#7fcaff", "#bc9cff"
      ];

      p.noFill();
      p.strokeWeight(5);

      colors.forEach((color, i) => {
        p.stroke(color);
        p.arc(
          x, y,
          130 + i * 12,
          130 + i * 12,
          Math.PI,
          Math.PI * 2
        );
      });
    }

    if (effect.type === "glow") {
      p.noFill();
      p.stroke(effect.color);
      p.strokeWeight(6);

      p.circle(
        x, y,
        150 + Math.sin(t * 7) * 22
      );
    }

    if (
      effect.type === "sparkle" ||
      effect.type === "teleport"
    ) {
      p.noStroke();
      p.fill(effect.color);

      for (let i = 0; i < 12; i++) {
        const angle = t * 3 + i * Math.PI / 6;

        const radius =
          60 + Math.sin(t * 5 + i) * 20;

        p.circle(
          x + Math.cos(angle) * radius,
          y + Math.sin(angle) * radius,
          7 + i % 4
        );
      }
    }

    p.pop();
  }

  animateHeroes = function (p, t) {
    old.animateHeroes(p, t);

    const now = performance.now();

    for (const hero of state.heroes) {
      hero.extraActions = safeArray(
        hero.extraActions
      ).filter(effect => effect.until > now);

      const active = hero.extraActions;

      const has = type =>
        active.some(effect => effect.type === type);

      if (has("hide")) {
        hero.element.style.opacity = "0.12";
      }

      if (has("spin") && hero.action?.type !== "spin") {
        hero.element.style.transform +=
          ` rotate(${(t * 220) % 360}deg)`;
      }

      if (has("dance") && hero.action?.type !== "dance") {
        hero.element.style.transform +=
          ` rotate(${Math.sin(t * 7) * 22}deg)`;
      }

      if (has("fly") && hero.action?.type !== "fly") {
        hero.element.style.top =
          (hero.y * 100 -
           Math.sin(t * 3) * 5) + "%";
      }

      if (has("bounce") && hero.action?.type !== "bounce") {
        hero.element.style.transform +=
          ` translateY(${-Math.abs(Math.sin(t * 6)) * 35}px)`;
      }

      for (const effect of active) {
        drawExtraEffect(p, hero, effect, now);
      }
    }
  };

  /*
    AI 語音

    必須等聲音真正播放完畢，
    才可以重新開啟麥克風。
  */

  function cancelSpeech() {
    X.speechToken++;

    if (X.voiceAudio) {
      X.voiceAudio.pause();
      X.voiceAudio.src = "";
      X.voiceAudio = null;
    }

    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    old.stopSpeech();
  }

  function browserSpeak(text, token) {
    return new Promise(resolve => {
      if (
        !state.voiceEnabled ||
        !("speechSynthesis" in window)
      ) {
        resolve();
        return;
      }

      const utterance =
        new SpeechSynthesisUtterance(text);

      utterance.lang = "zh-TW";
      utterance.rate = 0.95;
      utterance.pitch = 1.08;

      const voices = speechSynthesis.getVoices();

      utterance.voice =
        voices.find(v => v.lang === "zh-TW") ||
        voices.find(v => v.lang.startsWith("zh")) ||
        null;

      X.voiceUtterance = utterance;

      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      utterance.onend = done;
      utterance.onerror = done;

      try {
        speechSynthesis.speak(utterance);
      } catch (_) {
        done();
      }

      // 防止少數瀏覽器不觸發 onend。
      const timer = setInterval(() => {
        if (
          finished ||
          token !== X.speechToken ||
          !speechSynthesis.speaking &&
          !speechSynthesis.pending
        ) {
          clearInterval(timer);
          done();
        }
      }, 250);
    });
  }

  async function speakAndWait(text) {
    if (!text) return;

    cancelSpeech();

    const token = X.speechToken;

    if (!state.voiceEnabled) {
      return;
    }

    try {
      if (!state.bridgeReady) {
        await browserSpeak(text, token);
        return;
      }

      const response = await callAI(
        "speakNatural",
        { text: text.slice(0, 550) }
      );

      if (token !== X.speechToken) return;

      if (!response.audio) {
        throw Error("AI 沒有回傳語音");
      }

      const audio = new Audio(
        "data:audio/mpeg;base64," + response.audio
      );

      X.voiceAudio = audio;

      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () =>
          reject(Error("音訊播放失敗"));

        audio.play().catch(reject);
      });

    } catch (error) {
      if (token === X.speechToken) {
        console.warn(
          "自然語音失敗，改用瀏覽器語音：",
          error
        );

        await browserSpeak(text, token);
      }
    }
  }

  /*
    麥克風自動錄音

    使用 MediaRecorder + 音量偵測：
    - 偵測孩子開始說話
    - 靜音約 1.5 秒後送出
    - 最長約 16 秒
    - 沒有人說話時停止，不送空白錄音
  */

  function releaseMicrophone() {
    if (X.monitor) {
      clearInterval(X.monitor);
      X.monitor = null;
    }

    try {
      X.source?.disconnect();
    } catch (_) {}

    X.source = null;
    X.analyser = null;

    if (X.context) {
      X.context.close().catch(() => {});
      X.context = null;
    }

    if (X.stream) {
      X.stream.getTracks().forEach(
        track => track.stop()
      );
      X.stream = null;
    }

    X.listening = false;
    state.recording = false;

    const mic = get("micButton");

    if (mic) {
      mic.textContent = "🎙️ 開始說話";
    }
  }

  function stopRecording() {
    if (X.recorder?.state === "recording") {
      X.recorder.stop();
    }
  }

  function recordMimeType() {
    const formats = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm"
    ];

    return formats.find(
      type => MediaRecorder.isTypeSupported(type)
    ) || "";
  }

  async function beginRecording(auto = false) {
    if (X.listening || X.processing) return;

    if (!state.bridgeReady) {
      throw Error("請先等待 AI 連線成功");
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      throw Error(
        "此瀏覽器不支援錄音，請使用新版 Chrome、Edge 或 Safari"
      );
    }

    // 防止角色自己的聲音被錄進去。
    cancelSpeech();

    const micToken = ++X.micToken;

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

    if (
      micToken !== X.micToken ||
      auto && !X.autoTalk
    ) {
      stream.getTracks().forEach(
        track => track.stop()
      );
      return;
    }

    const mimeType = recordMimeType();

    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : {}
    );

    X.stream = stream;
    X.recorder = recorder;
    X.chunks = [];
    X.listening = true;
    X.heardVoice = false;
    X.silenceStart = 0;
    X.startedAt = Date.now();

    state.recording = true;

    recorder.ondataavailable = event => {
      if (event.data.size) {
        X.chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      const chunks = [...X.chunks];
      const recordedType =
        recorder.mimeType || "audio/webm";

      const heardVoice = X.heardVoice;
      const duration = Date.now() - X.startedAt;

      releaseMicrophone();

      if (auto && !X.autoTalk) return;

      if (auto && !heardVoice) {
        sayStatus(
          "🎤 沒有聽到說話，自動聆聽已暫停"
        );
        stopAutoTalk(false);
        return;
      }

      if (duration < 350) {
        sayStatus("錄音時間太短");
        return;
      }

      processRecording(
        new Blob(chunks, { type: recordedType }),
        auto
      );
    };

    recorder.start();

    get("micButton").textContent =
      "⏹️ 結束說話";

    sayStatus(
      auto
        ? "🎤 正在自動聆聽孩子說話……"
        : "🎤 正在錄音，說完請按結束"
    );

    if (auto) {
      startVoiceDetection(stream);
    }
  }

  function startVoiceDetection(stream) {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      // 無法偵測音量時，至少限制錄音時間。
      X.monitor = setInterval(() => {
        if (Date.now() - X.startedAt > 12000) {
          stopRecording();
        }
      }, 200);
      return;
    }

    X.context = new AudioContextClass();
    X.source =
      X.context.createMediaStreamSource(stream);

    X.analyser = X.context.createAnalyser();
    X.analyser.fftSize = 2048;

    X.source.connect(X.analyser);

    const samples = new Uint8Array(
      X.analyser.fftSize
    );

    X.monitor = setInterval(() => {
      if (!X.listening || !X.analyser) return;

      X.analyser.getByteTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }

      const volume = Math.sqrt(
        sum / samples.length
      );

      const now = Date.now();
      const elapsed = now - X.startedAt;

      // 音量門檻可依實際教室環境調整。
      const isSpeaking = volume > 0.025;

      if (isSpeaking) {
        X.heardVoice = true;
        X.silenceStart = 0;
      } else if (X.heardVoice) {
        if (!X.silenceStart) {
          X.silenceStart = now;
        }
      }

      const finished =
        X.heardVoice &&
        X.silenceStart &&
        now - X.silenceStart > 1500;

      const maxDuration = elapsed > 16000;
      const noSpeech = !X.heardVoice &&
        elapsed > 10000;

      if (finished || maxDuration || noSpeech) {
        stopRecording();
      }
    }, 100);
  }

  async function processRecording(blob, auto) {
    if (X.processing) return;

    X.processing = true;

    try {
      if (!blob.size) {
        throw Error("沒有收到錄音資料");
      }

      sayStatus("🧠 AI 正在辨識語音……");

      const wav = await wav16k(blob);
      const audio = await blobBase64(wav);

      if (audio.length > 7000000) {
        throw Error("錄音太長，請縮短句子");
      }

      const result = await callAI(
        "transcribe",
        { audio },
        120000
      );

      const message = String(
        result.text || ""
      ).trim();

      if (!message) {
        sayStatus("沒有辨識到孩子說的話");

        if (auto) {
          stopAutoTalk(false);
        }

        return;
      }

      get("chatInput").value = message;

      X.processing = false;

      await sendChildMessage(message);

    } catch (error) {
      sayStatus(
        "❌ 語音辨識失敗：" + error.message
      );

      if (auto) {
        stopAutoTalk(false);
      }
    } finally {
      X.processing = false;
    }
  }

  /*
    AI 指令處理

    一次解析：
    - 命名
    - 新增技能
    - 表演技能
    - 多角色互動
    - 場景事件
    - 明確要求的黏土外型變身
  */

  async function sendChildMessage(text) {
    const message = String(text || "").trim();

    if (!message) return;

    if (state.busy) return;

    if (!state.heroes.length) {
      sayStatus("請先創造至少一個黏土主角");
      return;
    }

    state.busy = true;

    const button = get("sendButton");
    button.disabled = true;

    get("chatInput").value = "";

    chat("🧒 孩子", message);

    sayStatus("🤖 AI 正在理解角色與技能……");

    try {
      const result = await callAI(
        "mindspaceCommand",
        {
          message,
          selectedHeroId: state.selectedId,
          heroes: state.heroes.map(hero => ({
            id: hero.id,
            name: hero.name,
            appearance: hero.appearance || "",
            personality: hero.personality || "",
            skills: safeArray(hero.skills).map(
              normalizeSkill
            )
          })),
          history: state.history.slice(-12),
          activeScenes: state.scenes.map(
            scene => scene.type
          )
        },
        120000
      );

      // 1. 更新角色名字
      for (const item of safeArray(result.renames)) {
        const hero = heroById(item.heroId);

        if (hero) {
          renameHero(hero, item.name);
        }
      }

      // 2. 記住新技能
      for (const item of safeArray(result.skills)) {
        const hero = heroById(item.heroId);

        if (hero) {
          learnSkill(hero, item);
        }
      }

      // 3. 表演動態技能
      for (const action of safeArray(result.actions)) {
        const hero = heroById(action.heroId);

        if (!hero) continue;

        const skill = normalizeSkill({
          name: action.name || action.type,
          type: action.type,
          color: action.color,
          duration: action.duration
        });

        playSkill(hero, skill);
      }

      // 4. 世界故事事件
      for (const scene of safeArray(result.scenes)) {
        addScene(scene);
      }

      // 5. 只有明確要求外型改變才生成圖片
      for (const item of safeArray(result.transforms)) {
        const hero = heroById(item.heroId);

        if (!hero || !item.description) continue;

        try {
          await transformHero(
            hero,
            item.description
          );
        } catch (error) {
          sayStatus(
            "⚠️ 黏土變身失敗：" + error.message
          );
        }
      }

      const speaker =
        heroById(result.speakerId) ||
        selectedHero() ||
        state.heroes[0];

      const reply = String(
        result.reply ||
        "哇！我們一起試試看吧！"
      );

      chat(
        "🐠 " + speaker.name,
        reply,
        true
      );

      bubble(
        "🐠 " + speaker.name + "：" + reply
      );

      state.history.push(
        { role: "user", content: message },
        { role: "assistant", content: reply }
      );

      if (state.history.length > 24) {
        state.history.splice(
          0,
          state.history.length - 24
        );
      }

      old.refreshHeroes();
      rememberCharacters();

      sayStatus("🌈 角色與技能已更新");

      state.busy = false;
      button.disabled = false;

      await speakAndWait(reply);

      // 關鍵：AI 語音真正結束後，自動開麥克風。
      if (X.autoTalk) {
        await wait(450);

        if (
          X.autoTalk &&
          !X.listening &&
          !X.processing
        ) {
          await beginRecording(true);
        }
      }

    } catch (error) {
      sayStatus("❌ " + error.message);

      chat(
        "⚠️ 系統",
        error.message,
        true
      );

      if (X.autoTalk) {
        stopAutoTalk(false);
      }

    } finally {
      state.busy = false;
      button.disabled = false;
    }
  }

  /*
    自動對話
  */

  function updateAutoButton() {
    const button = get("autoTalkButton");

    if (!button) return;

    button.textContent = X.autoTalk
      ? "🛑 停止自動語音對話"
      : "🎤 開始自動語音對話";

    button.className = X.autoTalk
      ? "full yellow"
      : "full pink";
  }

  function stopAutoTalk(showMessage = true) {
    X.autoTalk = false;
    X.micToken++;

    stopRecording();
    cancelSpeech();
    releaseMicrophone();

    updateAutoButton();

    if (showMessage) {
      sayStatus("⏹️ 自動語音對話已停止");
    }
  }

  async function startAutoTalk() {
    if (X.autoTalk) {
      stopAutoTalk();
      return;
    }

    if (!state.bridgeReady) {
      sayStatus("請先等待 AI 連線成功");
      return;
    }

    if (!selectedHero()) {
      sayStatus("請先創造一位黏土朋友");
      return;
    }

    try {
      // 使用者點擊時取得麥克風授權。
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      stream.getTracks().forEach(
        track => track.stop()
      );

      X.autoTalk = true;

      updateAutoButton();

      const hero = selectedHero();

      const greeting =
        "你好呀！我是" + hero.name +
        "！你可以幫我取名字，" +
        "也可以告訴我有什麼神奇技能！";

      chat(
        "🐠 " + hero.name,
        greeting,
        true
      );

      bubble(
        "🐠 " + hero.name + "：" + greeting
      );

      await speakAndWait(greeting);

      if (X.autoTalk) {
        await wait(450);
        await beginRecording(true);
      }

    } catch (error) {
      stopAutoTalk(false);

      sayStatus(
        "❌ 自動語音啟動失敗：" +
        error.message
      );
    }
  }

  /*
    新角色誕生：
    每一隻都主動邀請命名。
  */

  function welcomeNewHero(hero) {
    const greeting =
      "哇！我誕生了！" +
      "請幫我取個名字吧！" +
      "我還會很多神奇的技能，" +
      "你想讓我表演什麼呢？";

    chat(
      "🌈 新朋友",
      greeting,
      true
    );

    bubble("🌈 新朋友：" + greeting);

    // 避免原本 welcomeHero 重複發聲。
    speakAndWait(greeting).then(async () => {
      if (X.autoTalk && !X.listening) {
        await wait(450);
        await beginRecording(true);
      }
    }).catch(error => {
      sayStatus("⚠️ " + error.message);
    });
  }

  saveHero = function () {
    const existing = new Set(
      state.heroes.map(h => h.id)
    );

    // 原本 saveHero 第一隻會呼叫 welcomeHero，
    // 先暫時關閉語音，避免重複播報。
    const previousVoice = state.voiceEnabled;

    state.voiceEnabled = false;

    try {
      old.saveHero();
    } finally {
      state.voiceEnabled = previousVoice;
    }

    const hero = selectedHero();

    if (hero && !existing.has(hero.id)) {
      welcomeNewHero(hero);
      rememberCharacters();
    }
  };

  removeHero = function () {
    old.removeHero();
    rememberCharacters();
  };

  /*
    教師背景
  */

  function applyBackground(image, name = "") {
    X.background = image || "";
    X.backgroundName = name;

    const world = get("world");

    if (image) {
      world.style.backgroundImage =
        `url("${image}")`;

      world.style.backgroundSize = "cover";
      world.style.backgroundPosition = "center";
      world.style.backgroundRepeat = "no-repeat";
    } else {
      world.style.backgroundImage = "";
    }

    const label = get("backgroundLabel");

    if (label) {
      label.textContent = image
        ? "目前背景：" + (name || "自訂背景")
        : "目前使用內建世界";
    }
  }

  drawEnvironment = function (p, t) {
    if (X.background) return;
    old.drawEnvironment(p, t);
  };

  function installBackgroundSettings() {
    const section = document.createElement("section");
    section.className = "section";

    section.innerHTML = `
      <h2>👩‍🏫 教師設定｜自訂背景</h2>
      <p class="hint">
        可上傳海底、森林、太空或自製場景圖片。
      </p>
      <input
        id="backgroundFile"
        type="file"
        accept="image/*"
        hidden
      >
      <div class="grid">
        <button id="backgroundUpload" class="pink">
          🖼️ 上傳背景
        </button>
        <button id="backgroundReset" class="blue">
          ↩️ 恢復內建
        </button>
      </div>
      <p id="backgroundLabel" class="hint">
        目前使用內建世界
      </p>
    `;

    const worldSection =
      get("worldSelect").closest(".section");

    worldSection.after(section);

    get("backgroundUpload").onclick = () => {
      get("backgroundFile").click();
    };

    get("backgroundFile").onchange =
      async event => {
        try {
          const file = event.target.files?.[0];

          if (!file) return;

          const data = await fileData(file);

          const image = await scaledData(
            data,
            1400,
            "image/jpeg"
          );

          applyBackground(image, file.name);

          try {
            localStorage.setItem(
              "mindspace_teacher_background",
              JSON.stringify({
                image,
                name: file.name
              })
            );
          } catch (_) {
            sayStatus(
              "⚠️ 背景已套用，但儲存空間不足"
            );
          }

        } catch (error) {
          sayStatus(
            "❌ 背景上傳失敗：" +
            error.message
          );
        }
      };

    get("backgroundReset").onclick = () => {
      localStorage.removeItem(
        "mindspace_teacher_background"
      );

      applyBackground("", "");

      get("worldSelect").dispatchEvent(
        new Event("change")
      );
    };

    try {
      const saved = JSON.parse(
        localStorage.getItem(
          "mindspace_teacher_background"
        ) || "null"
      );

      if (saved?.image) {
        applyBackground(
          saved.image,
          saved.name
        );
      }
    } catch (_) {}

    get("worldSelect").addEventListener(
      "change",
      () => {
        if (X.background) {
          applyBackground(
            X.background,
            X.backgroundName
          );
        }
      }
    );
  }

  /*
    將原本沒有完整接線的技能與語音按鈕
    改成確實執行新功能。

    用 cloneNode 移除舊事件，
    不影響其他既有按鈕。
  */

  function replaceButton(id, handler) {
    const oldButton = get(id);

    if (!oldButton) return;

    const button = oldButton.cloneNode(true);

    oldButton.replaceWith(button);

    button.addEventListener("click", () => {
      Promise.resolve()
        .then(handler)
        .catch(error => {
          sayStatus("❌ " + error.message);
        });
    });
  }

  function installControls() {
    const conversationSection =
      get("micButton").closest(".section");

    const autoButton =
      document.createElement("button");

    autoButton.id = "autoTalkButton";
    autoButton.className = "full pink";
    autoButton.textContent =
      "🎤 開始自動語音對話";

    conversationSection.appendChild(autoButton);

    autoButton.onclick = startAutoTalk;

    const hint = document.createElement("p");
    hint.className = "hint";

    hint.textContent =
      "AI 說完會自動聆聽，孩子說完後會自動辨識。" +
      "首次使用需允許麥克風權限。";

    conversationSection.appendChild(hint);

    replaceButton("micButton", async () => {
      if (X.listening) {
        stopRecording();
      } else {
        await beginRecording(false);
      }
    });

    replaceButton("sendButton", async () => {
      await sendChildMessage(
        get("chatInput").value
      );
    });

    // 原本技能按鈕現在真正執行動態技能。
    replaceButton("skillButton", () => {
      playRememberedSkill(selectedHero());
    });

    // 只有外型變化才使用 AI 圖片生成。
    replaceButton("transformButton", async () => {
      const hero = selectedHero();
      const description =
        get("transformInput").value.trim();

      if (!hero) {
        throw Error("請先選擇主角");
      }

      if (!description) {
        throw Error("請描述想改變的黏土外型");
      }

      const button = get("transformButton");

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

    replaceButton("stopVoice", () => {
      stopAutoTalk();
    });

    // Enter 送出改走新 AI 指令。
    const oldInput = get("chatInput");
    const newInput = oldInput.cloneNode(true);

    oldInput.replaceWith(newInput);

    newInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing
        ) {
          event.preventDefault();

          sendChildMessage(
            newInput.value
          );
        }
      }
    );

    // 重新建立角色時，確保原本事件仍能使用
    // 新版 saveHero 函式。
    replaceButton("saveEditor", () => {
      saveHero();
    });

    replaceButton("deleteHero", () => {
      removeHero();
    });

    // 刪除所有主角時清除角色記憶。
    get("resetButton").addEventListener(
      "click",
      () => {
        if (!state.heroes.length) {
          localStorage.removeItem(
            X.memoryKey
          );
        }
      }
    );
  }

  /*
    初始化

    保留原本 setupButtons 的所有功能。
  */

  setupButtons = function () {
    old.setupButtons();

    installBackgroundSettings();
    installControls();

    console.log(
      "[Mindspace] 動態技能與自動語音功能已啟動"
    );
  };

})();
