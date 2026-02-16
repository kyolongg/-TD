(() => {
  // ---------- Canvas / View ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  let W=0,H=0;
  function resize(){
    const rect = canvas.getBoundingClientRect();
    W = Math.floor(rect.width);
    H = Math.floor(rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener("resize", resize, {passive:true});
  resize();

  // Simple camera pan (drag)
  let cam = {x:0,y:0};
  let dragging=false;
  let lastPt=null;

  function screenToWorld(sx, sy){
    return {x: sx - cam.x, y: sy - cam.y};
  }
  function worldToScreen(wx, wy){
    return {x: wx + cam.x, y: wy + cam.y};
  }

  // ---------- UI ----------
  const $ = (id)=>document.getElementById(id);
  const moneyEl = $("money"), livesEl=$("lives"), waveEl=$("wave"), waveTotalEl=$("waveTotal"), hintEl=$("hint");
  const overlay=$("overlay"), resultTitle=$("resultTitle"), resultText=$("resultText");

  const btnSelLuffy=$("selLuffy"), btnSelUsopp=$("selUsopp"), btnSelNone=$("selNone");
  const btnStart=$("startBtn"), btnSkill=$("skillBtn"), btnUpgrade=$("upgradeBtn"), btnSell=$("sellBtn");
  const btnPause=$("pauseBtn"), btnRestart=$("restartBtn");

  function setActiveBtn(active){
    [btnSelLuffy, btnSelUsopp, btnSelNone].forEach(b=>b.classList.remove("active"));
    if (active) active.classList.add("active");
  }

  // ---------- Game Data ----------
  const TowerDefs = {
    luffy: {
      name: "魯夫", baseCost: 80,
      tiers: [
        {cost:80, range: 85, atkI: 0.85, dmg: 12, melee:true, canAir:false, skill:{type:"shock", cd:18, r:110, mult:2.0, stun:0.8}},
        {cost:140, range: 92, atkI: 0.45, dmg: 10, melee:true, canAir:false, skill:{type:"burst", cd:22, dur:6, aspd:1.6}, label:"機關槍"},
        {cost:240, range: 98, atkI: 0.35, dmg: 14, melee:true, canAir:false, skill:{type:"burst", cd:26, dur:8, aspd:2.0}, label:"二檔"}
      ]
    },
    usopp: {
      name: "騙人布", baseCost: 90,
      tiers: [
        {cost:90, range: 260, atkI: 1.10, dmg: 14, melee:false, canAir:true, skill:{type:"trap", cd:24, r:120, slow:0.55, dur:6}},
        {cost:160, range: 280, atkI: 1.10, dmg: 16, melee:false, canAir:true, proj:{splash:70, burn:4, burnT:3.5}, label:"火炎星"},
        {cost:260, range: 340, atkI: 1.00, dmg: 20, melee:false, canAir:true, proj:{pierce:1}, label:"長距離"}
      ]
    }
  };

  const EnemyDefs = {
    grunt: {name:"雜兵", hp:55, armor:0, spd:65, reward:10, air:false},
    tank:  {name:"重甲", hp:140, armor:6, spd:45, reward:16, air:false},
    air:   {name:"飛行", hp:70, armor:1, spd:75, reward:12, air:true},
    boss:  {name:"惡龍", hp:900, armor:4, spd:42, reward:120, air:false, boss:true}
  };

  const WaveSet = [
    {entries:[["grunt",8,0.7]]},
    {entries:[["grunt",10,0.6]]},
    {entries:[["tank",6,1.1]]},
    {entries:[["air",8,0.7]]},
    {entries:[["grunt",12,0.5],["tank",4,1.2]]},
    {entries:[["boss",1,0]]},
  ];

  // ---------- World Layout ----------
  // A polyline path in world coordinates (pixels)
  const path = [
    {x:80, y: H*0.25},
    {x:W*0.35, y:H*0.25},
    {x:W*0.35, y:H*0.55},
    {x:W*0.68, y:H*0.55},
    {x:W*0.68, y:H*0.35},
    {x:W-90, y:H*0.35},
  ];

  function rebuildPathOnResize(){
    path.length=0;
    path.push(
      {x:80, y: H*0.25},
      {x:W*0.35, y:H*0.25},
      {x:W*0.35, y:H*0.55},
      {x:W*0.68, y:H*0.55},
      {x:W*0.68, y:H*0.35},
      {x:W-90, y:H*0.35},
    );
  }

  window.addEventListener("resize", ()=>{ resize(); rebuildPathOnResize(); }, {passive:true});

  const buildRadius = 26;   // tower spacing
  const basePos = path[path.length-1];

  // ---------- Game State ----------
  let state = {
    money: 220,
    lives: 20,
    waveIndex: 0,
    running: false,
    paused: false,
    over: false
  };

  let selectedType = null;      // "luffy" | "usopp" | null
  let towers = [];
  let enemies = [];
  let projectiles = [];
  let traps = [];
  let selectedTowerId = null;

  // Spawning controller
  let waveSpawning = null; // {queue:[{type,remaining,interval,nextAt}], done:bool}
  let lastT = performance.now();

  function reset(){
    state = {money:220,lives:20,waveIndex:0,running:false,paused:false,over:false};
    towers=[]; enemies=[]; projectiles=[]; traps=[]; selectedTowerId=null;
    waveSpawning=null;
    overlay.classList.add("hidden");
    hint("點「開始/下一波」出怪，點地面放塔。");
    refreshUI();
  }

  // ---------- Helpers ----------
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  function hint(t){ hintEl.textContent = t; }

  function refreshUI(){
    moneyEl.textContent = state.money;
    livesEl.textContent = state.lives;
    waveEl.textContent = Math.min(state.waveIndex, WaveSet.length);
    waveTotalEl.textContent = WaveSet.length;
    btnPause.textContent = state.paused ? "▶︎" : "⏸︎";
  }

  function gameOver(win){
    state.over = true;
    state.running = false;
    overlay.classList.remove("hidden");
    resultTitle.textContent = win ? "WIN" : "LOSE";
    resultText.textContent = win ? "你守住了這一段航路（原型）" : "基地被突破了（原型）";
  }

  // ---------- Tower / Enemy Entities ----------
  let idCounter=1;
  function makeTower(type, x, y){
    const def = TowerDefs[type];
    const t = def.tiers[0];
    return {
      id: idCounter++,
      type, tier:0,
      x,y,
      atkCd: 0,
      burstUntil: 0,
      skillReadyAt: 0
    };
  }

  function towerTier(t){ return TowerDefs[t.type].tiers[t.tier]; }

  function canPlaceAt(x,y){
    // avoid path corridor
    // if near any segment < 28px reject
    for (let i=0;i<path.length-1;i++){
      const a=path[i], b=path[i+1];
      const vx=b.x-a.x, vy=b.y-a.y;
      const wx=x-a.x, wy=y-a.y;
      const l2=vx*vx+vy*vy || 1;
      let t= (wx*vx+wy*vy)/l2;
      t=clamp(t,0,1);
      const px=a.x+vx*t, py=a.y+vy*t;
      if (Math.hypot(x-px,y-py) < 34) return false;
    }
    // spacing
    for (const tw of towers){
      if (Math.hypot(x-tw.x,y-tw.y) < buildRadius*2) return false;
    }
    return true;
  }

  function makeEnemy(type){
    const d = EnemyDefs[type];
    return {
      id: idCounter++,
      type,
      hp: d.hp,
      maxHp: d.hp,
      armor: d.armor,
      spd: d.spd,
      reward: d.reward,
      air: d.air,
      boss: !!d.boss,
      wp: 0,
      x: path[0].x,
      y: path[0].y,
      stunUntil: 0,
      slowMult: 1,
      slowUntil: 0,
      burnDps: 0,
      burnUntil: 0
    };
  }

  function applyDamage(e, dmg){
    // physical
    dmg = Math.max(1, dmg - e.armor);
    e.hp -= dmg;
    if (e.hp <= 0){
      e.hp = 0;
      state.money += e.reward;
      // remove
      enemies = enemies.filter(x=>x.id!==e.id);
    }
  }

  // ---------- Combat ----------
  function findTarget(t){
    const tt = towerTier(t);
    let best=null, bestD=1e9;
    for (const e of enemies){
      if (!tt.canAir && e.air) continue;
      const d = Math.hypot(e.x-t.x, e.y-t.y);
      if (d <= tt.range && d < bestD){
        bestD=d; best=e;
      }
    }
    return best;
  }

  function spawnProjectile(t, e){
    projectiles.push({
      id:idCounter++,
      from:{x:t.x,y:t.y},
      x:t.x, y:t.y,
      tx:e.x, ty:e.y,
      targetId:e.id,
      spd: 420,
      dmg: towerTier(t).dmg,
      extras: towerTier(t).proj || null
    });
  }

  function doShockwave(t){
    const tt = towerTier(t);
    const sk = tt.skill;
    const dmg = tt.dmg * sk.mult;
    for (const e of enemies){
      const d = Math.hypot(e.x-t.x, e.y-t.y);
      if (d <= sk.r){
        applyDamage(e, dmg);
        e.stunUntil = Math.max(e.stunUntil, nowSec + sk.stun);
      }
    }
  }

  function spawnTrap(t){
    const tt=towerTier(t);
    const sk=tt.skill;
    traps.push({
      id:idCounter++,
      x:t.x,y:t.y,
      r:sk.r,
      slow:sk.slow,
      until: nowSec + sk.dur
    });
  }

  function canUseSkill(t){
    const tt=towerTier(t);
    if (!tt.skill) return false;
    return nowSec >= t.skillReadyAt;
  }

  function useSkill(t){
    const tt=towerTier(t);
    if (!tt.skill) return;
    if (!canUseSkill(t)) return;
    t.skillReadyAt = nowSec + tt.skill.cd;

    if (tt.skill.type === "shock") doShockwave(t);
    else if (tt.skill.type === "trap") spawnTrap(t);
    else if (tt.skill.type === "burst"){
      t.burstUntil = nowSec + tt.skill.dur;
    }
  }

  // ---------- Waves ----------
  function startNextWave(){
    if (state.over) return;
    if (waveSpawning) return; // currently spawning
    if (state.waveIndex >= WaveSet.length) return;

    const w = WaveSet[state.waveIndex];
    const queue = w.entries.map(([type,count,interval]) => ({
      type, remaining:count, interval, nextAt: nowSec
    }));
    waveSpawning = {queue, done:false};
    state.waveIndex += 1;
    state.running = true;
    refreshUI();
  }

  function updateSpawning(dt){
    if (!waveSpawning) return;
    let allDone = true;
    for (const q of waveSpawning.queue){
      if (q.remaining <= 0) continue;
      allDone = false;
      if (nowSec >= q.nextAt){
        enemies.push(makeEnemy(q.type));
        q.remaining -= 1;
        q.nextAt = nowSec + (q.interval || 0.01);
      }
    }
    if (allDone){
      waveSpawning = null;
    }
  }

  // ---------- Input ----------
  function pickTowerAt(wx, wy){
    // simple hit radius
    for (let i=towers.length-1;i>=0;i--){
      const t=towers[i];
      if (Math.hypot(wx-t.x, wy-t.y) <= 22) return t;
    }
    return null;
  }

  function onTap(sx, sy){
    const {x:wx, y:wy} = screenToWorld(sx, sy);

    // pick tower
    const picked = pickTowerAt(wx, wy);
    if (picked){
      selectedTowerId = picked.id;
      hint(`${TowerDefs[picked.type].name} T${picked.tier+1} 已選取。可升級/技能/出售。`);
      return;
    }

    // place tower
    if (!selectedType) return;
    const def = TowerDefs[selectedType];
    const cost = def.tiers[0].cost;
    if (state.money < cost){ hint("金錢不足"); return; }
    if (!canPlaceAt(wx, wy)){ hint("不能放在路上/太近"); return; }

    state.money -= cost;
    towers.push(makeTower(selectedType, wx, wy));
    hint(`已放置：${def.name}`);
    refreshUI();
  }

  // pointer handlers (touch+mouse)
  let pointerDown=false, moved=false, downAt=null;
  canvas.addEventListener("pointerdown", (e)=>{
    pointerDown=true; moved=false;
    dragging=true;
    lastPt={x:e.clientX, y:e.clientY};
    downAt={x:e.clientX,y:e.clientY, t:performance.now()};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e)=>{
    if (!pointerDown) return;
    const dx=e.clientX-lastPt.x, dy=e.clientY-lastPt.y;
    if (Math.hypot(dx,dy) > 2) moved=true;
    cam.x += dx;
    cam.y += dy;
    lastPt={x:e.clientX, y:e.clientY};
  });
  canvas.addEventListener("pointerup", (e)=>{
    pointerDown=false; dragging=false;
    const dt = performance.now()-downAt.t;
    const d = Math.hypot(e.clientX-downAt.x, e.clientY-downAt.y);
    if (d < 8 && dt < 350){
      onTap(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
    }
  });

  // ---------- Buttons ----------
  btnSelLuffy.onclick=()=>{ selectedType="luffy"; setActiveBtn(btnSelLuffy); hint("已選：魯夫。點地面放塔"); };
  btnSelUsopp.onclick=()=>{ selectedType="usopp"; setActiveBtn(btnSelUsopp); hint("已選：騙人布。點地面放塔"); };
  btnSelNone.onclick=()=>{ selectedType=null; setActiveBtn(btnSelNone); hint("已取消選取"); };

  btnStart.onclick=()=> startNextWave();

  btnSkill.onclick=()=>{
    const t = towers.find(x=>x.id===selectedTowerId);
    if (!t){ hint("先點一座塔"); return; }
    if (!towerTier(t).skill){ hint("這座塔沒有技能"); return; }
    if (!canUseSkill(t)){ hint("技能冷卻中"); return; }
    useSkill(t);
    hint("已施放技能");
  };

  btnUpgrade.onclick=()=>{
    const t = towers.find(x=>x.id===selectedTowerId);
    if (!t){ hint("先點一座塔"); return; }
    if (t.tier >= 2){ hint("已滿級"); return; }
    const cur = towerTier(t);
    const nxt = TowerDefs[t.type].tiers[t.tier+1];
    const addCost = Math.max(0, nxt.cost - cur.cost);
    if (state.money < addCost){ hint("金錢不足"); return; }
    state.money -= addCost;
    t.tier += 1;
    hint(`已升級到 T${t.tier+1} ${nxt.label?("("+nxt.label+")"):""}`);
    refreshUI();
  };

  btnSell.onclick=()=>{
    const idx = towers.findIndex(x=>x.id===selectedTowerId);
    if (idx<0){ hint("先點一座塔"); return; }
    const t=towers[idx];
    const refund = Math.floor(towerTier(t).cost * 0.6);
    state.money += refund;
    towers.splice(idx,1);
    selectedTowerId=null;
    hint(`已出售，回收 $${refund}`);
    refreshUI();
  };

  btnPause.onclick=()=>{
    state.paused = !state.paused;
    refreshUI();
  };

  btnRestart.onclick=()=>reset();

  // ---------- Main Loop ----------
  let nowSec = 0;

  function update(dt){
    if (state.over || state.paused) return;

    // spawning
    updateSpawning(dt);

    // traps
    traps = traps.filter(tr => tr.until > nowSec);
    for (const tr of traps){
      for (const e of enemies){
        const d = Math.hypot(e.x-tr.x, e.y-tr.y);
        if (d <= tr.r){
          e.slowMult = Math.min(e.slowMult, tr.slow);
          e.slowUntil = Math.max(e.slowUntil, nowSec + 0.25);
        }
      }
    }

    // towers attack
    for (const t of towers){
      const tt = towerTier(t);
      let atkI = tt.atkI;
      if (tt.skill && tt.skill.type==="burst" && nowSec < t.burstUntil){
        atkI = atkI / Math.max(1.01, tt.skill.aspd);
      }
      t.atkCd -= dt;
      if (t.atkCd <= 0){
        const target = findTarget(t);
        if (target){
          if (tt.melee){
            applyDamage(target, tt.dmg);
          } else {
            spawnProjectile(t, target);
          }
          t.atkCd = atkI;
        } else {
          t.atkCd = 0.05;
        }
      }
    }

    // projectiles
    projectiles = projectiles.filter(p => {
      const e = enemies.find(x=>x.id===p.targetId);
      if (!e) return false;
      p.tx = e.x; p.ty = e.y;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx,dy) || 1;
      const step = p.spd * dt;
      if (d <= step){
        // hit
        applyDamage(e, p.dmg);
        if (p.extras){
          if (p.extras.splash){
            for (const other of enemies){
              if (other.id===e.id) continue;
              if (Math.hypot(other.x-e.x, other.y-e.y) <= p.extras.splash){
                applyDamage(other, p.dmg*0.75);
              }
            }
          }
          if (p.extras.burn){
            e.burnDps = Math.max(e.burnDps, p.extras.burn);
            e.burnUntil = Math.max(e.burnUntil, nowSec + (p.extras.burnT||2));
          }
          if (p.extras.pierce){
            // simple pierce: nearest other
            let best=null, bestD=1e9;
            for (const other of enemies){
              if (other.id===e.id) continue;
              const dd = Math.hypot(other.x-e.x, other.y-e.y);
              if (dd<bestD && dd<=90){ bestD=dd; best=other; }
            }
            if (best) applyDamage(best, p.dmg*0.7);
          }
        }
        return false;
      } else {
        p.x += dx/d * step;
        p.y += dy/d * step;
        return true;
      }
    });

    // enemies move + dots
    for (const e of enemies){
      // burn
      if (nowSec < e.burnUntil && e.burnDps>0){
        e.hp -= e.burnDps * dt;
        if (e.hp <= 0){
          e.hp = 0;
          state.money += e.reward;
        }
      }

      if (e.hp <= 0) continue;

      // slow decay
      if (nowSec > e.slowUntil) e.slowMult = 1;

      if (nowSec < e.stunUntil) continue;

      const wpNext = Math.min(path.length-1, e.wp+1);
      const target = path[wpNext];
      const dx = target.x - e.x, dy = target.y - e.y;
      const d = Math.hypot(dx,dy) || 1;
      const step = e.spd * e.slowMult * dt;
      if (d <= step){
        e.x = target.x; e.y = target.y; e.wp = wpNext;
        if (e.wp >= path.length-1){
          // reach base
          state.lives -= 1;
          e.hp = 0;
        }
      } else {
        e.x += dx/d * step;
        e.y += dy/d * step;
      }
    }
    // remove dead & apply rewards already handled
    enemies = enemies.filter(e => e.hp > 0);

    // lose
    if (state.lives <= 0){
      state.lives = 0;
      refreshUI();
      gameOver(false);
      return;
    }

    // win condition: all waves done and nothing left and not spawning
    if (state.waveIndex >= WaveSet.length && enemies.length===0 && !waveSpawning){
      refreshUI();
      gameOver(true);
      return;
    }

    refreshUI();
  }

  function draw(){
    ctx.clearRect(0,0,W,H);

    // background grid
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(-10000,-10000,20000,20000);

    // subtle grid
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    const g=60;
    for (let x=-2000;x<=2000;x+=g){
      ctx.beginPath(); ctx.moveTo(x,-2000); ctx.lineTo(x,2000); ctx.stroke();
    }
    for (let y=-2000;y<=2000;y+=g){
      ctx.beginPath(); ctx.moveTo(-2000,y); ctx.lineTo(2000,y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // path
    ctx.lineWidth = 26;
    ctx.strokeStyle = "rgba(80,170,255,0.22)";
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();

    // base
    ctx.fillStyle="rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(basePos.x, basePos.y, 26, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle="rgba(255,255,255,0.35)";
    ctx.fillText("BASE", basePos.x-18, basePos.y+4);

    // traps
    for (const tr of traps){
      ctx.strokeStyle="rgba(251,191,36,0.35)";
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(tr.x,tr.y,tr.r,0,Math.PI*2); ctx.stroke();
    }

    // towers
    for (const t of towers){
      const tt=towerTier(t);
      const name=TowerDefs[t.type].name;
      const selected = (t.id===selectedTowerId);

      // range (selected)
      if (selected){
        ctx.strokeStyle="rgba(46,125,255,0.28)";
        ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(t.x,t.y,tt.range,0,Math.PI*2); ctx.stroke();
      }

      // body
      ctx.fillStyle = t.type==="luffy" ? "rgba(255,80,80,0.85)" : "rgba(80,255,160,0.85)";
      if (selected) ctx.fillStyle = t.type==="luffy" ? "rgba(255,80,80,1)" : "rgba(80,255,160,1)";
      ctx.beginPath();
      ctx.arc(t.x,t.y,18,0,Math.PI*2);
      ctx.fill();

      // tier ring
      ctx.strokeStyle="rgba(255,255,255,0.45)";
      ctx.lineWidth=2;
      ctx.beginPath();
      ctx.arc(t.x,t.y,21,0,Math.PI*2);
      ctx.stroke();

      // label
      ctx.fillStyle="rgba(255,255,255,0.9)";
      ctx.font="12px system-ui";
      ctx.fillText(`${name} T${t.tier+1}`, t.x-26, t.y-26);

      // skill cd indicator
      const sk = tt.skill;
      if (sk){
        const cdLeft = Math.max(0, t.skillReadyAt - nowSec);
        if (cdLeft > 0.01){
          const pct = clamp(cdLeft/sk.cd, 0, 1);
          ctx.strokeStyle="rgba(0,0,0,0.35)";
          ctx.lineWidth=4;
          ctx.beginPath(); ctx.arc(t.x,t.y,14, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct); ctx.stroke();
        }
      }
    }

    // projectiles
    for (const p of projectiles){
      ctx.fillStyle="rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill();
    }

    // enemies
    for (const e of enemies){
      // body
      ctx.fillStyle = e.boss ? "rgba(255,59,59,0.9)" : (e.air ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.7)");
      ctx.beginPath(); ctx.arc(e.x,e.y, e.boss?18:12,0,Math.PI*2); ctx.fill();

      // hp bar
      const bw = e.boss?46:32;
      const bh = 6;
      const x=e.x-bw/2, y=e.y-(e.boss?30:22);
      ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.fillRect(x,y,bw,bh);
      ctx.fillStyle="rgba(35,197,94,0.9)";
      ctx.fillRect(x,y,bw*(e.hp/e.maxHp),bh);

      // status
      if (nowSec < e.stunUntil){
        ctx.fillStyle="rgba(251,191,36,0.95)";
        ctx.fillText("暈", e.x-4, e.y+4);
      }
      if (nowSec < e.burnUntil){
        ctx.fillStyle="rgba(255,120,0,0.95)";
        ctx.fillText("火", e.x+10, e.y+4);
      }
    }

    ctx.restore();

    // UI helper text
    ctx.fillStyle="rgba(255,255,255,0.6)";
    ctx.font="12px system-ui";
    ctx.fillText("原型：點地面放塔 / 點塔操作 / 拖曳平移", 10, H-10);
  }

  function tick(t){
    const dt = Math.min(0.05, (t-lastT)/1000);
    lastT = t;
    nowSec += dt;
    if (!state.paused && !state.over){
      update(dt);
    }
    draw();
    requestAnimationFrame(tick);
  }

  // start
  setActiveBtn(btnSelNone);
  refreshUI();
  reset();
  requestAnimationFrame(tick);
})();
