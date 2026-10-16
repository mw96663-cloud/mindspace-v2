
"use strict";

/*
  Mindspace V2 功能擴充
  不修改 GAS_URL、initializeBridge、callAI 或 Bridge.html。

  新增：
  1. 教師自訂背景
  2. 每個新角色主動邀請命名
  3. AI 記住角色名字與技能
  4. AI 說完後自動聆聽
  5. 語音控制黏土變身
*/

(function () {
  const extra = {
    autoTalk: false,
    listening: false,
    recordingMode: "chat",
    audioContext: null,
    analyser: null,
    microphoneSource: null,
    monitorTimer: null,
    silenceSince: 0,
    speechDetected: false,
    recordingStartedAt: 0,
    background: "",
    backgroundName: "",
    conversationGeneration: 0
  };

  const original = {
    setupButtons: setupButtons,
    saveHero: saveHero,
    welcomeHero: welcomeHero,
    sendStory: sendStory,
    speak: speak,
    stopSpeech: stopSpeech,
    toggleRecording: toggleRecording,
    finishRecording: finishRecording
  };

  const el = id => document.getElementById(id);

  function showStatus(message) {
    status(message);
  }

  function setAutoButton() {
    const button = el("autoTalkButton");
    if (button) {
      button.textContent = extra.autoTalk
        ? "🛑 結束自動語音對話"
        : "🎤 開始自動語音對話";
      button.className = extra.autoTalk
        ? "full yellow"
        : "full pink";
    }
  }

  function stopMonitor() {
    if (extra.monitorTimer) {
      clearInterval(extra.monitorTimer);
      extra.monitorTimer = null;
    }

    try {
      extra.microphoneSource?.disconnect();
    } catch (_) {}

    extra.microphoneSource = null;
    extra.analyser = null;

    if (extra.audioContext) {
      extra.audioContext.close().catch(() => {});
      extra.audioContext = null;
    }

    extra.listening = false;
  }

  function stopAutoConversation() {
    extra.autoTalk = false;
    extra.conversationGeneration++;
    stopMonitor();

    if (state.recorder?.state === "recording") {
      state.recorder.stop();
    }

    setAutoButton();
    showStatus("⏹️ 已結束自動語音對話");
  }

  function waitForAudioEnd(audio, generation) {
    return new Promise(resolve => {
      if (!audio || audio.ended) {
        resolve();
        return;
      }

      let completed = false;

      function finish() {
        if (completed) return;
        completed = true;
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        resolve();
      }

      audio.addEventListener("ended", finish);
      audio.addEventListener("error", finish);

      // 防止音訊事件異常導致永遠無法繼續。
      const started = Date.now();

      const timer = setInterval(() => {
        if (
          completed ||
          generation !== extra.conversationGeneration ||
          audio.paused ||
          audio.ended ||
          Date.now() - started > 45000
        ) {
          clearInterval(timer);
          finish();
        }
      }, 300);
    });
  }

  async function waitForBrowserSpeech(generation) {
    if (!("speechSynthesis" in window)) return;

    const started = Date.now();

    while (
      generation === extra.conversationGeneration &&
      Date.now() - started < 45000
    ) {
      if (!speechSynthesis.speaking &&
          !speechSynthesis.pending) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  async function resumeListening(generation) {
    if (
      !extra.autoTalk ||
      generation !== extra.conversationGeneration ||
      extra.listening ||
      state.recording ||
      state.busy
    ) {
      return;
    }

    try {
      await toggleRecording();
    } catch (error) {
      showStatus("❌ 自動聆聽失敗：" + error.message);
      stopAutoConversation();
    }
  }

  /*
    讓 AI 說完話才開麥克風。
    保留原本的 OpenAI TTS 與瀏覽器語音備援。
  */
  speak = async function (text) {
    const generation = extra.conversationGeneration;

    await original.speak(text);

    if (!extra.autoTalk) return;

    if (state.audio) {
      await waitForAudioEnd(state.audio, generation);
    } else {
      await waitForBrowserSpeech(generation);
    }

    if (
      extra.autoTalk &&
      generation === extra.conversationGeneration
    ) {
      await new Promise(resolve => setTimeout(resolve, 400));
      await resumeListening(generation);
    }
  };

  /*
    每一隻新角色都會主動問名字。
    角色真正的名字由孩子決定。
  */
  welcomeHero = function (hero) {
    const text =
      "哇！我誕生了！請幫我取個名字吧！" +
      "我會很多神奇的技能！" +
      "你想讓我表演什麼技能呢？";

    state.selectedId = hero.id;
    refreshHeroes();

    chat("🌈 新朋友", text, true);
    bubble("🌈 新朋友：" + text);
    speak(text);
  };

  saveHero = function () {
    const previousIds = new Set(
      state.heroes.map(hero => hero.id)
    );

    original.saveHero();

    const hero = heroNow();

    if (!hero || previousIds.has(hero.id)) return;

    // 原本第一隻角色已由 saveHero 呼叫 welcomeHero。
    // 這裡補上第二隻以後的新角色。
    if (previousIds.size > 0) {
      welcomeHero(hero);
    }
  };

  function updateHeroName(hero, newName) {
    if (!hero || !newName) return;

    const name = String(newName).trim().slice(0, 30);

    if (!name) return;

    hero.name = name;

    if (hero.nameElement) {
      hero.nameElement.textContent = name;
    }

    refreshHeroes();
  }

  function rememberSkill(hero, skill) {
    if (!hero || !skill?.name) return;

    const name = String(skill.name).trim().slice(0, 40);
    if (!name) return;

    const type = String(skill.type || "glow");
    const color = /^#[0-9a-fA-F]{6}$/.test(
      String(skill.color || "")
    ) ? skill.color : "#ff66cc";

    if (!Array.isArray(hero.skills)) {
      hero.skills = [];
    }

    const existing = hero.skills.find(
      item => item.name === name
    );

    if (existing) {
      existing.type = type;
      existing.color = color;
    } else {
      hero.skills.push({ name, type, color });
    }

    hero.skillUntil = performance.now() + 5000;
  }

  async function understandChildMessage(message) {
    const heroes = state.heroes.map(hero => ({
      id: hero.id,
      name: hero.name,
      appearance: hero.appearance || "",
      skills: (hero.skills || []).map(skill => skill.name)
    }));

    const result = await callAI("understandChild", {
      message,
      selectedHeroId: state.selectedId,
      heroes
    });

    if (!result) return;

    for (const rename of result.renames || []) {
      const hero = state.heroes.find(
        item => item.id === rename.heroId
      );

      if (hero) {
        updateHeroName(hero, rename.name);
      }
    }

    for (const item of result.skills || []) {
      const hero = state.heroes.find(
        candidate => candidate.id === item.heroId
      );

      if (hero) {
        rememberSkill(hero, item);
      }
    }

    if (
      result.renames?.length ||
      result.skills?.length
    ) {
      refreshHeroes();
    }
  }

  /*
    一般故事對話之前，先更新角色的名字與技能。
    即使 AI 故事後續失敗，已理解的角色資料仍保留。
  */
  sendStory = async function () {
    const message = el("chatInput").value.trim();

    if (!message || state.busy) return;

    try {
      await understandChildMessage(message);
    } catch (error) {
      console.warn(
        "[Mindspace Extra] 角色記憶解析失敗：",
        error
      );
      // 不讓角色記憶功能故障影響原本故事。
    }

    await original.sendStory();

    // 原本 story 可能另外新增相同技能，
    // 這裡合併重複項目，保留技能累積。
    for (const hero of state.heroes) {
      const unique = new Map();

      for (const skill of hero.skills || []) {
        if (skill?.name) {
          unique.set(skill.name, skill);
        }
      }

      hero.skills = [...unique.values()];
    }
  };

  function startSilenceDetection(stream) {
    stopMonitor();

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = 2048;
    source.connect(analyser);

    extra.audioContext = context;
    extra.microphoneSource = source;
    extra.analyser = analyser;
    extra.listening = true;
    extra.speechDetected = false;
    extra.silenceSince = 0;
    extra.recordingStartedAt = Date.now();

    const samples = new Uint8Array(analyser.fftSize);

    extra.monitorTimer = setInterval(() => {
      if (!state.recording) {
        stopMonitor();
        return;
      }

      analyser.getByteTimeDomainData(samples);

      let sum = 0;

      for (let i = 0; i < samples.length; i++) {
        const amplitude = (samples[i] - 128) / 128;
        sum += amplitude * amplitude;
      }

      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      const elapsed = now - extra.recordingStartedAt;

      // 可依教室環境調整。
      const voiceDetected = rms > 0.025;

      if (voiceDetected) {
        extra.speechDetected = true;
        extra.silenceSince = 0;
      } else if (extra.speechDetected) {
        if (!extra.silenceSince) {
          extra.silenceSince = now;
        }
      }

      const finishedSentence =
        extra.speechDetected &&
        extra.silenceSince &&
        now - extra.silenceSince > 1600;

      const timedOut = elapsed > 12000;

      if (finishedSentence || timedOut) {
        stopMonitor();

        if (state.recorder?.state === "recording") {
          state.recorder.stop();
        }
      }
    }, 100);
  }

  toggleRecording = async function () {
    if (state.recording) {
      stopMonitor();
      return original.toggleRecording();
    }

    await original.toggleRecording();

    if (
      extra.autoTalk &&
      state.recording &&
      state.audioStream
    ) {
      startSilenceDetection(state.audioStream);
    }
  };

  /*
    錄音模式：
    chat = 一般對話、命名與技能
    transform = AI 黏土造型描述
  */
  finishRecording = async function () {
    stopMonitor();

    if (extra.recordingMode !== "transform") {
      return original.finishRecording();
    }

    state.recording = false;
    el("micButton").textContent = "🎙️ 開始說話";

    state.audioStream?.getTracks().forEach(
      track => track.stop()
    );

    state.audioStream = null;

    try {
      const blob = new Blob(state.audioChunks, {
        type: state.recorder?.mimeType || "audio/webm"
      });

      if (!blob.size) {
        throw Error("沒有收到錄音");
      }

      showStatus("🧠 正在辨識黏土變身指令……");

      const wav = await wav16k(blob);
      const audio = await blobBase64(wav);
      const result = await callAI("transcribe", { audio });
      const description = String(result.text || "").trim();

      if (!description) {
        throw Error("沒有辨識到語音");
      }

      el("transformInput").value = description;

      await transformHero(heroNow(), description);
    } catch (error) {
      showStatus("❌ 語音變身失敗：" + error.message);
    } finally {
      state.recorder = null;
      state.audioChunks = [];
      extra.recordingMode = "chat";
    }
  };

  /*
    教師背景圖片
  */
  function applyBackground(src, name = "") {
    extra.background = src || "";
    extra.backgroundName = name;

    const world = el("world");

    if (src) {
      world.style.backgroundImage =
        `url("${src}")`;
      world.style.backgroundPosition = "center";
      world.style.backgroundSize = "cover";
      world.style.backgroundRepeat = "no-repeat";
    } else {
      world.style.backgroundImage = "";
    }

    const label = el("teacherBackgroundName");

    if (label) {
      label.textContent = src
        ? "目前背景：" + (name || "教師自訂圖片")
        : "目前使用內建世界背景";
    }
  }

  async function uploadBackground(file) {
    if (!file || !file.type.startsWith("image/")) {
      throw Error("請選擇圖片檔案");
    }

    const data = await fileData(file);
    const scaled = await scaledData(
      data, 1400, "image/jpeg"
    );

    applyBackground(scaled, file.name);

    try {
      localStorage.setItem(
        "mindspace_teacher_background",
        JSON.stringify({
          image: scaled,
          name: file.name
        })
      );
    } catch (error) {
      showStatus(
        "⚠️ 背景已套用，但瀏覽器儲存空間不足，重新整理後可能消失"
      );
      return;
    }

    showStatus("🖼️ 教師背景已更新");
  }

  /*
    使用原本的 p5 畫布與角色動畫。
    自訂背景時略過內建裝飾，避免遮住老師的圖片。
  */
  const originalDrawEnvironment = drawEnvironment;

  drawEnvironment = function (p, t) {
    if (extra.background) return;
    return originalDrawEnvironment(p, t);
  };

  function installTeacherPanel() {
    const section = document.createElement("section");
    section.className = "section";

    section.innerHTML = `
      <h2>👩‍🏫 教師設定｜世界背景</h2>
      <p class="hint">
        可上傳教師自行設計的背景，
        不影響黏土角色與原本的世界切換。
      </p>
      <input
        type="file"
        id="teacherBackgroundFile"
        accept="image/*"
        hidden
      >
      <div class="grid">
        <button id="teacherUploadBackground" class="pink">
          🖼️ 上傳背景
        </button>
        <button id="teacherResetBackground" class="blue">
          ↩️ 恢復內建背景
        </button>
      </div>
      <p id="teacherBackgroundName" class="hint">
        目前使用內建世界背景
      </p>
    `;

    const sections = document.querySelectorAll(
      "#sidebar .section"
    );

    const worldSection = [...sections].find(
      section => section.querySelector("#worldSelect")
    );

    if (worldSection) {
      worldSection.after(section);
    } else {
      el("sidebar").appendChild(section);
    }

    el("teacherUploadBackground").onclick = () => {
      el("teacherBackgroundFile").click();
    };

    el("teacherBackgroundFile").onchange = async event => {
      try {
        await uploadBackground(event.target.files[0]);
      } catch (error) {
        showStatus("❌ 背景上傳失敗：" + error.message);
      }
    };

    el("teacherResetBackground").onclick = () => {
      localStorage.removeItem(
        "mindspace_teacher_background"
      );

      applyBackground("", "");
      el("worldSelect").dispatchEvent(
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
        applyBackground(saved.image, saved.name || "");
      }
    } catch (_) {}
  }

  function installVoiceControls() {
    const conversationSection =
      el("micButton").closest(".section");

    const button = document.createElement("button");
    button.id = "autoTalkButton";
    button.className = "full pink";
    button.textContent = "🎤 開始自動語音對話";

    conversationSection.appendChild(button);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "開啟後，角色說完話會自動聆聽孩子回答。" +
      "請先允許麥克風權限，結束時按停止。";

    conversationSection.appendChild(hint);

    button.onclick = async () => {
      if (extra.autoTalk) {
        stopAutoConversation();
        return;
      }

      if (!state.bridgeReady) {
        showStatus("請先等待 GAS 連線成功");
        return;
      }

      try {
        // 在使用者點擊時先要求權限。
        const stream =
          await navigator.mediaDevices.getUserMedia({
            audio: true
          });

        stream.getTracks().forEach(track => track.stop());

        extra.autoTalk = true;
        extra.recordingMode = "chat";
        extra.conversationGeneration++;

        setAutoButton();

        const hero = heroNow();

        if (hero) {
          const promptText =
            `你好！我是${hero.name}！` +
            "你想跟我說什麼？";

          bubble("🎤 " + promptText);
          await speak(promptText);
        } else {
          showStatus(
            "🎤 自動對話已開啟，請先創造黏土角色"
          );
        }
      } catch (error) {
        stopAutoConversation();
        showStatus(
          "❌ 無法開啟麥克風：" + error.message
        );
      }
    };

    const transformSection =
      el("transformButton").closest(".section");

    const transformMic = document.createElement("button");
    transformMic.id = "transformMicButton";
    transformMic.className = "full mint";
    transformMic.textContent = "🎙️ 用說的修改黏土造型";

    transformSection.appendChild(transformMic);

    transformMic.onclick = async () => {
      if (state.recording) {
        await toggleRecording();
        return;
      }

      if (!heroNow()) {
        showStatus("請先創造黏土角色");
        return;
      }

      extra.recordingMode = "transform";

      try {
        await toggleRecording();
        showStatus(
          "🎨 請描述想增加的黏土造型，說完再按一次按鈕"
        );
      } catch (error) {
        extra.recordingMode = "chat";
        showStatus("❌ " + error.message);
      }
    };

    // 使用原本的停止聲音按鈕，
    // 同時允許結束自動對話。
    el("stopVoice").addEventListener(
      "click",
      stopAutoConversation
    );
  }

  /*
    原本 setupButtons 仍會完整執行。
    擴充控制項在原本按鈕完成綁定後才加入。
  */
  setupButtons = function () {
    original.setupButtons();

    installTeacherPanel();
    installVoiceControls();

    el("worldSelect").addEventListener(
      "change",
      () => {
        // 切換內建世界不會刪掉教師圖片。
        if (extra.background) {
          applyBackground(
            extra.background,
            extra.backgroundName
          );
        }
      }
    );
  };

  console.log(
    "[Mindspace Extra] 擴充功能已載入，原 GAS Bridge 未修改"
  );
})();
