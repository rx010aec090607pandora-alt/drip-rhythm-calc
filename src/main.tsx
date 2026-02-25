import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// PWAのサービスワーカー登録
import { registerSW } from 'virtual:pwa-register';

registerSW({
    onNeedRefresh() {
        // 更新が必要な場合の処理（必要に応じてUIを追加できます）
        console.log('アプリケーションの新しいバージョンが利用可能です。');
    },
    onOfflineReady() {
        // オフライン対応完了時の処理
        console.log('アプリケーションはオフラインで利用可能です。');
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
