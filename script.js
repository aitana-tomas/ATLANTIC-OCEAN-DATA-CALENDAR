(() => {
  "use strict";

  // Datos. Si existe data/manifest.json, la aplicación usa el conjunto
  // preparado por el procesador webODV. Si no existe, usa data.js como
  // respaldo para que la aplicación siga funcionando de forma local.
  let DATA = (window.ARGO_DATA || []).filter(d => Number(d.year) !== 2016);
  let ACTIVE_DATA = DATA;
  let ACTIVE_INDEX_DAY = new Map();
  let ACTIVE_INDEX_MONTH = new Map();
  let MAP_COUNTS = new Map();
  let DATA_MANIFEST = null;
  let DATA_MODE = "legacy";

  const DEPTHS = ["0–200 m","200–500 m","500–1000 m","1000–1500 m","1500–2000 m"];
  const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
  let YEARS = [...new Set(DATA.map(d => Number(d.year)))].sort((a,b)=>a-b);
  let LON_MIN = DATA.length ? Math.min(...DATA.map(d => Number(d.lon_center))) : -82.5;
  let LON_MAX = DATA.length ? Math.max(...DATA.map(d => Number(d.lon_center))) : 17.5;
  let LAT_MIN = DATA.length ? Math.min(...DATA.map(d => Number(d.lat_center))) : -57.5;
  let LAT_MAX = DATA.length ? Math.max(...DATA.map(d => Number(d.lat_center))) : 67.5;
  const GLOBAL = {
    temperature: {min:-2, max:31, step:1, label:"TEMPERATURA (°C)"},
    salinity: {min:31, max:38, step:1, label:"SALINIDAD"}
  };

  const state = {
    variable:"temperature",
    stat:"mean",
    depth:DEPTHS[0],
    selectedCells:new Set(),
    region:"all",
    center:.5,
    info:"visual",
    viewMode:"daily"
  };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const key = (lat,lon) => `${lat}|${lon}`;

  function indexData(rows){
    ACTIVE_INDEX_DAY = new Map();
    ACTIVE_INDEX_MONTH = new Map();
    for(const r of rows){
      const y=Number(r.year), m=Number(r.month), d=Number(r.day), depth=r.depth_range;
      const dk=`${y}|${m}|${d}|${depth}`;
      const mk=`${y}|${m}|${depth}`;
      if(!ACTIVE_INDEX_DAY.has(dk)) ACTIVE_INDEX_DAY.set(dk,[]);
      if(!ACTIVE_INDEX_MONTH.has(mk)) ACTIVE_INDEX_MONTH.set(mk,[]);
      ACTIVE_INDEX_DAY.get(dk).push(r);
      ACTIVE_INDEX_MONTH.get(mk).push(r);
    }
  }

  async function fetchJson(url){
    const dataUrl=url.startsWith("data/")?url:`data/${url}`;
    const res=await fetch(dataUrl,{cache:"no-store"});
    if(!res.ok) throw new Error(`No se pudo cargar ${dataUrl} (${res.status})`);
    return await res.json();
  }

  async function loadRegionData(region){
    if(DATA_MODE!=="chunked") return;
    const files=(DATA_MANIFEST.regions||{})[region];
    if(!files) throw new Error(`No existe el archivo de la región "${region}".`);
    const list=Array.isArray(files)?files:[files];
    const chunks=await Promise.all(list.map(fetchJson));
    ACTIVE_DATA=chunks.flat();
    indexData(ACTIVE_DATA);
  }

  async function loadCustomCells(){
    if(DATA_MODE!=="chunked"){ ACTIVE_DATA=DATA.filter(d=>state.selectedCells.has(key(Number(d.lat_center),Number(d.lon_center)))); indexData(ACTIVE_DATA); return; }
    const cells=[...state.selectedCells];
    if(!cells.length){ACTIVE_DATA=[];indexData(ACTIVE_DATA);return;}
    const files=cells.flatMap(k=>{
      const [lat,lon]=k.split("|");
      const f=(DATA_MANIFEST.cells||{})[`${lat}|${lon}`];
      return f ? (Array.isArray(f)?f:[f]) : [];
    });
    const chunks=await Promise.all(files.map(fetchJson));
    ACTIVE_DATA=chunks.flat();
    indexData(ACTIVE_DATA);
  }

  async function loadDataSource(){
    try{
      const manifest=await fetch("data/manifest.json",{cache:"no-store"});
      if(!manifest.ok) throw new Error("manifest no disponible");
      DATA_MANIFEST=await manifest.json();
      DATA_MODE="chunked";
      YEARS=(DATA_MANIFEST.years||[]).map(Number).sort((a,b)=>a-b);
      const b=DATA_MANIFEST.bounds||{};
      LON_MIN=Number.isFinite(Number(b.lon_min))?Number(b.lon_min):LON_MIN;
      LON_MAX=Number.isFinite(Number(b.lon_max))?Number(b.lon_max):LON_MAX;
      LAT_MIN=Number.isFinite(Number(b.lat_min))?Number(b.lat_min):LAT_MIN;
      LAT_MAX=Number.isFinite(Number(b.lat_max))?Number(b.lat_max):LAT_MAX;
      if(Array.isArray(DATA_MANIFEST.depth_ranges) && DATA_MANIFEST.depth_ranges.length){
        DEPTHS.splice(0,DEPTHS.length,...DATA_MANIFEST.depth_ranges.map(x=>x.label||x));
      }
      if(DATA_MANIFEST.temperature){ GLOBAL.temperature.min=Number(DATA_MANIFEST.temperature.min); GLOBAL.temperature.max=Number(DATA_MANIFEST.temperature.max); }
      if(DATA_MANIFEST.salinity){ GLOBAL.salinity.min=Number(DATA_MANIFEST.salinity.min); GLOBAL.salinity.max=Number(DATA_MANIFEST.salinity.max); }
      MAP_COUNTS=new Map(Object.entries(DATA_MANIFEST.map_counts||{}).map(([k,v])=>[k,Number(v)]));
      await loadRegionData("all");
      document.body.classList.toggle("many-years",YEARS.length>15);
      const periodLabel=`${YEARS[0]}–${YEARS.at(-1)}`;
      const ey=$("#period-label"); if(ey) ey.textContent=periodLabel;
      const q=$("#question-period"); if(q) q.textContent=periodLabel;
      const src=$("#data-source-label"); if(src) src.textContent=DATA_MANIFEST.source_label||"webODV / Argo";
    }catch(err){
      DATA_MODE="legacy";
      ACTIVE_DATA=DATA;
      indexData(ACTIVE_DATA);
      YEARS=[...new Set(DATA.map(d=>Number(d.year)))].sort((a,b)=>a-b);
      document.body.classList.toggle("many-years",YEARS.length>15);
      console.warn("Usando data.js de respaldo:",err.message);
    }
  }

  function fmt(v, digits=3) {
    if (!Number.isFinite(v)) return "—";
    return Number(v).toFixed(digits).replace(/\.?0+$/,"");
  }

  function colorAt(value) {
    const g=GLOBAL[state.variable];
    if (!Number.isFinite(value)) return "#cfd4d7";
    const min=g.min, max=g.max, c=min + state.center*(max-min);
    let t;
    if(value<=c) t=.5*(value-min)/Math.max(1e-9,c-min);
    else t=.5+.5*(value-c)/Math.max(1e-9,max-c);
    t=Math.max(0,Math.min(1,t));
    const stops=[
      [0,[0,55,190]],[.24,[0,132,218]],[.43,[205,220,222]],[.50,[232,224,211]],[.57,[229,184,165]],[.78,[184,55,49]],[1,[112,0,28]]
    ];
    for(let i=0;i<stops.length-1;i++){
      if(t<=stops[i+1][0]){
        const a=stops[i],b=stops[i+1],q=(t-a[0])/(b[0]-a[0]);
        const rgb=a[1].map((x,j)=>Math.round(x+(b[1][j]-x)*q));
        return `rgb(${rgb.join(",")})`;
      }
    }
    return "rgb(198,0,45)";
  }

  function meanWeighted(rows, field) {
    let sw=0,s=0;
    rows.forEach(r=>{
      const n=Number(r.n_observations)||0, v=Number(r[field]);
      if(n>0 && Number.isFinite(v)){sw+=n;s+=n*v;}
    });
    return sw?s/sw:NaN;
  }

  function pooledStd(rows, meanField, stdField) {
    let nTot=0, sum=0;
    rows.forEach(r=>{
      const n=Number(r.n_observations)||0, m=Number(r[meanField]), sd=Number(r[stdField]);
      if(n>0 && Number.isFinite(m) && Number.isFinite(sd)){nTot+=n;sum+=n*(sd*sd + (m-0)**2);}
    });
    if(!nTot)return NaN;
    const m=meanWeighted(rows,meanField);
    let ss=0;
    rows.forEach(r=>{
      const n=Number(r.n_observations)||0, x=Number(r[meanField]), sd=Number(r[stdField]);
      if(n>0 && Number.isFinite(x)&&Number.isFinite(sd)) ss += n*((sd*sd)+Math.pow(x-m,2));
    });
    return Math.sqrt(Math.max(0,ss/nTot));
  }

  function weightedMedian(rows, valueField) {
    const vals=rows.filter(r=>Number.isFinite(Number(r[valueField])) && (Number(r.n_observations)||0)>0)
      .map(r=>({v:Number(r[valueField]),w:Number(r.n_observations)||0})).sort((a,b)=>a.v-b.v);
    if(!vals.length)return NaN;
    const total=vals.reduce((s,x)=>s+x.w,0), half=total/2;
    let acc=0; for(const x of vals){acc+=x.w;if(acc>=half)return x.v;}
    return vals.at(-1).v;
  }

  function aggregate(rows) {
    if(!rows.length) return null;
    const isTemp=state.variable==="temperature";
    const meanField=isTemp?"temperature_mean":"salinity_mean";
    const medianField=isTemp?"temperature_median":"salinity_median";
    const stdField=isTemp?"temperature_std":"salinity_std";
    const value=state.stat==="mean" ? meanWeighted(rows,meanField) : weightedMedian(rows,medianField);
    const sd=pooledStd(rows,meanField,stdField);
    const n=rows.reduce((s,r)=>s+(Number(r.n_observations)||0),0);
    const profiles=rows.reduce((s,r)=>s+(Number(r.n_profiles)||0),0);
    return {value,sd,n,profiles,cells:rows.length};
  }

  function regionBounds(region) {
    const bands = {
      'polar-n':       {latMin:60, latMax:70},
      'subpolar-n':    {latMin:45, latMax:60},
      'subtropical-n': {latMin:30, latMax:45},
      tropical:       {latMin:-10, latMax:30},
      'subtropical-s': {latMin:-30, latMax:-10},
      'subpolar-s':    {latMin:-45, latMax:-30},
      'polar-s':       {latMin:-60, latMax:-45}
    };
    if (bands[region]) return {...bands[region], lonMin:LON_MIN-2.5, lonMax:LON_MAX+2.5};
    return {latMin:LAT_MIN-2.5, latMax:LAT_MAX+2.5, lonMin:LON_MIN-2.5, lonMax:LON_MAX+2.5};
  }

  function allMapCells() {
    const arr=[];
    for(let lat=LAT_MAX;lat>=LAT_MIN;lat-=5){
      for(let lon=LON_MIN;lon<=LON_MAX;lon+=5) arr.push({lat,lon});
    }
    return arr;
  }

  function buildMap(){
    const grid=$("#map-grid"); grid.innerHTML="";
    allMapCells().forEach(c=>{
      const el=document.createElement("button");
      el.className="map-cell";
      el.type="button";
      el.dataset.lat=c.lat; el.dataset.lon=c.lon;
      const k=key(c.lat,c.lon);
      const b=regionBounds(state.region);
      if(c.lat>=b.latMin && c.lat<b.latMax && c.lon>=b.lonMin && c.lon<b.lonMax) el.classList.add("region-highlight");
      if(state.selectedCells.has(k)) el.classList.add("selected");
      const count=DATA_MODE==="chunked"
        ? (MAP_COUNTS.get(key(c.lat,c.lon))||0)
        : DATA.filter(d=>Number(d.lat_center)===c.lat && Number(d.lon_center)===c.lon).reduce((s,d)=>s+(Number(d.n_profiles)||0),0);
      el.title="";
      el.addEventListener("mouseenter",e=>showCellTip(e, c, count));
      el.addEventListener("mouseleave",hideTip);
      el.addEventListener("mousemove",moveTip);
      el.addEventListener("click",async()=>{
        state.region="custom";
        if(state.selectedCells.has(k)) state.selectedCells.delete(k); else state.selectedCells.add(k);
        $$(".region").forEach(x=>x.classList.remove("active"));
        if(DATA_MODE==="chunked") await loadCustomCells();
        else { ACTIVE_DATA=DATA.filter(d=>state.selectedCells.has(key(Number(d.lat_center),Number(d.lon_center)))); indexData(ACTIVE_DATA); }
        renderMap(); renderMatrix(); updateStatus();
      });
      grid.appendChild(el);
    });
  }

  let tip;
  function ensureTip(){
    if(!tip){tip=document.createElement("div");tip.className="cell-tooltip";document.body.appendChild(tip);}
    return tip;
  }
  function showCellTip(e,c,count){
    const t=ensureTip();
    t.innerHTML=`<strong>${c.lat-2.5}–${c.lat+2.5}°N</strong><br>${c.lon}–${c.lon+5}°W<br>${count||0} perfiles`;
    t.classList.add("show"); moveTip(e);
  }
  function moveTip(e){if(tip){tip.style.left=(e.clientX+14)+"px";tip.style.top=(e.clientY+14)+"px";}}
  function hideTip(){if(tip)tip.classList.remove("show");}

  function renderMap(){buildMap();}

  function selectedData() {
    if(DATA_MODE==="chunked") return ACTIVE_DATA.filter(d=>d.depth_range===state.depth);
    let cells=[...state.selectedCells].map(k=>k.split("|").map(Number));
    if(!cells.length) return [];
    const cellSet=new Set(cells.map(([lat,lon])=>key(lat,lon)));
    return DATA.filter(d=>cellSet.has(key(Number(d.lat_center),Number(d.lon_center))) && d.depth_range===state.depth);
  }

  function daysInMonth(year, month){
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }  function renderMatrix(){
    const matrix=$("#matrix"), months=$("#month-labels"), years=$("#year-labels");
    matrix.innerHTML=""; months.innerHTML=""; years.innerHTML="";

    MONTHS.forEach(m=>{
      const s=document.createElement("span");
      s.textContent=m;
      months.appendChild(s);
    });
    YEARS.forEach(y=>{
      const s=document.createElement("span");
      s.textContent=y;
      years.appendChild(s);
    });

    matrix.style.setProperty("--year-count", YEARS.length);
    years.style.setProperty("--year-count", YEARS.length);

    const rows=selectedData();

    if(state.viewMode === "daily"){
      matrix.setAttribute("aria-label","Matriz diaria: meses en vertical y años en horizontal");
      MONTHS.forEach((_,mi)=>{
        YEARS.forEach(year=>{
          const monthCell=document.createElement("div");
          monthCell.className="month-cell daily-cell";
          const days=daysInMonth(year,mi+1);
          monthCell.style.setProperty("--day-rows", Math.ceil(days/7));

          const monthRows=DATA_MODE==="chunked"
            ? (ACTIVE_INDEX_MONTH.get(`${year}|${mi+1}|${state.depth}`)||[])
            : rows.filter(d=>Number(d.year)===year && Number(d.month)===mi+1);
          for(let day=1; day<=days; day++){
            const dayCell=document.createElement("div");
            dayCell.className="day-point-cell";
            const dayRows=DATA_MODE==="chunked"
              ? (ACTIVE_INDEX_DAY.get(`${year}|${mi+1}|${day}|${state.depth}`)||[])
              : monthRows.filter(d=>Number(d.day)===day);
            const agg=aggregate(dayRows);
            const point=document.createElement("div");
            point.className="day-point";

            if(!agg || !Number.isFinite(agg.value) || agg.n===0){
              point.classList.add("no-data");
            }else{
              const color=colorAt(agg.value);
              point.style.background=color;
              const sd=Number.isFinite(agg.sd)?agg.sd:0;
              const g=GLOBAL[state.variable];
              const normalized=Math.min(1,sd/((g.max-g.min)*.12));
              const halo=document.createElement("div");
              halo.className="day-halo";
              halo.style.setProperty("--halo",(7+normalized*5)+"px");
              halo.style.setProperty("--halo-color",color);
              dayCell.append(halo,point);
              dayCell.addEventListener("mouseenter",e=>showDayPointTip(e,year,mi,day,agg));
              dayCell.addEventListener("mouseleave",hidePointTip);
              dayCell.addEventListener("mousemove",movePointTip);
            }
            if(!dayCell.children.length) dayCell.appendChild(point);
            monthCell.appendChild(dayCell);
          }
          matrix.appendChild(monthCell);
        });
      });
      return;
    }

    matrix.setAttribute("aria-label","Matriz mensual: meses en vertical y años en horizontal");
    MONTHS.forEach((_,mi)=>{
      YEARS.forEach(year=>{
        const monthCell=document.createElement("div");
        monthCell.className="month-cell monthly-cell";
        const monthRows=rows.filter(d=>Number(d.year)===year && Number(d.month)===mi+1);
        const agg=aggregate(monthRows);
        const point=document.createElement("div");
        point.className="day-point monthly-point";

        if(!agg || !Number.isFinite(agg.value) || agg.n===0){
          point.classList.add("no-data");
        }else{
          const color=colorAt(agg.value);
          point.style.background=color;
          const sd=Number.isFinite(agg.sd)?agg.sd:0;
          const g=GLOBAL[state.variable];
          const normalized=Math.min(1,sd/((g.max-g.min)*.12));
          const halo=document.createElement("div");
          halo.className="day-halo";
          halo.style.setProperty("--halo",(30+normalized*18)+"px");
          halo.style.setProperty("--halo-color",color);
          monthCell.append(halo,point);
          monthCell.addEventListener("mouseenter",e=>showMonthPointTip(e,year,mi,agg));
          monthCell.addEventListener("mouseleave",hidePointTip);
          monthCell.addEventListener("mousemove",movePointTip);
        }
        if(!monthCell.children.length) monthCell.appendChild(point);
        matrix.appendChild(monthCell);
      });
    });
  }

  let pt;
  function ensurePointTip(){
    if(!pt){pt=document.createElement("div");pt.className="point-tooltip";document.body.appendChild(pt);}
    return pt;
  }
  function showDayPointTip(e,year,mi,day,agg){
    const t=ensurePointTip();
    const v=state.variable==="temperature"?"Temperatura":"Salinidad";
    const unit=state.variable==="temperature"?" °C":"";
    const date=`${String(day).padStart(2,"0")}/${String(mi+1).padStart(2,"0")}/${year}`;
    const cells=state.selectedCells.size;
    t.innerHTML=`<strong>${date}</strong><br>${v}<br><b>${fmt(agg.value,3)}${unit}</b><br>Desviación estándar<br>${fmt(agg.sd,3)}${unit}<br><b>N</b> ${agg.profiles||agg.n} perfiles<br>${cells} ${cells===1?"celda":"celdas"} seleccionada${cells===1?"":"s"}<br>${state.depth}`;
    t.classList.add("show"); movePointTip(e);
  }

  function showMonthPointTip(e,year,mi,agg){
    const t=ensurePointTip();
    const v=state.variable==="temperature"?"Temperatura":"Salinidad";
    const unit=state.variable==="temperature"?" °C":"";
    t.innerHTML=`<strong>${MONTHS[mi]} ${year}</strong><br>${v}<br><b>${fmt(agg.value,3)}${unit}</b><br>Desviación estándar<br>${fmt(agg.sd,3)}${unit}<br><b>N</b> ${agg.profiles||agg.n} perfiles<br>${state.selectedCells.size} ${state.selectedCells.size===1?"celda":"celdas"} seleccionada${state.selectedCells.size===1?"":"s"}<br>${state.depth}`;
    t.classList.add("show"); movePointTip(e);
  }

  function movePointTip(e){if(pt){pt.style.left=(e.clientX+15)+"px";pt.style.top=(e.clientY+15)+"px";}}
  function hidePointTip(){if(pt)pt.classList.remove("show");}

  function updateStatus(){
    const sel=state.region==="custom"?"SELECCIÓN MANUAL":state.region.toUpperCase();
    $("#status-line").textContent=`${YEARS.length} AÑOS · ${sel} · ${state.depth} · ${state.variable==="temperature"?"TEMPERATURA":"SALINIDAD"} · ${state.stat==="mean"?"PROMEDIO":"MEDIANA"} · ${state.viewMode==="daily"?"DIARIA":"MENSUAL"}`;
  }

  function renderDepth(){
    const wrap=$("#depth-slider");wrap.innerHTML="";
    const track=document.createElement("div");track.className="depth-track";wrap.appendChild(track);
    DEPTHS.forEach((d,i)=>{
      const node=document.createElement("button");node.type="button";node.className="depth-node"+(d===state.depth?" active":"");
      node.style.top=(i/(DEPTHS.length-1)*100)+"%";
      node.innerHTML=`<span class="depth-dot"></span><span class="depth-label">${d}</span>`;
      node.addEventListener("click",()=>{state.depth=d;renderDepth();renderMatrix();updateStatus();});
      wrap.appendChild(node);
    });
  }

  function updateLegend(){
    const g=GLOBAL[state.variable];
    $("#legend-title").textContent=g.label;
    const ticks=$("#legend-ticks");
    ticks.innerHTML="";
    const step = 1;
    const values=[];
    for(let raw=g.min; raw<=g.max+1e-9; raw+=step){
      values.push(state.variable === "temperature" ? Math.round(raw) : Math.round(raw*10)/10);
    }
    ticks.style.display="grid";
    ticks.style.gridTemplateColumns=`repeat(${values.length},1fr)`;
    ticks.setAttribute("aria-label", state.variable === "temperature" ? "Escala de temperatura en grados Celsius" : "Escala de salinidad");
    values.forEach((v,i)=>{
      const el=document.createElement("span");
      el.textContent=state.variable==="temperature" ? `${v} °C` : `${v} PSU`;
      el.style.textAlign = i===0 ? "left" : (i===values.length-1 ? "right" : "center");
      ticks.appendChild(el);
    });
    const c = g.min + state.center * (g.max - g.min);
    const p = (v) => ((v - g.min) / (g.max - g.min) * 100);
    const v28 = g.min + 0.56 * (c - g.min);
    const v72 = c + 0.44 * (g.max - c);
    const gradient = `linear-gradient(90deg,
      rgb(5,92,232) 0%,
      rgb(57,164,232) ${p(v28)}%,
      rgb(245,238,222) ${p(c)}%,
      rgb(245,129,70) ${p(v72)}%,
      rgb(198,0,45) 100%)`;
    $("#legend-track").style.background = gradient;
    $("#legend-marker").style.left=(state.center*100)+"%";
  }

  function setVariable(v){
    state.variable=v; updateLegend(); renderMatrix(); updateStatus();
    $$(".tab[data-variable]").forEach(b=>b.classList.toggle("active",b.dataset.variable===v));
  }
  function setStat(s){
    state.stat=s; renderMatrix(); updateStatus();
    $$(".tab[data-stat]").forEach(b=>b.classList.toggle("active",b.dataset.stat===s));
  }
  function setViewMode(v){
    state.viewMode=v; renderMatrix(); updateStatus();
    $$(".view-tab").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  }

  function setupTheme(){
    const btn = $("#theme-toggle");
    if(!btn) return;

    let saved = "light";

    function applyTheme(theme){
      const isLight = theme === "light";
      document.body.classList.toggle("light-theme", isLight);
      btn.textContent = isLight ? "☾" : "☀";
      btn.setAttribute("aria-label", isLight ? "Cambiar a tema oscuro" : "Cambiar a tema claro");
      btn.title = isLight ? "Cambiar a tema oscuro" : "Cambiar a tema claro";

      const map = $(".map-image");
      if(map){
        map.src = isLight ? "assets/atlantic-real-map.png" : "assets/atlantic-real-map-dark.png";
        map.style.filter = "none";
      }
      try { localStorage.setItem("ao-theme-v2", isLight ? "light" : "dark"); } catch(e) {}
    }

    applyTheme(saved === "light" ? "light" : "dark");
    btn.addEventListener("click",()=>{
      const next = document.body.classList.contains("light-theme") ? "dark" : "light";
      applyTheme(next);
    });
  }

  function setupControls(){
    $$(".tab[data-variable]").forEach(b=>b.addEventListener("click",()=>setVariable(b.dataset.variable)));
    $$(".tab[data-stat]").forEach(b=>b.addEventListener("click",()=>setStat(b.dataset.stat)));
    $$(".view-tab").forEach(b=>b.addEventListener("click",()=>setViewMode(b.dataset.view)));
    $$(".region").forEach(b=>b.addEventListener("click",async()=>{
      state.region=b.dataset.region;
      const bounds=regionBounds(state.region);
      state.selectedCells.clear();
      allMapCells().forEach(c=>{
        if(c.lat>=bounds.latMin && c.lat<bounds.latMax && c.lon>=bounds.lonMin && c.lon<bounds.lonMax) state.selectedCells.add(key(c.lat,c.lon));
      });
      $$(".region").forEach(x=>x.classList.toggle("active",x===b));
      try{ await loadRegionData(state.region); }
      catch(err){ console.error(err); }
      renderMap(); renderMatrix(); updateStatus();
    }));
    $("#clear-selection").addEventListener("click",()=>{state.selectedCells.clear();renderMap();renderMatrix();updateStatus();});
    $$(".info-btn").forEach(btn=>btn.addEventListener("click",()=>{
      const same=state.info===btn.dataset.info && $("#info-panel").classList.contains("open");
      $$(".info-btn").forEach(x=>x.classList.toggle("active",x===btn));
      state.info=btn.dataset.info;
      if(same){$("#info-panel").classList.remove("open");return;}
      const content={
        visual:`<h3>Visualización</h3>
          <p>Explora la variabilidad del océano Atlántico a partir de datos de perfiles Argo entre todos los años disponibles en el conjunto de datos. La visualización permite seleccionar una región geográfica mediante una cuadrícula de celdas de 5° × 5°, escoger un intervalo de profundidad y consultar la temperatura o la salinidad del agua.</p>
          <p>La matriz temporal muestra los años en el eje horizontal y los meses en el eje vertical. En la vista <strong>DIARIA</strong>, cada punto representa un día del mes y permite observar la variación temporal con más detalle. En la vista <strong>MENSUAL</strong>, cada punto representa el valor agregado de un mes y año.</p>
          <p>El color de los puntos representa el valor de la variable seleccionada: temperatura o salinidad. La posición dentro de la escala de color permite comparar los valores entre las diferentes fechas y regiones. La intensidad del halo alrededor de los puntos representa la <strong>desviación estándar</strong> de las observaciones disponibles para ese periodo y celda: un halo más grande indica una dispersión más elevada de los valores.</p>
          <p>También se puede escoger entre <strong>promedio y mediana</strong> para modificar el estadístico utilizado para representar el valor central de las observaciones. La mediana permite reducir la influencia de valores extremos, mientras que el promedio representa el valor medio de las observaciones.</p>
          <p>El selector de profundidad permite explorar diferentes estratos de la columna de agua: <strong>0–200 m, 200–500 m, 500–1000 m, 1000–1500 m y 1500–2000 m</strong>. Esto permite comparar cómo varía la distribución de temperatura y salinidad según la profundidad.</p>`,

        limits:`<h3>Limitaciones e interpretación de las observaciones</h3>
          <p>Los puntos representan estadísticos calculados a partir de los perfiles Argo disponibles para una determinada celda geográfica, periodo temporal e intervalo de profundidad. Por tanto, no representan una medida continua de todo el océano ni una observación realizada exactamente en el centro de cada celda.</p>
          <p>La cobertura de los datos depende de la distribución de los flotadores Argo y de la disponibilidad de perfiles en cada región, profundidad y momento del periodo estudiado. Una celda con menos observaciones puede presentar una representación estadística menos robusta que una celda con un número más elevado de perfiles.</p>
          <p>La <strong>desviación estándar</strong> muestra la dispersión de los valores disponibles dentro de la agrupación seleccionada, pero no representa directamente la incertidumbre de la medida ni un intervalo de confianza. Un halo más grande indica una mayor variabilidad entre las observaciones agrupadas.</p>
          <p>El promedio y la mediana pueden producir resultados diferentes, especialmente cuando existen distribuciones asimétricas o valores extremos. Por este motivo, la selección de uno u otro estadístico modifica la interpretación del valor representado.</p>
          <p>Los días o periodos sin datos no indican necesariamente la ausencia de la variable en el océano, sino la falta de perfiles disponibles que cumplan los criterios de selección para esa combinación de región, profundidad y fecha.</p>
          <p>La visualización permite identificar patrones temporales y espaciales en los datos Argo disponibles, pero no debe interpretarse como una reconstrucción continua del estado de todo el Atlántico ni como una estimación directa de la circulación oceánica.</p>`,

        source:`<h3>Fuente de los datos y de los contenidos</h3>
          <p><strong>Datos oceanográficos:</strong> <strong>webODV / Ocean Data View</strong>. El archivo utilizado para esta versión fue generado mediante webODV a partir de la colección <code>Argo_Atlantic_Profiles.odv</code> y exportado en formato NetCDF4.</p>
          <p><strong>Identificación del archivo:</strong> <code>webodv_11-19-2026_989SFA0w840F.nc</code>. El propio NetCDF identifica el software como <strong>Web Ocean Data View 5.8.6.4</strong>, el tipo de datos como <strong>Profiles</strong> y la característica como <strong>profile</strong>.</p>
          <p><strong>Contenido:</strong> perfiles Argo del Atlántico con posición, fecha, presión, temperatura y salinidad, además de variables de control de calidad y metadatos de plataforma.</p>
          <p><strong>Procesamiento:</strong> para que el navegador no tenga que abrir el NetCDF original de varios gigabytes, los perfiles se procesan previamente por bloques y se agregan en una cuadrícula de <strong>5° × 5°</strong>, cinco intervalos de profundidad y resolución temporal diaria. La aplicación carga únicamente los datos agregados necesarios.</p>
          <p><strong>Variables científicas utilizadas:</strong> <code>Pressure_adjusted_</code>, <code>Temperature_adjusted_</code> y <code>Practical_Salinity_adjusted_</code>. La profundidad se clasifica por presión en los intervalos mostrados por la aplicación.</p>
          <p><strong>Importante:</strong> los puntos representan estadísticas de los perfiles disponibles para cada combinación de fecha, celda geográfica y profundidad. No representan una observación continua del océano ni una medición exactamente en el centro de cada celda.</p>`,

        filters:`<h3>Archivo original y tratamiento de los datos</h3>
          <p><strong>Archivo original:</strong> los archivos NetCDF descargados mediante el Euro-Argo Data Selection Tool constituyen los datos de origen de la visualización. Estos archivos contienen los perfiles oceanográficos Argo con información sobre la posición, la fecha, la profundidad, la temperatura y la salinidad.</p>
          <p>Para preparar la visualización, los datos se procesaron y agruparon espacialmente en una cuadrícula regular de <strong>5° × 5°</strong>. También se agruparon temporalmente según el año, el mes y el día, de manera que se pudieran generar las dos resoluciones temporales disponibles en la aplicación: <strong>diaria y mensual</strong>.</p>
          <p>Para cada combinación de celda geográfica, intervalo de profundidad y periodo temporal se calcularon estadísticos descriptivos de las variables seleccionadas. Entre estos estadísticos se encuentran el <strong>promedio, la mediana, la desviación estándar, los cuartiles y el número de observaciones y perfiles disponibles</strong>.</p>
          <p>La visualización mensual resume las observaciones disponibles para cada mes y año, mientras que la visualización diaria conserva una resolución temporal más detallada y representa los diferentes días de cada mes.</p>
          <p>Los valores calculados se incorporaron a un conjunto de datos derivado utilizado directamente por la aplicación web. De esta manera, el navegador no tiene que procesar los archivos NetCDF originales, sino que consulta los datos estadísticos previamente preparados para la visualización.</p>
          <p>La selección de las celdas geográficas, la profundidad, la variable y el estadístico se realiza de manera interactiva dentro de la aplicación. Los valores mostrados corresponden, por tanto, a las observaciones disponibles después de aplicar estos filtros.</p>`
      };
      $("#info-panel").innerHTML=content[state.info];
      $("#info-panel").classList.add("open");
    }));
  }

  function setupLegendDrag(){
    const track=$("#legend-track"), marker=$("#legend-marker");
    let dragging=false;
    function setFromEvent(e){
      const r=track.getBoundingClientRect();
      state.center=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      updateLegend(); renderMatrix();
    }
    marker.addEventListener("pointerdown",e=>{dragging=true;marker.setPointerCapture(e.pointerId);});
    marker.addEventListener("pointermove",e=>{if(dragging)setFromEvent(e);});
    marker.addEventListener("pointerup",()=>dragging=false);
    track.addEventListener("pointerdown",e=>setFromEvent(e));
    marker.addEventListener("dblclick",()=>{state.center=.5;updateLegend();renderMatrix();});
  }

  async function init(){
    await loadDataSource();
    allMapCells().forEach(c=>state.selectedCells.add(key(c.lat,c.lon)));
    setupControls();
    setupTheme();
    renderMap();
    renderDepth();
    updateLegend();
    renderMatrix();
    updateStatus();
    setupLegendDrag();
  }

  init();
})();

