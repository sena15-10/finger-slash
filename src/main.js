import './styles.css';
import view from './view.html?raw';

const app = document.querySelector('#app');
if (!app) throw new Error('Missing application mount point');

app.innerHTML = view;
void import('./game/runtime.js').catch(error => {
  console.error('Failed to start Finger Slash', error);
  app.textContent = 'ゲームを起動できませんでした。ページを再読み込みしてください。';
  throw error;
});
