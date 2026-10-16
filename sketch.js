
"use strict";

/* Mindspace V2 — GitHub Pages */
const GAS_URL = "https://script.google.com/macros/s/AKfycbwUooMD69_NMBhTzxf0Os_D6BEGb3QsGyhXpTGv09emRcG_4du219K4qO_FggY1vnLHOg/exec";

const $ = id => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

const state = {
  heroes: [], selectedId: null, world: "ocean",
  history: [], scenes: [], voiceEnabled: true,
  bridgeReady: false, bridgeWindow: null, bridgeOrigin: "",
  bridgeToken: uid() + uid(), pending: new Map(),
  cameraStream: null, cameraFacing: "environment",
  cameraRequestId: 0, recorder: null, audioStream: null,
  audioChunks: [], recording: false, busy: false,
  editorOriginal: null, editorHeroId: null,
  editorHistory: [], editorMode: "erase",
  editorPainting: false, editorLastPoint: null,
  audio: null, speechSerial: 0
};

function status(s) {
  $("status").textContent = s;
  console.log("[Mindspace]", s);
}
function bubble(s) { $("speechBubble").textContent = s; }
function modal(id, show) { $(id).classList.toggle("hidden", !show); }
function heroNow() { return state.heroes.find(h => h.id === state.selectedId) || null; }
function click(id, fn) {
  $(id).addEventListener("click", () => {
    try {
      const p = fn();
      if (p?.catch) p.catch(e => status("❌ " + e.message));
    } catch (e) { status("❌ " + e.message); }
  });
}
function imageLoad(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(Error("圖片載入失敗"));
    im.src = src;
  });
}
function fileData(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("無法讀取檔案"));
    r.readAsDataURL(file);
  });
}
async function scaledData(src, max = 650, format = "image/png") {
  const im = await imageLoad(src);
  const k = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.width * k));
  c.height = Math.max(1, Math.round(im.height * k));
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL(format, format === "image/jpeg" ? .86 : undefined);
}


/* ===== GAS BRIDGE｜跨網域修正版 ===== */

function googleOrigin(origin) {
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();

    return u.protocol === "https:" &&
      (
        h === "script.google.com" ||
        h === "script.googleusercontent.com" ||
        h.endsWith(".googleusercontent.com")
      );
  } catch {
    return false;
  }
}

function initializeBridge() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(GAS_URL)) {
    status("❌ GAS_URL 不是有效的 /exec 網址");
    return;
  }

  const frame = $("bridgeFrame");

  if (!frame) {
    status("❌ 找不到 bridgeFrame iframe");
    return;
  }

  // 防止重複初始化。
  if (state.bridgeInitialized) return;
  state.bridgeInitialized = true;

  state.bridgeReady = false;
  state.bridgeWindow = null;
  state.bridgeOrigin = "";

  window.addEventListener("message", event => {
    const m = event.data;

    // 必須同時驗證 Google 來源、應用名稱及隨機 token。
    if (!googleOrigin(event.origin)) return;
    if (!m || typeof m !== "object") return;
    if (m.app !== "mindspace-v2") return;
    if (m.token !== state.bridgeToken) return;

    if (m.kind === "ready") {
      if (!event.source) return;

      state.bridgeWindow = event.source;
      state.bridgeOrigin = event.origin;
      state.bridgeReady = true;

      console.log(
        "[Mindspace] 收到 GAS ready，來源：",
        event.origin
      );

      status("✅ GAS 橋接器已連線，可以測試 AI");

      // 回覆握手確認。
      // 只傳送給剛剛通過驗證的 GAS 視窗。
      try {
        event.source.postMessage({
          app: "mindspace-v2",
          kind: "ack",
          token: state.bridgeToken
        }, "*");
      } catch (error) {
        console.warn("[Mindspace] ACK 傳送失敗：", error);
      }

      return;
    }

    if (m.kind === "response") {
      const p = state.pending.get(m.id);
      if (!p) return;

      // 只接受已確認的 GAS 視窗所送出的回應。
      if (event.source !== state.bridgeWindow) return;

      clearTimeout(p.timer);
      state.pending.delete(m.id);

      if (m.ok) {
        p.resolve(m.result);
      } else {
        p.reject(
          new Error(m.error || "GAS AI 後端執行失敗")
        );
      }
    }
  });

  const url = new URL(GAS_URL);

  url.searchParams.set(
    "bridgeToken",
    state.bridgeToken
  );

  url.searchParams.set(
    "parentOrigin",
    window.location.origin
  );

  console.log(
    "[Mindspace] 正在載入 GAS：",
    url.origin + url.pathname
  );

  frame.src = url.toString();

  frame.addEventListener("error", () => {
    status("❌ GAS iframe 載入發生錯誤");
  });

  setTimeout(() => {
    if (!state.bridgeReady) {
      status(
        "⚠️ 尚未收到 GAS ready 訊息。" +
        "請檢查 Bridge.html 與部署版本。"
      );
    }
  }, 15000);
}

function callAI(type, data = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    if (!state.bridgeReady || !state.bridgeWindow) {
      reject(new Error(
        "GAS 橋接器尚未連線，請等待連線成功"
      ));
      return;
    }

    const id = uid();

    const timer = setTimeout(() => {
      state.pending.delete(id);

      reject(new Error(
        "AI 回應逾時：" + type
      ));
    }, timeout);

    state.pending.set(id, {
      resolve,
      reject,
      timer
    });

    try {
      const message = {
        app: "mindspace-v2",
        kind: "request",
        token: state.bridgeToken,
        id,
        type,
        data
      };

      // 關鍵修正：
      // GAS 的 WindowProxy 可能因為重新導向，
      // 使記錄的 origin 與目前視窗 origin 不一致。
      //
      // 此處只對已通過來源與 token 驗證的
      // bridgeWindow 使用 "*"。
      // 不是向所有視窗廣播。
      state.bridgeWindow.postMessage(message, "*");

      console.log(
        "[Mindspace] 已送出 AI 請求：",
        type,
        id
      );

    } catch (error) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(error);
    }
  });
}


/* ===== AI 自然語音 ===== */
function stopSpeech() {
  state.speechSerial++;
  if (state.audio) {
    state.audio.pause();
    state.audio.src = "";
    state.audio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
function browserSpeech(text) {
  if (!state.voiceEnabled || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW"; u.rate = .96; u.pitch = 1.08;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => v.lang === "zh-TW") ||
            voices.find(v => v.lang.startsWith("zh")) || null;
  speechSynthesis.speak(u);
}
async function speak(text) {
  if (!state.voiceEnabled || !text) return;
  stopSpeech();
  const serial = state.speechSerial;
  if (!state.bridgeReady) {
    browserSpeech(text);
    return;
  }
  try {
    const r = await callAI("speakNatural", { text: text.slice(0, 550) });
    if (serial !== state.speechSerial || !state.voiceEnabled) return;
    if (!r.audio) throw Error("沒有收到 AI 語音");
    const audio = new Audio("data:audio/mpeg;base64," + r.audio);
    state.audio = audio;
    await audio.play();
  } catch (e) {
    console.warn("AI 語音播放失敗：", e);
    if (serial === state.speechSerial) {
      status("⚠️ AI 自然語音未能播放：" + e.message);
      browserSpeech(text);
    }
  }
}
function chat(name, text, ai = false) {
  const d = document.createElement("div");
  d.style.cssText = "padding:9px;margin:6px 0;border-radius:12px;background:" +
    (ai ? "#ffe4ef" : "#e4f1ff");
  d.textContent = name + "：" + text;
  $("chatLog").appendChild(d);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}
function welcomeHero(hero) {
  const text = "哇！我誕生了！我是" + hero.name +
    "！你想讓我做什麼？我們一起來玩吧！";
  chat("🐠 " + hero.name, text, true);
  bubble("🐠 " + hero.name + "：" + text);
  speak(text); // 不等待 AI 故事生成，立即啟動語音請求
}

/* ===== 攝影機 ===== */
function stopCamera() {
  state.cameraStream?.getTracks().forEach(t => t.stop());
  state.cameraStream = null;
  $("cameraVideo").pause();
  $("cameraVideo").srcObject = null;
  $("captureButton").disabled = true;
}
function closeCamera() {
  state.cameraRequestId++;
  stopCamera();
  modal("cameraModal", false);
}
async function openCamera() {
  const id = ++state.cameraRequestId;
  stopCamera();
  modal("cameraModal", true);
  $("cameraMessage").textContent = "正在開啟攝影機……";
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("需要 HTTPS 與攝影機權限");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: state.cameraFacing },
               width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    if (id !== state.cameraRequestId) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    state.cameraStream = stream;
    $("cameraVideo").srcObject = stream;
    await $("cameraVideo").play();
    $("captureButton").disabled = false;
    $("cameraMessage").textContent = "📸 攝影機已啟動，可以拍照！";
  } catch (e) {
    if (id === state.cameraRequestId) {
      stopCamera();
      $("cameraMessage").textContent = "⚠️ " + e.message;
      status("❌ 攝影機：" + e.message);
    }
  }
}
async function capturePhoto() {
  const v = $("cameraVideo");
  if (!v.videoWidth) throw Error("攝影機尚未準備完成");
  const k = Math.min(1, 1000 / v.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * k);
  c.height = Math.round(v.videoHeight * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  closeCamera();
  state.editorHeroId = null;
  await openEditor(c.toDataURL("image/png"));
}

/* ===== 去背編輯器 ===== */
async function openEditor(src) {
  const im = await imageLoad(src);
  const c = $("editCanvas");
  const k = Math.min(1, 1000 / Math.max(im.width, im.height));
  c.width = Math.round(im.width * k);
  c.height = Math.round(im.height * k);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0, c.width, c.height);
  state.editorOriginal = ctx.getImageData(0, 0, c.width, c.height);
  state.editorHistory = [];
  state.editorMode = "erase";
  modal("editorModal", true);
}
function editorHistory() {
  const c = $("editCanvas");
  const ctx = c.getContext("2d");
  state.editorHistory.push(ctx.getImageData(0, 0, c.width, c.height));
  if (state.editorHistory.length > 8) state.editorHistory.shift();
}
function undoEditor() {
  const im = state.editorHistory.pop();
  if (im) $("editCanvas").getContext("2d").putImageData(im, 0, 0);
}
function resetEditor() {
  if (!state.editorOriginal) return;
  editorHistory();
  $("editCanvas").getContext("2d").putImageData(state.editorOriginal, 0, 0);
}
function quickRemoveBg() {
  const c = $("editCanvas"), w = c.width, h = c.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  const bg = [0, 0, 0];
  for (const [x, y] of [[0,0],[w-1,0],[0,h-1],[w-1,h-1]]) {
    const i = (y*w+x)*4;
    for (let j=0;j<3;j++) bg[j] += d[i+j]/4;
  }
  const seen = new Uint8Array(w*h), q = new Int32Array(w*h);
  let head=0, tail=0;
  const enqueue = (x,y) => {
    if(x<0||y<0||x>=w||y>=h) return;
    const k=y*w+x, i=k*4;
    if(seen[k]) return;
    const diff=(d[i]-bg[0])**2+(d[i+1]-bg[1])**2+(d[i+2]-bg[2])**2;
    if(diff>4900) return;
    seen[k]=1; q[tail++]=k;
  };
  editorHistory();
  for(let x=0;x<w;x++){enqueue(x,0);enqueue(x,h-1);}
  for(let y=0;y<h;y++){enqueue(0,y);enqueue(w-1,y);}
  while(head<tail){
    const k=q[head++],x=k%w,y=Math.floor(k/w);
    d[k*4+3]=0;
    enqueue(x-1,y);enqueue(x+1,y);enqueue(x,y-1);enqueue(x,y+1);
  }
  ctx.putImageData(im,0,0);
  status("✨ 快速去背完成，可以用筆刷修整");
}
async function aiRemoveBg() {
  const b = $("removeBgAI");
  b.disabled = true;
  status("🤖 AI 正在辨識黏土與背景……");
  try {
    const c = $("editCanvas");
    const src = await scaledData(c.toDataURL("image/png"), 650);
    const result = await callAI("removeBackgroundAI", { image: src }, 180000);
    if (!result.image) throw Error("AI 沒有回傳圖片");
    const im = await imageLoad(result.image);
    editorHistory();
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    status("✅ AI 去背完成，請檢查邊緣並視需要手動修整");
  } finally { b.disabled = false; }
}
function editorPoint(e) {
  const c=$("editCanvas"),r=c.getBoundingClientRect();
  return { x:(e.clientX-r.left)*c.width/r.width,
           y:(e.clientY-r.top)*c.height/r.height };
}
function paintEditor(e) {
  if(!state.editorPainting) return;
  e.preventDefault();
  const c=$("editCanvas"),ctx=c.getContext("2d",{willReadFrequently:true});
  const im=ctx.getImageData(0,0,c.width,c.height);
  const d=im.data, orig=state.editorOriginal.data;
  const p=editorPoint(e), old=state.editorLastPoint||p;
  const radius=Number($("brushSize").value)/2;
  const steps=Math.max(1,Math.ceil(Math.hypot(p.x-old.x,p.y-old.y)/Math.max(1,radius/2)));
  for(let s=0;s<=steps;s++){
    const x=old.x+(p.x-old.x)*s/steps;
    const y=old.y+(p.y-old.y)*s/steps;
    for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(c.height-1,Math.ceil(y+radius));yy++){
      for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(c.width-1,Math.ceil(x+radius));xx++){
        if((xx-x)**2+(yy-y)**2>radius**2)continue;
        const i=(yy*c.width+xx)*4;
        if(state.editorMode==="erase")d[i+3]=0;
        else for(let j=0;j<4;j++)d[i+j]=orig[i+j];
      }
    }
  }
  ctx.putImageData(im,0,0);
  state.editorLastPoint=p;
}
function cropEditor() {
  const c=$("editCanvas"),w=c.width,h=c.height;
  const d=c.getContext("2d").getImageData(0,0,w,h).data;
  let left=w,top=h,right=-1,bottom=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(d[(y*w+x)*4+3]>10){
      left=Math.min(left,x);right=Math.max(right,x);
      top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
  }
  if(right<left)throw Error("圖片已全部透明");
  left=Math.max(0,left-5);top=Math.max(0,top-5);
  right=Math.min(w-1,right+5);bottom=Math.min(h-1,bottom+5);
  const out=document.createElement("canvas");
  out.width=right-left+1;out.height=bottom-top+1;
  out.getContext("2d").drawImage(c,left,top,out.width,out.height,0,0,out.width,out.height);
  return out.toDataURL("image/png");
}

/* ===== 主角 ===== */
function createHeroElement(h) {
  const e=document.createElement("div");
  e.style.cssText="position:absolute;width:145px;height:145px;transform-origin:center";
  const original=document.createElement("img");
  original.src=h.original;
  original.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 5px 6px #236e8344)";
  const transformed=document.createElement("img");
  transformed.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none";
  const name=document.createElement("span");
  name.textContent=h.name;
  name.style.cssText="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#ffffffdd;border-radius:10px;padding:4px 8px;font-size:12px";
  e.append(original,transformed,name);
  $("actors").appendChild(e);
  h.element=e;h.originalElement=original;
  h.transformedElement=transformed;h.nameElement=name;
}
function refreshHeroes() {
  const list=$("heroList"),select=$("selectedHero");
  list.replaceChildren();select.replaceChildren();
  for(const h of state.heroes){
    const row=document.createElement("div");
    row.style.cssText="display:flex;align-items:center;gap:8px;padding:6px;margin-bottom:5px;border-radius:12px;background:"+
      (h.id===state.selectedId?"#e6d7ff":"#f4efff");
    const img=document.createElement("img");
    img.src=h.original;img.style.cssText="width:44px;height:44px;object-fit:contain";
    const b=document.createElement("button");
    b.textContent=h.name;b.style.flex="1";
    b.onclick=()=>{state.selectedId=h.id;refreshHeroes();};
    const rename=document.createElement("button");
    rename.textContent="✏️";
    rename.onclick=()=>{
      const n=prompt("幫黏土朋友取名字",h.name);
      if(n?.trim()){h.name=n.trim().slice(0,30);h.nameElement.textContent=h.name;refreshHeroes();}
    };
    row.append(img,b,rename);list.append(row);
    const opt=document.createElement("option");
    opt.value=h.id;opt.textContent=h.name;select.append(opt);
  }
  if(!state.heroes.length)list.textContent="🌱 還沒有黏土主角";
  select.value=state.selectedId||"";
  const h=heroNow();
  $("appearance").textContent=h?.appearance ?
    "🔍 "+h.appearance+"｜💭 "+h.personality : "";
}
function saveHero() {
  const src=cropEditor();
  const first=state.heroes.length===0;
  let h=state.heroes.find(x=>x.id===state.editorHeroId);
  if(h){
    h.original=src;h.transformed=null;
    h.originalElement.src=src;
    h.originalElement.style.display="block";
    h.transformedElement.style.display="none";
  } else {
    h={
      id:uid(),name:"黏土朋友"+(state.heroes.length+1),
      original:src,transformed:null,appearance:"",personality:"",
      skills:[],x:.25+(state.heroes.length%3)*.2,
      y:.4+(state.heroes.length%2)*.15,
      vx:.00045,face:1,phase:Math.random()*Math.PI*2,
      action:null,skillUntil:0
    };
    createHeroElement(h);state.heroes.push(h);
  }
  state.selectedId=h.id;state.editorHeroId=null;
  modal("editorModal",false);refreshHeroes();
  status("🌈 "+h.name+" 已誕生！");
  if(first)welcomeHero(h);
}
function removeHero() {
  const h=heroNow();
  if(!h)return status("請先選擇主角");
  if(!confirm("要移除 "+h.name+" 嗎？"))return;
  h.element.remove();
  state.heroes=state.heroes.filter(x=>x.id!==h.id);
  state.selectedId=state.heroes[0]?.id||null;
  refreshHeroes();
}
async function inspectHero() {
  const h=heroNow();
  if(!h)throw Error("請先創造主角");
  status("🧠 AI 正在觀察黏土……");
  const r=await callAI("inspect",{image:await scaledData(h.original,512)});
  h.appearance=r.appearance||"";
  h.personality=r.personality||"";
  refreshHeroes();status("✅ AI 已認識黏土主角");
}
async function transformHero(h,description) {
  if(!h)throw Error("請先選擇主角");
  if(!description?.trim())throw Error("請描述想增加的造型");
  status("🎨 AI 正在製作黏土造型……");
  const r=await callAI("transform",{
    image:await scaledData(h.original,650),
    description:description.slice(0,450)
  },180000);
  if(!r.image)throw Error("沒有收到 AI 造型");
  h.transformed=r.image;
  h.transformedElement.src=r.image;
  h.transformedElement.style.display="block";
  h.originalElement.style.display="none";
  status("✨ AI 黏土變身完成");
}
function showOriginal() {
  const h=heroNow();if(!h)return;
  h.originalElement.style.display="block";
  h.transformedElement.style.display="none";
}
function showTransform() {
  const h=heroNow();
  if(!h?.transformed)return status("目前還沒有 AI 造型");
  h.originalElement.style.display="none";
  h.transformedElement.style.display="block";
}

/* ===== 麥克風與語音辨識 ===== */
function blobBase64(blob) {
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(",")[1]);
    r.onerror=()=>reject(Error("錄音讀取失敗"));
    r.readAsDataURL(blob);
  });
}
async function wav16k(blob) {
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C)throw Error("瀏覽器不支援音訊解碼");
  const ac=new C();
  try{
    const decoded=await ac.decodeAudioData(await blob.arrayBuffer());
    const rate=16000,length=Math.floor(decoded.duration*rate);
    const buf=new ArrayBuffer(44+length*2),v=new DataView(buf);
    const str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
    str(0,"RIFF");v.setUint32(4,36+length*2,true);
    str(8,"WAVE");str(12,"fmt ");v.setUint32(16,16,true);
    v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);
    v.setUint16(32,2,true);v.setUint16(34,16,true);
    str(36,"data");v.setUint32(40,length*2,true);
    const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i));
    for(let i=0;i<length;i++){
      const pos=i*decoded.sampleRate/rate,a=Math.floor(pos),b=Math.min(a+1,decoded.length-1),f=pos-a;
      let s=0;
      for(const ch of channels)s+=ch[a]*(1-f)+ch[b]*f;
      s=clamp(s/channels.length,-1,1);
      v.setInt16(44+i*2,s<0?s*32768:s*32767,true);
    }
    return new Blob([buf],{type:"audio/wav"});
  } finally {await ac.close();}
}
async function toggleRecording() {
  if(state.recording){
    if(state.recorder?.state==="recording")state.recorder.stop();
    return;
  }
  if(!state.bridgeReady)throw Error("請先完成 AI 連線");
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw Error("目前瀏覽器不支援麥克風錄音");
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const formats=["audio/mp4","audio/webm;codecs=opus","audio/webm"];
  const type=formats.find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(stream,type?{mimeType:type}:{});
  state.audioStream=stream;state.recorder=rec;
  state.audioChunks=[];state.recording=true;
  rec.ondataavailable=e=>{if(e.data.size)state.audioChunks.push(e.data);};
  rec.onstop=finishRecording;
  rec.start();
  $("micButton").textContent="⏹️ 結束說話";
  status("🎤 正在聆聽孩子說話……");
}
async function finishRecording() {
  state.recording=false;
  $("micButton").textContent="🎙️ 開始說話";
  state.audioStream?.getTracks().forEach(t=>t.stop());
  state.audioStream=null;
  try{
    const blob=new Blob(state.audioChunks,{
      type:state.recorder?.mimeType||"audio/webm"
    });
    if(!blob.size)throw Error("沒有收到錄音");
    status("🧠 AI 正在辨識語音……");
    const wav=await wav16k(blob);
    const audio=await blobBase64(wav);
    if(audio.length>7000000)throw Error("錄音太長，請縮短至約 15 秒");
    const r=await callAI("transcribe",{audio});
    $("chatInput").value=r.text||"";
    if(r.text?.trim())await sendStory();
    else status("沒有辨識到語音內容");
  }catch(e){status("❌ 語音辨識："+e.message);}
  finally{state.recorder=null;state.audioChunks=[];}
}

/* ===== AI 故事、角色動作與技能 ===== */
const ACTION_TYPES=new Set([
  "swim","stop","hide","dance","spin","jump","bounce",
  "fly","shake","follow","meet","circle","laser"
]);
function performAction(a) {
  const h=state.heroes.find(x=>x.id===a.heroId);
  if(!h)return;
  const type=ACTION_TYPES.has(a.type)?a.type:"swim";
  h.action={
    type,targetId:a.targetId||"",
    until:performance.now()+clamp(Number(a.duration)||6,1,20)*1000
  };
  if(type==="laser"){
    h.skills.push({name:"雷射光",type:"laser",color:"#ff66cc"});
    h.skillUntil=performance.now()+4000;
  }
}
function addScene(s) {
  state.scenes.push({
    type:s.type||"sparkle",description:s.description||"",
    start:performance.now(),
    duration:clamp(Number(s.duration)||7,2,20)*1000
  });
}
async function sendStory() {
  if(state.busy)return;
  const h=heroNow(),message=$("chatInput").value.trim();
  if(!h)return status("請先創造黏土主角");
  if(!message)return;
  state.busy=true;$("sendButton").disabled=true;
  $("chatInput").value="";
  chat("🧒 孩子",message);
  status("🤖 AI 正在理解故事……");
  try{
    const r=await callAI("story",{
      message,selectedHeroId:h.id,
      heroes:state.heroes.map(x=>({
        id:x.id,name:x.name,appearance:x.appearance,
        personality:x.personality,
        skills:x.skills.map(s=>s.name)
      })),
      history:state.history.slice(-12),
      activeScenes:state.scenes.map(s=>s.type)
    });
    const speaker=state.heroes.find(x=>x.id===r.speakerId)||h;
    const reply=r.reply||"哇！我們一起試試看吧！";
    chat("🐠 "+speaker.name,reply,true);
    bubble("🐠 "+speaker.name+"："+reply);
    speak(reply);
    state.history.push(
      {role:"user",content:message},
      {role:"assistant",content:reply}
    );
    if(state.history.length>24)state.history.splice(0,state.history.length-24);

    for(const a of r.actions||[])performAction(a);
    for(const s of r.scenes||[])addScene(s);
    for(const skill of r.skills||[]){
      const target=state.heroes.find(x=>x.id===skill.heroId);
      if(!target)continue;
      target.skills.push({
        name:skill.name||"神奇技能",
        type:skill.type||"glow",
        color:skill.color||"#ff66cc"
      });
      target.skillUntil=performance.now()+4500;
    }
    for(const t of r.transforms||[]){
      const target=state.heroes.find(x=>x.id===t.heroId);
      if(!target)continue;
      try{await transformHero(target,t.description);}
      catch(e){status("⚠️ AI 變身失敗："+e.message);}
    }
    status("🌈 故事已更新");
  }catch(e){
    status("❌ "+e.message);
    chat("⚠️ 系統",e.message,true);
  }finally{
    state.busy=false;$("sendButton").disabled=false;
  }
}

/* ===== p5.js 場景 ===== */
function drawEnvironment(p,t) {
  p.push();p.noStroke();
  if(state.world==="ocean"){
    for(let i=0;i<30;i++){
      const x=(i*137+Math.sin(t+i)*18)%p.width;
      const y=(p.height-(t*22+i*89)%p.height+p.height)%p.height;
      p.fill(255,255,255,55);p.circle(x,y,8+(i%5)*4);
    }
    p.fill("#78c6b5");
    for(let i=0;i<14;i++){
      const x=i*p.width/13;
      p.ellipse(x,p.height+10,26,75+Math.sin(t+i)*17);
    }
  }else if(state.world==="forest"){
    p.fill("#85c77c");p.rect(0,p.height*.8,p.width,p.height*.2);
    for(let i=0;i<8;i++){
      const x=(i+.5)*p.width/8;
      p.fill("#96725d");p.rect(x-6,p.height*.56,12,p.height*.25);
      p.fill("#7bc488");p.circle(x,p.height*.53,80);
    }
  }else{
    p.fill("#fff6b0");
    for(let i=0;i<80;i++)p.circle(i*131%p.width,i*97%p.height,2+i%3);
  }
  p.pop();
}
function drawHeroSkill(p,h,t) {
  const s=h.skills.at(-1);
  if(!s)return;
  const x=h.x*p.width,y=h.y*p.height,color=s.color||"#ff66cc";
  p.push();
  if(["laser","lightning","rainbow"].includes(s.type)){
    p.stroke("white");p.strokeWeight(11);
    p.line(x,y-16,x+h.face*240,y-16);
    p.stroke(color);p.strokeWeight(5);
    p.line(x,y-16,x+h.face*240,y-16);
  }else if(s.type==="glow"){
    p.noFill();p.stroke(color);p.strokeWeight(5);
    p.circle(x,y,150+Math.sin(t*6)*15);
  }else{
    p.noStroke();p.fill(color);
    for(let i=0;i<5;i++){
      const a=t*3+i*Math.PI*2/5;
      p.circle(x+Math.cos(a)*70,y+Math.sin(a)*70,12);
    }
  }
  p.pop();
}
function animateHeroes(p,t) {
  const now=performance.now();
  for(const h of state.heroes){
    const a=h.action?.until>now?h.action:null;
    const type=a?.type||"swim";
    const target=state.heroes.find(x=>x.id===a?.targetId);
    let dx=h.vx,dy=Math.sin(t*2+h.phase)*.00025,rotation=0,scale=1;
    if(type==="stop"||type==="hide"){dx=0;dy=0;}
    if(type==="dance"){rotation=Math.sin(t*6)*25;scale=1+Math.sin(t*6)*.08;}
    if(type==="spin")rotation=t*170%360;
    if(type==="jump"||type==="bounce")dy=-Math.abs(Math.sin(t*5))*.001;
    if(type==="fly")dy-=.0007;
    if(type==="shake")rotation=Math.sin(t*15)*12;
    if(target&&["follow","meet","circle"].includes(type)){
      const ox=type==="circle"?Math.cos(t*2)*.14:.1;
      const oy=type==="circle"?Math.sin(t*2)*.14:0;
      dx=(target.x+ox-h.x)*.018;
      dy=(target.y+oy-h.y)*.018;
    }
    h.x+=dx;h.y+=dy;
    if(h.x>.92){h.x=.92;h.vx=-Math.abs(h.vx);h.face=-1;}
    if(h.x<.08){h.x=.08;h.vx=Math.abs(h.vx);h.face=1;}
    h.y=clamp(h.y,.12,.87);
    h.element.style.left=h.x*100+"%";
    h.element.style.top=h.y*100+"%";
    h.element.style.transform=
      `translate(-50%,-50%) rotate(${rotation}deg) scale(${h.face*scale},${scale})`;
    h.element.style.opacity=type==="hide"?.3:1;
    if(h.skillUntil>now)drawHeroSkill(p,h,t);
  }
}
function drawEgg(p,x,y,progress,t) {
  p.push();p.translate(x,y);
  p.rotate(Math.sin(t*10)*(progress>.6?.12:.03));
  p.noStroke();p.fill("#fff1c4");p.ellipse(0,0,80,100);
  if(progress>.5){
    p.stroke("#c49471");p.strokeWeight(3);p.noFill();
    p.beginShape();
    [[-36,5],[-23,-8],[-8,7],[7,-8],[20,5],[36,-5]]
      .forEach(a=>p.vertex(...a));
    p.endShape();
  }
  if(progress>.8){
    p.noStroke();p.fill(255,238,149,160);
    p.circle(0,-10,90+Math.sin(t*10)*20);
  }
  p.pop();
}
function drawScenes(p,t) {
  const now=performance.now();
  for(let i=state.scenes.length-1;i>=0;i--){
    const s=state.scenes[i],progress=(now-s.start)/s.duration;
    const x=p.width*.5,y=p.height*.58;
    p.push();
    switch(s.type){
      case "egg":drawEgg(p,x,y,progress,t);break;
      case "rain":case "candyRain":
        for(let j=0;j<90;j++){
          const xx=(j*89+t*35)%p.width,yy=(j*127+t*200)%p.height;
          if(s.type==="rain"){
            p.stroke("#e5faff");p.strokeWeight(2);
            p.line(xx,yy,xx-5,yy+16);
          }else{
            p.noStroke();p.fill(["#ff98ba","#ffdf86","#b4a0ff","#a5e8cb"][j%4]);
            p.circle(xx,yy,12);
          }
        }break;
      case "rainbow":
        p.noFill();p.strokeWeight(10);
        ["#ff8b9e","#ffba75","#ffe98a","#9de1ac","#95c8ff","#c3a2f2"]
          .forEach((color,j)=>{
            p.stroke(color);
            p.arc(x,p.height*.9,p.width*.7-j*20,p.height*.9-j*20,Math.PI,Math.PI*2);
          });break;
      case "treasure":
        p.noStroke();p.fill("#a9784c");p.rect(x-45,y-20,90,55,7);
        p.fill("#ffe28c");p.rect(x-45,y-24,90,16,6);
        p.circle(x,y+10,15);break;
      case "night":
        p.noStroke();p.fill(18,26,70,100);p.rect(0,0,p.width,p.height);break;
      case "storm":
        p.stroke("#d5e5ff");p.strokeWeight(3);
        for(let j=0;j<70;j++){
          const xx=(j*101+t*60)%p.width,yy=(j*89+t*260)%p.height;
          p.line(xx,yy,xx-12,yy+23);
        }break;
      default:
        p.noStroke();p.fill("#fff2a2");
        for(let j=0;j<12;j++){
          const a=t*2+j*Math.PI/6;
          p.circle(x+Math.cos(a)*80,y+Math.sin(a)*80,8);
        }
    }
    p.pop();
    if(progress>1){
      state.scenes.splice(i,1);
      if(s.type==="egg")bubble("🥚✨ 蛋孵化了！接下來會發生什麼呢？");
    }
  }
}
function startP5World() {
  if(typeof p5==="undefined")return status("❌ p5.js 載入失敗");
  new p5(p=>{
    p.setup=()=>{
      p.createCanvas($("world").clientWidth,$("world").clientHeight).parent("scene");
    };
    p.draw=()=>{
      const t=performance.now()/1000;
      p.clear();
      drawEnvironment(p,t);
      animateHeroes(p,t);
      drawScenes(p,t);
    };
    p.windowResized=()=>{
      p.resizeCanvas($("world").clientWidth,$("world").clientHeight);
    };
  });
}
function resizeWorld() {
  setTimeout(()=>window.dispatchEvent(new Event("resize")),280);
}

/* ===== 所有按鈕 ===== */
function setupButtons() {
  click("startButton",()=>{
    modal("startScreen",false);
    bubble("🌈 拍下你的第一個黏土朋友吧！");
  });
  click("openCamera",openCamera);
  click("captureButton",capturePhoto);
  click("closeCamera",closeCamera);
  click("retryCamera",openCamera);
  click("switchCamera",()=>{
    state.cameraFacing=state.cameraFacing==="environment"?"user":"environment";
    return openCamera();
  });
  click("uploadPhoto",()=>$("photoFile").click());
  $("photoFile").addEventListener("change",async e=>{
    const f=e.target.files?.[0];e.target.value="";
    if(!f)return;
    state.editorHeroId=null;
    try{await openEditor(await fileData(f));}
    catch(err){status("❌ "+err.message);}
  });
  click("editHero",async()=>{
    const h=heroNow();
    if(!h)throw Error("請先選擇主角");
    state.editorHeroId=h.id;
    await openEditor(h.original);
  });
  click("deleteHero",removeHero);
  click("inspectHero",inspectHero);
  click("removeBg",quickRemoveBg);
  click("removeBgAI",aiRemoveBg);
  click("eraseMode",()=>{state.editorMode="erase";status("🧽 擦除模式");});
  click("restoreMode",()=>{state.editorMode="restore";status("🖌️ 還原模式");});
  click("undoEdit",undoEditor);
  click("resetEdit",resetEditor);
  click("saveEditor",saveHero);
  click("closeEditor",()=>modal("editorModal",false));

  const c=$("editCanvas");
  c.addEventListener("pointerdown",e=>{
    e.preventDefault();editorHistory();
    state.editorPainting=true;state.editorLastPoint=editorPoint(e);
    c.setPointerCapture(e.pointerId);paintEditor(e);
  });
  c.addEventListener("pointermove",paintEditor);
  for(const ev of ["pointerup","pointercancel","lostpointercapture"]){
    c.addEventListener(ev,()=>{
      state.editorPainting=false;state.editorLastPoint=null;
    });
  }

  click("micButton",toggleRecording);
  click("sendButton",sendStory);
  click("voiceButton",()=>{
    state.voiceEnabled=!state.voiceEnabled;
    $("voiceButton").textContent="🔊 語音："+(state.voiceEnabled?"開":"關");
    if(!state.voiceEnabled)stopSpeech();
  });
  click("stopVoice",()=>{
    stopSpeech();
    if(state.recorder?.state==="recording")state.recorder.stop();
  });
  $("selectedHero").addEventListener("change",e=>{
    state.selectedId=e.target.value;refreshHeroes();
  });
  $("chatInput").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){
      e.preventDefault();sendStory();
    }
  });
  click("transformButton",async()=>{
    const b=$("transformButton");b.disabled=true;
    try{await transformHero(heroNow(),$("transformInput").value.trim());}
    finally{b.disabled=false;}
  });
  click("restoreButton",showOriginal);
  click("showTransform",showTransform);
  click("skillButton",()=>{
    const h=heroNow();
    if(!h?.skills.length)return status("請先讓主角學會技能");
    h.skillUntil=performance.now()+4000;
    bubble("⚡ "+h.name+" 表演："+h.skills.at(-1).name);
  });
  $("worldSelect").addEventListener("change",e=>{
    state.world=e.target.value;
    const themes={
      ocean:["🌊 Mindspace｜海底世界","linear-gradient(#66c5eb,#aee9f5 75%,#73c8cb)"],
      forest:["🌳 Mindspace｜森林世界","linear-gradient(#c2e9fa,#d4edba 75%,#90c988)"],
      space:["🚀 Mindspace｜太空世界","linear-gradient(#101733,#323c78)"]
    };
    $("worldTitle").textContent=themes[state.world][0];
    $("world").style.background=themes[state.world][1];
  });
  click("resetButton",()=>{
    if(!confirm("確定清除所有主角與故事嗎？"))return;
    stopSpeech();
    state.heroes.forEach(h=>h.element.remove());
    state.heroes=[];state.selectedId=null;
    state.history=[];state.scenes=[];
    $("chatLog").replaceChildren();
    refreshHeroes();
    bubble("🌱 一起創造新的黏土朋友吧！");
    status("已開始新創作");
  });
  click("mobileToggle",()=>{
    const collapsed=$("sidebar").classList.toggle("collapsed");
    $("mobileToggle").textContent=collapsed?"☰ 展開":"☰ 收合";
    resizeWorld();
  });
  click("fullscreenButton",async()=>{
    if(document.fullscreenElement){
      await document.exitFullscreen();
    }else if($("app").requestFullscreen){
      await $("app").requestFullscreen();
    }else{
      status("此瀏覽器不支援網頁全螢幕，可使用瀏覽器本身的全螢幕功能");
    }
    resizeWorld();
  });
  document.addEventListener("fullscreenchange",()=>{
    $("fullscreenButton").textContent=document.fullscreenElement?"⛶ 退出":"⛶ 全螢幕";
    resizeWorld();
  });
  click("testBridge",async()=>{
    status("🔍 正在測試 AI 後端……");
    try{
      const r=await callAI("ping",{});
      status("✅ AI 連線成功："+(r.message||"PONG"));
    }catch(e){status("❌ 連線測試失敗："+e.message);}
  });
}
function initializeMindspace() {
  setupButtons();
  refreshHeroes();
  startP5World();
  initializeBridge();
}
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",initializeMindspace,{once:true});
}else initializeMindspace();
