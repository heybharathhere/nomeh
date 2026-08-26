export const TodayFeature = {
  render(container) {
    container.innerHTML = `
      <div class="space-y-4 select-none">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-[10px] font-mono tracking-widest text-[#FF9E00] uppercase">DAILY METABOLIC COCKPIT</span>
            <h2 class="font-syne text-2xl font-black text-white">Net Energy Balance</h2>
          </div>
        </div>

        <div class="glass-card rounded-[32px] p-6 space-y-4">
          <div class="flex justify-between items-baseline">
            <span class="font-syne text-4xl font-black text-white">1,480 <span class="text-xs font-normal text-slate-400 font-outfit">/ 2,100 kcal</span></span>
            <span class="font-mono text-xs font-bold text-[#00F59B]">+420 KCAL DEFICIT</span>
          </div>

          <div class="w-full h-2 bg-black rounded-full overflow-hidden border border-white/5">
            <div class="h-full bg-[#FF9E00] rounded-full" style="width: 70%;"></div>
          </div>

          <div class="flex justify-between text-xs font-mono text-slate-400 pt-2 border-t border-white/5">
            <span>P: <b class="text-white">140g</b></span>
            <span>C: <b class="text-white">180g</b></span>
            <span>F: <b class="text-white">45g</b></span>
            <span>H₂O: <b class="text-[#00D8F6]">3.2L</b></span>
          </div>
        </div>
      </div>
    `;
  }
};