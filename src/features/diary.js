export const DiaryFeature = {
  render(container) {
    container.innerHTML = `
      <div class="space-y-4 select-none">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-[10px] font-mono tracking-widest text-[#FF9E00] uppercase">FUEL & NUTRITION</span>
            <h2 class="font-syne text-xl font-bold text-white">Meal Diary</h2>
          </div>
          <button class="px-3 py-1.5 rounded-xl bg-[#FF9E00] text-black font-syne font-black text-xs active:scale-95 transition-all">
            + LOG FOOD
          </button>
        </div>

        <div class="glass-card p-4 rounded-2xl flex justify-between items-center">
          <div>
            <div class="font-syne text-sm font-bold text-white">Airfried Chicken & Rice</div>
            <div class="text-[11px] text-slate-400">180g Chicken • 1/2 cup Rice • Minimal Oil</div>
          </div>
          <span class="font-mono text-xs text-[#FF9E00] font-bold">540 kcal</span>
        </div>
      </div>
    `;
  }
};