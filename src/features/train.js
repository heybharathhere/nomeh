import { db } from '../db/database.js';

export const TrainFeature = {
  activeSession: null,
  timerInterval: null,
  speechSynth: window.speechSynthesis,
  audioCtx: null,

  exercises: {
    pushup: {
      name: 'Push-ups',
      svg: `<svg viewBox="0 0 100 60" class="w-full h-28 stroke-[#7B61FF] fill-none stroke-2 stroke-linecap-round"><path d="M 20 45 L 35 40 L 65 38 L 80 48" class="animate-pulse" /><circle cx="82" cy="46" r="4" class="fill-[#7B61FF]" /><line x1="20" y1="45" x2="25" y2="52" /><line x1="65" y1="38" x2="68" y2="52" /></svg>`
    },
    squat: {
      name: 'Bodyweight Squats',
      svg: `<svg viewBox="0 0 60 100" class="w-full h-28 stroke-[#7B61FF] fill-none stroke-2 stroke-linecap-round"><circle cx="30" cy="20" r="5" class="fill-[#7B61FF]" /><path d="M 30 25 L 30 50 L 15 65 L 12 85" class="animate-bounce" /><path d="M 30 50 L 45 65 L 48 85" class="animate-bounce" /></svg>`
    }
  },

  playBeep(freq = 880, duration = 0.12) {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.frequency.value = freq;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {}
  },

  speak(text) {
    if (!this.speechSynth) return;
    this.speechSynth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    this.speechSynth.speak(utterance);
  },

  startWorkout(exerciseKey, workSec = 40, restSec = 20, totalSets = 4) {
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {});
    this.activeSession = { exerciseKey, state: 'WORK', currentSet: 1, totalSets, workSec, restSec, timeLeft: workSec };
    this.speak("Starting set 1. Go!");
    this.playBeep(880, 0.2);
  },

  tickTimer(onUpdate) {
    if (!this.activeSession) return;
    const s = this.activeSession;
    if (s.timeLeft > 1) {
      s.timeLeft--;
      if (s.timeLeft <= 3) {
        this.playBeep(587, 0.08);
        if (s.state === 'REST') this.speak(`${s.timeLeft}`);
      }
    } else {
      if (navigator.vibrate) navigator.vibrate([150, 50, 150]);
      if (s.state === 'WORK') {
        if (s.currentSet >= s.totalSets) {
          this.speak("Workout complete! Outstanding effort.");
          this.activeSession = null;
          clearInterval(this.timerInterval);
          onUpdate();
          return;
        }
        s.state = 'REST';
        s.timeLeft = s.restSec;
        this.speak(`Rest. Take ${s.restSec} seconds.`);
        this.playBeep(440, 0.3);
      } else {
        s.state = 'WORK';
        s.currentSet++;
        s.timeLeft = s.workSec;
        this.speak(`Set ${s.currentSet}. Begin!`);
        this.playBeep(880, 0.3);
      }
    }
    onUpdate();
  },

  render(container) {
    const s = this.activeSession;
    const currentEx = s ? this.exercises[s.exerciseKey] : null;

    container.innerHTML = `
      <div class="space-y-4 select-none">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-[10px] font-mono tracking-widest text-[#7B61FF] uppercase">CALISTHENICS & STRENGTH</span>
            <h2 class="font-syne text-2xl font-bold text-white">${s ? (s.state === 'WORK' ? 'Work Interval' : 'Resting') : 'Training Hub'}</h2>
          </div>
          ${s ? `<span class="px-3 py-1 rounded-full text-xs font-mono font-bold bg-[#7B61FF]/20 text-[#7B61FF] border border-[#7B61FF]/40">SET ${s.currentSet}/${s.totalSets}</span>` : ''}
        </div>

        <div class="glass-card rounded-[32px] p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
          <div class="w-full flex justify-center py-2">${s ? currentEx.svg : this.exercises.pushup.svg}</div>
          ${s ? `
            <div class="font-syne text-6xl font-black text-white mt-2 tracking-tight">
              ${s.timeLeft}<span class="text-lg font-mono font-normal text-slate-500">s</span>
            </div>
            <div class="w-full bg-black/60 h-2 rounded-full mt-4 overflow-hidden border border-white/5">
              <div class="h-full ${s.state === 'WORK' ? 'bg-[#7B61FF]' : 'bg-[#00F59B]'} transition-all duration-1000" style="width: ${(s.timeLeft / (s.state === 'WORK' ? s.workSec : s.restSec)) * 100}%"></div>
            </div>
          ` : `
            <p class="text-xs text-slate-400 text-center mt-2">Pick an exercise below to begin with automated voice & audio pacing.</p>
          `}
        </div>

        ${!s ? `
          <div class="grid grid-cols-1 gap-2.5">
            <button data-ex="pushup" class="ex-start-btn glass-card p-4 rounded-2xl flex items-center justify-between border border-white/10 active:scale-[0.98] transition-all">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-[#7B61FF]/20 flex items-center justify-center text-[#7B61FF] font-bold text-xs">REP</div>
                <div class="text-left">
                  <div class="font-syne text-sm font-bold text-white">Push-ups</div>
                  <div class="text-[11px] text-slate-400">Chest, Anterior Delts • 4 Sets x 40s</div>
                </div>
              </div>
              <span class="text-[#7B61FF] text-xs font-mono font-bold">START →</span>
            </button>
            <button data-ex="squat" class="ex-start-btn glass-card p-4 rounded-2xl flex items-center justify-between border border-white/10 active:scale-[0.98] transition-all">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-[#00F59B]/20 flex items-center justify-center text-[#00F59B] font-bold text-xs">LEG</div>
                <div class="text-left">
                  <div class="font-syne text-sm font-bold text-white">Bodyweight Squats</div>
                  <div class="text-[11px] text-slate-400">Quads, Glutes • 4 Sets x 40s</div>
                </div>
              </div>
              <span class="text-[#00F59B] text-xs font-mono font-bold">START →</span>
            </button>
          </div>
        ` : `
          <button id="cancelWorkoutBtn" class="w-full py-3.5 rounded-2xl bg-[#FF3B5C]/10 border border-[#FF3B5C]/30 text-[#FF3B5C] font-syne font-bold text-xs uppercase tracking-wider active:scale-95 transition-all">
            Terminate Routine
          </button>
        `}
      </div>
    `;

    container.querySelectorAll('.ex-start-btn').forEach(btn => {
      btn.onclick = () => {
        this.startWorkout(btn.dataset.ex, 40, 20, 4);
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.tickTimer(() => this.render(container)), 1000);
        this.render(container);
      };
    });

    const cancelBtn = container.querySelector('#cancelWorkoutBtn');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        clearInterval(this.timerInterval);
        this.activeSession = null;
        this.render(container);
      };
    }
  }
};