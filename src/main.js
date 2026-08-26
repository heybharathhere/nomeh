import { initializeDatabase } from './db/database.js';
import { DockNavigation } from './core/ui.js';
import { TrainFeature } from './features/train.js';
import { PhotosFeature } from './features/photos.js';
import { EnduranceFeature } from './features/endurance.js';
import { TodayFeature } from './features/today.js';
import { DiaryFeature } from './features/diary.js';

async function bootstrap() {
  await initializeDatabase();
  const appRoot = document.getElementById('app');

  const renderTab = (tabId) => {
    if (!appRoot) return;
    appRoot.innerHTML = '';
    
    switch (tabId) {
      case 'today':
        TodayFeature.render(appRoot);
        break;
      case 'diary':
        DiaryFeature.render(appRoot);
        break;
      case 'endurance':
        EnduranceFeature.render(appRoot);
        break;
      case 'train':
        TrainFeature.render(appRoot);
        break;
      case 'photos':
        PhotosFeature.render(appRoot);
        break;
      default:
        TrainFeature.render(appRoot);
    }
  };

  DockNavigation.renderDock(document.body, (tab) => renderTab(tab));
  renderTab('train');
}

document.addEventListener('DOMContentLoaded', bootstrap);