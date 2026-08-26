export const EnduranceFeature = {
  map: null,
  render(container) {
    container.innerHTML = `
      <div class="space-y-4 select-none">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-[10px] font-mono tracking-widest text-[#00F59B] uppercase">OUTDOOR HUD</span>
            <h2 class="font-syne text-xl font-bold text-white">GPS Endurance</h2>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#00F59B]/20 text-[#00F59B] border border-[#00F59B]/30">GPS ACTIVE</span>
        </div>

        <div id="leafletMap" class="w-full h-64 rounded-3xl overflow-hidden border border-white/10 z-0"></div>

        <div class="grid grid-cols-2 gap-3">
          <div class="glass-card p-4 rounded-2xl">
            <span class="text-[10px] font-mono text-slate-400 uppercase">DISTANCE</span>
            <div class="font-syne text-2xl font-bold text-white mt-1">10.19 <span class="text-xs font-normal text-[#00F59B]">KM</span></div>
          </div>
          <div class="glass-card p-4 rounded-2xl">
            <span class="text-[10px] font-mono text-slate-400 uppercase">AVG PACE</span>
            <div class="font-syne text-2xl font-bold text-white mt-1">5:24 <span class="text-xs font-normal text-[#00F59B]">/KM</span></div>
          </div>
        </div>

        <button id="toggleGpsBtn" class="w-full py-4 rounded-2xl bg-[#00F59B] text-black font-syne font-black text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(0,245,155,0.4)] active:scale-95 transition-all">
          Start Live Tracking
        </button>
      </div>
    `;
    setTimeout(() => this.initMap(container), 100);
  },

  initMap(container) {
    const mapEl = container.querySelector('#leafletMap');
    if (!mapEl || !window.L) return;
    this.map = L.map('leafletMap', { zoomControl: false }).setView([13.0827, 80.2707], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(this.map);
    this.map.invalidateSize();
  }
};