import { db } from '../db/database.js';

export const PhotosFeature = {
  stream: null,
  facingMode: 'environment',
  ghostOpacity: 0.4,
  dayOnePhotoUrl: null,

  async render(container) {
    const allPhotos = (await db.progressPhotos.toArray().catch(() => [])) || [];
    const baseline = allPhotos.find(p => p.isBaseline) || allPhotos[0];
    this.dayOnePhotoUrl = baseline ? baseline.dataUrl : null;

    container.innerHTML = `
      <div class="space-y-4 select-none">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-[10px] font-mono tracking-widest text-[#00F59B] uppercase">GHOST VIEWFINDER</span>
            <h2 class="font-syne text-xl font-bold text-white">Physique Progression</h2>
          </div>
          <button id="toggleCameraFacingBtn" class="p-2.5 rounded-2xl glass-card border border-white/10 text-white active:scale-95 transition-all">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          </button>
        </div>

        <div class="relative w-full aspect-[3/4] bg-black rounded-[32px] overflow-hidden border border-white/10 shadow-2xl">
          <video id="cameraFeed" autoplay playsinline muted class="absolute inset-0 w-full h-full object-cover"></video>
          <img id="ghostOverlayImg" src="${this.dayOnePhotoUrl || ''}" class="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ${this.dayOnePhotoUrl ? '' : 'hidden'}" style="opacity: ${this.ghostOpacity}; filter: grayscale(1) contrast(1.2);">
          <div class="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/5">
            <div class="border-r border-b border-white/5"></div><div class="border-r border-b border-white/5"></div><div class="border-b border-white/5"></div>
            <div class="border-r border-b border-white/5"></div><div class="border-r border-b border-white/5 flex items-center justify-center"><div class="w-2.5 h-2.5 rounded-full border border-[#00F59B]/60"></div></div><div class="border-b border-white/5"></div>
            <div class="border-r border-white/5"></div><div class="border-r border-white/5"></div><div></div>
          </div>
          <canvas id="photoCaptureCanvas" class="hidden"></canvas>
        </div>

        ${this.dayOnePhotoUrl ? `
          <div class="glass-card p-3 rounded-2xl flex items-center gap-3">
            <span class="text-[10px] font-mono text-slate-400 uppercase">GHOST</span>
            <input type="range" id="ghostOpacitySlider" min="0" max="1" step="0.05" value="${this.ghostOpacity}" class="w-full accent-[#00F59B] h-1.5 bg-black rounded-lg appearance-none cursor-pointer">
            <span id="ghostPctLabel" class="text-xs font-mono text-[#00F59B] w-8">${Math.round(this.ghostOpacity * 100)}%</span>
          </div>
        ` : ''}

        <div class="flex justify-center pt-1">
          <button id="snapPhotoBtn" class="w-20 h-20 rounded-full border-4 border-[#00F59B] p-1 flex items-center justify-center active:scale-90 transition-transform shadow-[0_0_25px_rgba(0,245,155,0.3)]">
            <div class="w-full h-full bg-white rounded-full"></div>
          </button>
        </div>

        <div id="comparisonContainer" class="pt-2"></div>
      </div>
    `;

    this.bindEvents(container);
    await this.startCamera(container);
    this.renderComparisonSlider(container, allPhotos);
  },

  async startCamera(container) {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    const video = container.querySelector('#cameraFeed');
    if (!video) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      video.srcObject = this.stream;
    } catch (err) {}
  },

  bindEvents(container) {
    const snapBtn = container.querySelector('#snapPhotoBtn');
    const toggleBtn = container.querySelector('#toggleCameraFacingBtn');
    const slider = container.querySelector('#ghostOpacitySlider');
    const ghostImg = container.querySelector('#ghostOverlayImg');
    const ghostPct = container.querySelector('#ghostPctLabel');

    if (slider && ghostImg) {
      slider.oninput = (e) => {
        this.ghostOpacity = e.target.value;
        ghostImg.style.opacity = this.ghostOpacity;
        if (ghostPct) ghostPct.innerText = `${Math.round(this.ghostOpacity * 100)}%`;
      };
    }

    if (toggleBtn) {
      toggleBtn.onclick = async () => {
        this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
        await this.startCamera(container);
      };
    }

    if (snapBtn) snapBtn.onclick = () => this.capturePhoto(container);
  },

  async capturePhoto(container) {
    const video = container.querySelector('#cameraFeed');
    const canvas = container.querySelector('#photoCaptureCanvas');
    if (!video || !canvas) return;

    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1440;
    const ctx = canvas.getContext('2d');
    if (this.facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const compressedWebP = canvas.toDataURL('image/webp', 0.85);
    const count = await db.progressPhotos.count().catch(() => 0);

    await db.progressPhotos.add({
      date: new Date().toISOString(),
      timestamp: Date.now(),
      dataUrl: compressedWebP,
      isBaseline: count === 0
    });

    this.render(container);
  },

  renderComparisonSlider(container, photos) {
    const compBox = container.querySelector('#comparisonContainer');
    if (!compBox || photos.length < 2) return;
    const first = photos[0];
    const latest = photos[photos.length - 1];

    compBox.innerHTML = `
      <div class="glass-card rounded-3xl p-4 space-y-3">
        <span class="text-[10px] font-mono tracking-widest text-[#00F59B] uppercase">DAY 1 VS CURRENT SLIDER</span>
        <div class="relative w-full aspect-[3/4] rounded-2xl overflow-hidden select-none border border-white/10" id="splitSliderBox">
          <img src="${latest.dataUrl}" class="absolute inset-0 w-full h-full object-cover">
          <div id="splitClipper" class="absolute inset-y-0 left-0 overflow-hidden" style="width: 50%;">
            <img src="${first.dataUrl}" class="absolute inset-0 w-full h-full object-cover max-w-none" style="width: 100%;">
          </div>
          <div id="splitDivider" class="absolute inset-y-0 w-0.5 bg-[#00F59B]" style="left: 50%;">
            <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#00F59B] text-black text-[10px] font-black flex items-center justify-center shadow-lg">↔</div>
          </div>
        </div>
      </div>
    `;

    const box = compBox.querySelector('#splitSliderBox');
    const clipper = compBox.querySelector('#splitClipper');
    const divider = compBox.querySelector('#splitDivider');

    const updateSplit = (clientX) => {
      const rect = box.getBoundingClientRect();
      let pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      clipper.style.width = `${pos}%`;
      divider.style.left = `${pos}%`;
    };

    box.onpointermove = (e) => { if (e.buttons === 1) updateSplit(e.clientX); };
    box.onpointerdown = (e) => updateSplit(e.clientX);
  }
};