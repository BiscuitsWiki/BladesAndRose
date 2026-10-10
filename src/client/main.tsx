import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 不使用 StrictMode：boardgame.io 的 Client 是旧式 class 组件，
// 双次挂载会导致重复建立多人连接。
createRoot(document.getElementById('root')!).render(<App />);
