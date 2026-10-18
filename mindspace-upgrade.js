
/* ==========================================================
   MINDSPACE V2 — INTERACTION & SKILL UPGRADE
   1. 工具籃展開時不模糊海底世界
   2. 角色名稱保持正向
   3. 精緻技能：雷射、泡泡、火焰、閃電、光暈、
      冰雪、旋風、愛心、星光
   保留原有拍照、去背、GAS、AI 語音與多角色功能
========================================================== */

(function () {
  "use strict";

  const TWO_PI = Math.PI * 2;

  const clampValue = (v, min, max) =>
    Math.max(min, Math.min(max, v));

  const rand = (n) => {
    const x = Math.sin(n * 127.1 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  /* ===== 1. 工具籃清晰化 ===== */

  function installBasketFix() {
    if (document.getElementById("mindspaceUpgradeCSS")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "mindspaceUpgradeCSS";

    style.textContent = `
      #toolBasketOverlay {
        background: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        box-shadow: none !important;
      }

      body.mindspace-basket-open #toolBasketOverlay {
        background: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      #sidebar {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: rgba(255, 250, 255, 0.98) !important;
      }

      body.mindspace-basket-open #world,
      body.mindspace-basket-open #actors,
      body.mindspace-basket-open canvas {
        filter: none !important;
        -webkit-filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      .mindspace-hero > span {
        direction: ltr;
        unicode-bidi: isolate;
        transform-origin: center center;
        color: #284b69;
        border: 1px solid rgba(255,255,255,.9);
        box-shadow: 0 3px 10px rgba(26,62,92,.12);
        z-index: 30;
      }
    `;

    document.head.appendChild(style);
  }

  /* ===== 2. 角色名稱防鏡像 ===== */

  function fixHeroNames() {
    if (typeof state === "undefined" || !state.heroes) {
      return;
    }

    for (const hero of state.heroes) {
      if (!hero.element || !hero.nameElement) {
        continue;
      }

      const matrix = getComputedStyle(hero.element).transform;

      let direction = 1;

      if (matrix && matrix !== "none") {
        try {
          const m = new DOMMatrixReadOnly(matrix);
          direction = m.a < 0 ? -1 : 1;
        } catch (error) {
          direction = hero.face || 1;
        }
      }

      // 父層鏡像一次，名字再鏡像一次，抵消反轉。
      hero.nameElement.style.transform =
        "translateX(-50%) scaleX(" + direction + ")";

      hero.nameElement.textContent = hero.name || "";
    }
  }

  /* ===== 3. 技能語意辨識 ===== */

  function skillKind(skill) {
    const source = [
      skill?.name,
      skill?.type,
      skill?.description
    ].filter(Boolean).join(" ").toLowerCase();

    if (/laser|雷射|激光|光束|射線/.test(source)) {
      return "laser";
    }

    if (/bubble|泡泡|氣泡|吐泡/.test(source)) {
      return "bubble";
    }

    if (/fire|flame|火焰|噴火|火球/.test(source)) {
      return "fire";
    }

    if (/lightning|electric|thunder|閃電|雷電|電擊/.test(source)) {
      return "lightning";
    }

    if (/ice|snow|freeze|冰|雪|冷凍/.test(source)) {
      return "ice";
    }

    if (/wind|tornado|旋風|龍捲風|風暴/.test(source)) {
      return "wind";
    }

    if (/heart|love|愛心|愛之|喜歡/.test(source)) {
      return "heart";
    }

    if (/star|sparkle|星星|星光|閃耀/.test(source)) {
      return "star";
    }

    return "glow";
  }

  function currentSkill(hero) {
    const list = [
      ...(Array.isArray(hero.skills) ? hero.skills : []),
      ...(Array.isArray(hero.aiSkills) ? hero.aiSkills : [])
    ];

    return list[list.length - 1] || {
      name: "神奇光芒",
      type: "glow"
    };
  }

  function rgba(hex, alpha) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || "")) {
      return `rgba(255,170,215,${alpha})`;
    }

    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ===== 共用繪圖 ===== */

  function circleGlow(p, x, y, radius, color) {
    p.push();
    p.noStroke();

    for (let i = 5; i >= 1; i--) {
      p.fill(rgba(color, 0.055));
      p.circle(x, y, radius * (1 + i * 0.32));
    }

    p.fill(rgba(color, 0.3));
    p.circle(x, y, radius);

    p.pop();
  }

  function sparkle(p, x, y, size, color) {
    p.push();
    p.translate(x, y);
    p.stroke(color);
    p.strokeWeight(Math.max(1, size * 0.13));
    p.strokeCap(p.ROUND);

    p.line(-size, 0, size, 0);
    p.line(0, -size, 0, size);
    p.line(-size * .35, -size * .35,
            size * .35, size * .35);
    p.line(-size * .35, size * .35,
            size * .35, -size * .35);

    p.pop();
  }

  function bubble(p, x, y, size, alpha = 200) {
    p.push();

    p.stroke(170, 235, 255, alpha);
    p.strokeWeight(1.7);
    p.fill(205, 245, 255, alpha * .14);
    p.circle(x, y, size);

    p.noStroke();
    p.fill(255, 255, 255, alpha * .9);
    p.ellipse(
      x - size * .18,
      y - size * .22,
      size * .24,
      size * .13
    );

    p.pop();
  }

  /* ===== 雷射：蓄光、核心、光暈、光點 ===== */

  function drawLaser(p, x, y, face, elapsed, color) {
    const direction = face >= 0 ? 1 : -1;

    const startX = x + direction * 30;
    const startY = y - 12;

    const length = 220;
    const endX = startX + direction * length;

    const pulse = .75 + Math.sin(elapsed * 18) * .2;

    circleGlow(p, startX, startY, 18 * pulse, color);

    p.push();
    p.strokeCap(p.ROUND);

    p.stroke(rgba(color, .15));
    p.strokeWeight(28 * pulse);
    p.line(startX, startY, endX, startY);

    p.stroke(rgba(color, .5));
    p.strokeWeight(13 * pulse);
    p.line(startX, startY, endX, startY);

    p.stroke(255, 250, 255, 245);
    p.strokeWeight(4);
    p.line(startX, startY, endX, startY);

    for (let i = 0; i < 12; i++) {
      const progress = (
        elapsed * 1.9 + i / 12
      ) % 1;

      const px = startX + direction * length * progress;
      const py = startY +
        Math.sin(progress * 16 + i) * 7;

      sparkle(
        p, px, py,
        3 + rand(i + 3) * 5,
        "#ffffff"
      );
    }

    circleGlow(p, endX, startY, 15, color);
    sparkle(p, endX, startY, 15, "#ffffff");

    p.pop();
  }

  /* ===== 泡泡：由角色前方上浮 ===== */

  function drawBubbles(p, x, y, face, elapsed) {
    const direction = face >= 0 ? 1 : -1;

    for (let i = 0; i < 26; i++) {
      const seed = rand(i + 17);
      const age = (elapsed * .48 + seed) % 1;

      const bx =
        x + direction * (30 + age * 135) +
        Math.sin(age * 13 + i) * 17;

      const by =
        y - 3 - age * 160 +
        Math.cos(i * 2.1) * 12;

      const size = 7 + rand(i * 4 + 1) * 21;

      bubble(p, bx, by, size, 210 * (1 - age));
    }
  }

  /* ===== 火焰：連續火舌與火星 ===== */

  function drawFire(p, x, y, face, elapsed) {
    const direction = face >= 0 ? 1 : -1;

    p.push();
    p.noStroke();

    for (let i = 0; i < 38; i++) {
      const seed = rand(i + 53);
      const age = (elapsed * .95 + seed) % 1;

      const px =
        x + direction * (32 + age * 170);

      const py =
        y + Math.sin(i * 4.3 + elapsed * 8) *
        (7 + age * 25);

      const size = (1 - age) *
        (17 + rand(i * 7) * 23);

      const c = age < .32
        ? [255, 247, 160]
        : age < .7
          ? [255, 154, 47]
          : [255, 72, 65];

      p.fill(c[0], c[1], c[2], 225 * (1 - age));
      p.circle(px, py, Math.max(2, size));
    }

    for (let i = 0; i < 12; i++) {
      const age = (elapsed * .8 + rand(i * 11)) % 1;

      sparkle(
        p,
        x + direction * (50 + age * 160),
        y - age * 65 + Math.sin(i * 3) * 18,
        2 + (1 - age) * 4,
        "#ffe59d"
      );
    }

    p.pop();
  }

  /* ===== 閃電：不規則分支電流 ===== */

  function drawLightning(p, x, y, face, elapsed) {
    const direction = face >= 0 ? 1 : -1;
    const frame = Math.floor(elapsed * 13);

    p.push();
    p.noFill();

    for (let branch = 0; branch < 3; branch++) {
      const points = [];

      for (let i = 0; i <= 11; i++) {
        const progress = i / 11;

        points.push({
          x: x + direction * (30 + progress * 200),
          y: y + (branch - 1) * progress * 55 +
            (rand(frame * 37 + i * 9 + branch * 5) - .5) * 31
        });
      }

      for (const [weight, color] of [
        [12, "rgba(100,190,255,.22)"],
        [5, "rgba(100,210,255,.85)"],
        [2, "#ffffff"]
      ]) {
        p.stroke(color);
        p.strokeWeight(weight);
        p.beginShape();

        for (const point of points) {
          p.vertex(point.x, point.y);
        }

        p.endShape();
      }
    }

    circleGlow(p, x + direction * 32, y, 24, "#87caff");
    p.pop();
  }

  /* ===== 冰雪 ===== */

  function drawIce(p, x, y, elapsed) {
    p.push();

    for (let i = 0; i < 25; i++) {
      const age = (elapsed * .3 + rand(i * 7)) % 1;
      const angle = i * 2.399 + elapsed * .4;
      const radius = 24 + age * 130;

      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      sparkle(
        p, px, py,
        4 + (1 - age) * 7,
        "#c4f7ff"
      );
    }

    circleGlow(p, x, y, 45, "#9beaff");
    p.pop();
  }

  /* ===== 旋風 ===== */

  function drawWind(p, x, y, elapsed) {
    p.push();
    p.noFill();

    for (let j = 0; j < 5; j++) {
      p.stroke(
        185, 248, 241,
        170 - j * 20
      );

      p.strokeWeight(4 - j * .45);
      p.beginShape();

      for (let i = 0; i <= 38; i++) {
        const a = i / 38 * TWO_PI * 2.5 +
          elapsed * 3 + j;

        const r = 15 + i * 2.6;

        p.vertex(
          x + Math.cos(a) * r,
          y + Math.sin(a) * r * .65
        );
      }

      p.endShape();
    }

    p.pop();
  }

  /* ===== 愛心 ===== */

  function drawHearts(p, x, y, elapsed) {
    p.push();

    for (let i = 0; i < 18; i++) {
      const age = (elapsed * .36 + rand(i * 6)) % 1;

      const px =
        x + Math.sin(i * 3.7 + elapsed) * 65;

      const py = y + 45 - age * 160;
      const size = 7 + rand(i * 5) * 12;

      p.push();
      p.translate(px, py);
      p.scale(size / 16);
      p.noStroke();
      p.fill(255, 119, 171, 220 * (1 - age));

      p.beginShape();
      p.vertex(0, 6);
      p.bezierVertex(-18, -5, -10, -16, 0, -7);
      p.bezierVertex(10, -16, 18, -5, 0, 6);
      p.endShape(p.CLOSE);

      p.pop();
    }

    p.pop();
  }

  /* ===== 星光與通用光暈 ===== */

  function drawMagic(p, x, y, elapsed, color, stars) {
    p.push();

    circleGlow(p, x, y, 30, color);

    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399 + elapsed * 1.8;
      const radius =
        55 + Math.sin(elapsed * 4 + i) * 20;

      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      if (stars) {
        sparkle(
          p, px, py,
          3 + rand(i) * 7,
          color
        );
      } else {
        p.noStroke();
        p.fill(rgba(color, .8));
        p.circle(px, py, 4 + rand(i) * 5);
      }
    }

    p.pop();
  }

  /* ===== 4. 安裝新版技能引擎 ===== */

  function upgradedSkillRenderer(p, hero, time) {
    const now = performance.now();

    if (!hero.skillUntil || hero.skillUntil <= now) {
      return;
    }

    const skill = currentSkill(hero);
    const kind = skillKind(skill);

    const x = hero.x * p.width;
    const y = hero.y * p.height;

    const face = hero.face || 1;
    const elapsed = now / 1000;
    const color = skill.color || "#ff78c7";

    p.push();

    switch (kind) {
      case "laser":
        drawLaser(p, x, y, face, elapsed, color);
        break;

      case "bubble":
        drawBubbles(p, x, y, face, elapsed);
        break;

      case "fire":
        drawFire(p, x, y, face, elapsed);
        break;

      case "lightning":
        drawLightning(p, x, y, face, elapsed);
        break;

      case "ice":
        drawIce(p, x, y, elapsed);
        break;

      case "wind":
        drawWind(p, x, y, elapsed);
        break;

      case "heart":
        drawHearts(p, x, y, elapsed);
        break;

      case "star":
        drawMagic(p, x, y, elapsed, "#ffe28b", true);
        break;

      default:
        drawMagic(p, x, y, elapsed, color, false);
    }

    p.pop();
  }

  /* ===== 5. 角色動畫結束後同步名稱 ===== */

  function installAnimationFix() {
    if (typeof animateHeroes !== "function") {
      console.warn("Mindspace：尚未載入 sketch.js");
      return false;
    }

    if (window.__mindspaceAnimationUpgraded) {
      return true;
    }

    const originalAnimate = animateHeroes;

    animateHeroes = function (p, t) {
      originalAnimate(p, t);
      fixHeroNames();
    };

    window.__mindspaceAnimationUpgraded = true;
    return true;
  }

  function installSkillFix() {
    if (typeof drawHeroSkill !== "function") {
      return false;
    }

    drawHeroSkill = upgradedSkillRenderer;
    return true;
  }

  /* ===== 6. 啟動 ===== */

  function initialize() {
    installBasketFix();

    const animationReady = installAnimationFix();
    const skillReady = installSkillFix();

    if (!animationReady || !skillReady) {
      console.warn(
        "Mindspace 升級模組：請確認載入順序，" +
        "必須先載入 sketch.js，再載入本檔案。"
      );
    } else {
      console.log(
        "Mindspace 升級成功：" +
        "工具籃清晰、名字正向、技能特效升級"
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }

})();
