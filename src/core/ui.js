export const DockNavigation = {
  tabs: [
    { id: 'today', label: 'Pulse', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>' },
    { id: 'diary', label: 'Fuel', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>' },
    { id: 'endurance', label: 'GPS', icon: '<polygon stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="3 11 22 2 13 21 11 13 3 11"/>' },
    { id: 'train', label: 'Train', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18h12M6 6h12M4 12h16M2 9v6M22 9v6"/>' },
    { id: 'photos', label: 'Stats', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 20V10M12 20V4M6 20v-6"/>' }
  ],
  activeTab: 'train',

  renderDock(container, onTabSelect) {
    let dock = document.getElementById('fluidMagnificationDock');
    if (!dock) {
      dock = document.createElement('nav');
      dock.id = 'fluidMagnificationDock';
      dock.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 w-[92%] max-w-[340px] h-[72px] glass-card rounded-full px-3 flex items-center justify-between z-50 shadow-[0_10px_35px_rgba(0,0,0,0.9)] touch-none';
      document.body.appendChild(dock);
    }

    dock.innerHTML = this.tabs.map(tab => {
      const isActive = tab.id === this.activeTab;
      return `
        <div data-tab="${tab.id}" class="dock-item relative flex flex-col items-center justify-center cursor-pointer transition-all duration-150 ease-out" style="width: 44px; height: 44px;">
          <div class="dock-icon-box w-10 h-10 rounded-full flex items-center justify-center transition-all ${isActive ? 'bg-[#00F59B] text-black shadow-[0_0_20px_rgba(0,245,155,0.4)]' : 'text-slate-500 hover:text-slate-300'}">
            <svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">${tab.icon}</svg>
          </div>
        </div>
      `;
    }).join('');

    this.bindMagnificationPhysics(dock, onTabSelect);
  },

  bindMagnificationPhysics(dock, onTabSelect) {
    const items = dock.querySelectorAll('.dock-item');
    const resetMagnification = () => {
      items.forEach(item => {
        const iconBox = item.querySelector('.dock-icon-box');
        const isSelected = item.dataset.tab === this.activeTab;
        iconBox.style.transform = isSelected ? 'scale(1.25) translateY(-4px)' : 'scale(1) translateY(0px)';
      });
    };

    const applyMagnification = (clientX) => {
      const rect = dock.getBoundingClientRect();
      const touchX = clientX - rect.left;
      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const itemCenterX = itemRect.left - rect.left + itemRect.width / 2;
        const dist = Math.abs(touchX - itemCenterX);
        const sigma = 45;
        const scale = 1 + 0.42 * Math.exp(-(dist * dist) / (2 * sigma * sigma));
        const lift = -6 * Math.exp(-(dist * dist) / (2 * sigma * sigma));
        const iconBox = item.querySelector('.dock-icon-box');
        iconBox.style.transform = `scale(${scale}) translateY(${lift}px)`;
      });
    };

    dock.onpointermove = (e) => applyMagnification(e.clientX);
    dock.onpointerleave = () => resetMagnification();
    
    items.forEach(item => {
      item.onpointerdown = () => {
        if (navigator.vibrate) navigator.vibrate(20);
        this.activeTab = item.dataset.tab;
        onTabSelect(this.activeTab);
        resetMagnification();
      };
    });
    resetMagnification();
  }
};