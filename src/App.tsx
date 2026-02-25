import { useState, useEffect, useCallback, useRef } from 'react';
import { Minus, Plus, Activity, Droplets, Clock, RefreshCw, Volume2, VolumeX, Play, Square, Target } from 'lucide-react';

export default function App() {
    // === 基本設定ステート ===
    const [volume, setVolume] = useState<number>(500); // 総輸液量 (mL)
    const [time, setTime] = useState<number>(24);      // 予定時間 (h)
    const [dripFactor, setDripFactor] = useState<20 | 60>(20); // 輸液セット (滴/mL)

    // === タップ計測ステート ===
    // tapTimesは直近5回のタイムスタンプ保持用 (画面描画には使わないのでRefでも良いがState維持)
    const [_tapTimes, setTapTimes] = useState<number[]>([]);
    const [measuredDrops, setMeasuredDrops] = useState<number | null>(null);

    // === 新機能: モードとコントロールステート ===
    const [activeMode, setActiveMode] = useState<'target' | 'measured'>('target');
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [syncTrigger, setSyncTrigger] = useState<number>(0);

    // === メトロノーム・エフェクトステート ===
    const [flash, setFlash] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(false);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // 波紋エフェクト用
    const [ripples, setRipples] = useState<{ id: number; active: boolean }[]>([]);
    const rippleIdCounter = useRef(0);

    // === 計算処理 ===
    const flowRate = volume / time;
    const targetDropsPerMin = (flowRate * dripFactor) / 60;
    const targetDropsPer10Sec = targetDropsPerMin / 6;

    // 現在メトロノームで使うべき滴下数（実測モードで未計測なら仮で目標値を入れるか保護する）
    const currentDropsPerMin = activeMode === 'target'
        ? targetDropsPerMin
        : (measuredDrops || 0);

    // === 音声再生関数の初期化 ===
    const playBeep = useCallback(() => {
        if (!soundEnabled) return;

        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        // 聴き取りやすい高いピッチの電子音
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);

        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
    }, [soundEnabled]);

    // === 波紋エフェクト追加関数 ===
    const triggerRipple = useCallback(() => {
        const id = rippleIdCounter.current++;
        setRipples(prev => [...prev.slice(-4), { id, active: true }]);

        setTimeout(() => {
            setRipples(prev => prev.filter(r => r.id !== id));
        }, 1000);
    }, []);

    // === ビジュアル＆サウンド発火関数 ===
    const fireMetronomeTick = useCallback(() => {
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
        if (soundEnabled) playBeep();
        triggerRipple();
    }, [soundEnabled, playBeep, triggerRipple]);

    // === メトロノーム・ループ (START/STOP & 同期管理) ===
    useEffect(() => {
        if (!isPlaying || currentDropsPerMin <= 0 || !isFinite(currentDropsPerMin)) return;

        const intervalMs = (60 / currentDropsPerMin) * 1000;

        if (intervalMs < 100) return; // 負荷制限

        // START直後、またはTAP同期直後に1回即座に鳴らす（syncTriggerの変更時）
        // 連続発火を防ぐフラグとして機能させることも可能だが、ここではシンプルにする

        const timer = setInterval(() => {
            fireMetronomeTick();
        }, intervalMs);

        return () => clearInterval(timer);
    }, [isPlaying, currentDropsPerMin, syncTrigger, fireMetronomeTick]);

    // === サウンドトグルのハンドラー ===
    const toggleSound = () => {
        const nextState = !soundEnabled;
        setSoundEnabled(nextState);
        if (nextState) {
            if (!audioCtxRef.current) {
                audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            if (audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
            }
            // User gesture audio initialization
            const ctx = audioCtxRef.current;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.01;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.01);
        }
    };

    // === タップ計測処理 ===
    const handleTap = useCallback((e?: React.MouseEvent | React.TouchEvent | any) => {
        if (e && e.preventDefault && e.type === 'touchstart') {
            // passive warning対策
        }

        const timestamp = Date.now();

        // 1. 強制的にメトロノームを発火＆同期リセットさせる
        fireMetronomeTick();
        if (isPlaying) {
            setSyncTrigger(timestamp); // これにより useEffect 内の setInterval が再生成(同期)される
        }

        // 2. 実測レートの計算更新
        setTapTimes((prev) => {
            const newTimes = [...prev, timestamp].slice(-5); // 直近5回を保存
            if (newTimes.length >= 2) {
                let totalDiff = 0;
                for (let i = 1; i < newTimes.length; i++) {
                    totalDiff += newTimes[i] - newTimes[i - 1];
                }
                const avgIntervalMs = totalDiff / (newTimes.length - 1);
                if (avgIntervalMs > 0) {
                    setMeasuredDrops(Math.round(60000 / avgIntervalMs));
                }
            }
            return newTimes;
        });
    }, [fireMetronomeTick, isPlaying]);

    const resetTap = () => {
        setTapTimes([]);
        setMeasuredDrops(null);
        if (activeMode === 'measured') {
            setIsPlaying(false); // 計測データがない場合は停止
        }
    };

    // === UI ヘルパー ===
    const AdjustButton = ({ onClick, icon: Icon, disabled = false }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-12 h-12 flex items-center justify-center bg-gray-800 rounded-2xl hover:bg-gray-700 active:bg-gray-600 active:scale-95 transition-all text-gray-300 disabled:opacity-50 disabled:active:scale-100 flex-shrink-0 touch-manipulation shadow-md"
        >
            <Icon size={20} />
        </button>
    );

    // テーマカラー（モード別）
    const themeColor = activeMode === 'target' ? 'indigo' : 'purple';
    const bgGradient = activeMode === 'target'
        ? 'radial-gradient(circle at 50% 10%, rgba(99,102,241,0.5) 0%, transparent 70%)'
        : 'radial-gradient(circle at 50% 10%, rgba(168,85,247,0.5) 0%, transparent 70%)';

    return (
        <div className={`min-h-[100dvh] w-full flex flex-col font-sans max-w-md mx-auto relative shadow-2xl transition-colors duration-500 ${isPlaying ? 'bg-gray-900' : 'bg-gray-950'}`}>
            {/* 動的グラデーション背景（フラッシュ・モード連動） */}
            <div
                className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ${flash ? 'opacity-30' : (isPlaying ? 'opacity-5' : 'opacity-0')}`}
                style={{ background: bgGradient }}
            />

            {/* ヘッダー */}
            <header className="px-5 py-4 flex items-center justify-between relative z-10 border-b border-gray-800/50 bg-gray-900/80 backdrop-blur-md">
                <div className="flex flex-col">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 tracking-tight">
                        点滴リズム計算
                    </h1>
                </div>
                <button
                    onClick={toggleSound}
                    className={`p-3 rounded-full transition-all duration-300 ${soundEnabled ? 'bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    aria-label={soundEnabled ? "音量をオフにする" : "音量をオンにする"}
                >
                    {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
                </button>
            </header>

            {/* メインコンテンツ */}
            <main className="flex-1 px-5 py-6 space-y-6 relative z-10 flex flex-col">

                {/* === メイン情報：計算結果リズム === */}
                <div className={`relative backdrop-blur-xl rounded-3xl p-6 border shadow-2xl overflow-hidden transition-all duration-300 ${activeMode === 'target' ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-gray-800/40 border-gray-700/50'}`}>
                    {/* フラッシュ用トップボーダー */}
                    <div className={`absolute top-0 left-0 w-full h-1 transition-colors duration-100 ${flash && activeMode === 'target' ? 'bg-indigo-400 shadow-[0_0_20px_rgba(99,102,241,1)]' : 'bg-transparent'}`} />

                    <div className="flex justify-between items-center mb-4">
                        <p className="text-gray-400 text-sm font-medium flex items-center gap-2">
                            <Target size={16} className={activeMode === 'target' ? 'text-indigo-400' : 'text-gray-500'} />
                            目標レート（計算値）
                        </p>
                        <span className="text-xs font-bold px-2 py-1 rounded bg-gray-800 text-gray-400">計算値</span>
                    </div>

                    <div className="flex justify-between items-end gap-2 text-left mb-2">
                        <div className="flex-1">
                            <p className="text-4xl font-black text-white tracking-tight">
                                {isFinite(targetDropsPerMin) ? targetDropsPerMin.toFixed(1) : '0'} <span className="text-base font-normal text-gray-400 ml-1 tracking-normal">滴/分</span>
                            </p>
                        </div>
                        <div className="w-px h-8 bg-gray-700/50 mx-2" />
                        <div className="flex-1 text-right">
                            <p className="text-xl font-bold text-indigo-400 opacity-80">
                                {isFinite(targetDropsPer10Sec) ? targetDropsPer10Sec.toFixed(1) : '0'} <span className="text-xs font-normal text-gray-400 ml-1">滴／10秒</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* === モード切替セグメントコントロール === */}
                <div className="bg-gray-900/80 p-1.5 rounded-2xl flex relative border border-gray-800/80 shadow-inner">
                    <button
                        onClick={() => setActiveMode('target')}
                        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 z-10 ${activeMode === 'target' ? 'text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        目標レート（計算値）
                    </button>
                    <button
                        onClick={() => {
                            if (!measuredDrops) {
                                alert("先に下のTAPボタンで実測レートを計測してください。");
                                return;
                            }
                            setActiveMode('measured')
                        }}
                        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 z-10 ${activeMode === 'measured' ? 'text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        実測レート（TAP値）
                    </button>
                    {/* アクティブ背景のピル */}
                    <div
                        className={`absolute top-1.5 bottom-1.5 w-[calc(50%-0.375rem)] rounded-xl transition-all duration-300 ease-out-expo ${activeMode === 'target' ? 'left-1.5 bg-indigo-600' : 'left-[calc(50%+0.375rem)] bg-purple-600'}`}
                    />
                </div>

                {/* 実測モードに関する操作ガイド */}
                <p className="text-center text-[11px] text-gray-500 font-medium px-2 mt-[-0.5rem] mb-2 leading-relaxed">
                    ※実測モード用の「TAP」ボタンは画面最下部にあります。<br />
                    先にTAP計測を行ってからモードを切り替え、開始してください。
                </p>

                {/* === START/STOP メインコントロール === */}
                <div className="flex justify-center py-2">
                    <button
                        onClick={() => {
                            if (!isPlaying && activeMode === 'measured' && !measuredDrops) {
                                alert("先に下のTAPボタンで実測レートを計測してください。");
                                return;
                            }
                            setIsPlaying(!isPlaying);
                            if (!isPlaying) {
                                // スタート時に即座に一回鳴らす/光らせるための同期トリガー
                                setSyncTrigger(Date.now());
                                fireMetronomeTick();
                            }
                        }}
                        className={`w-48 h-16 rounded-3xl flex items-center justify-center gap-3 text-xl font-bold transition-all duration-300 border-2 shadow-xl active:scale-95 ${isPlaying
                            ? "bg-gray-800/80 border-gray-600 text-gray-300 shadow-none"
                            : `bg-gradient-to-r from-${themeColor}-500 to-${themeColor}-600 border-${themeColor}-400/50 text-white shadow-${themeColor}-500/20`
                            }`}
                    >
                        {isPlaying ? (
                            <>
                                <Square size={24} className="fill-current" />
                                リズム停止
                            </>
                        ) : (
                            <>
                                <Play size={24} className="fill-current ml-1" />
                                リズム開始
                            </>
                        )}
                    </button>
                </div>

                {/* === 入力フォームエリア (ターゲットモードでのみ重要性が高いが常に表示) === */}
                <div className={`space-y-4 transition-all duration-300 ${isPlaying ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}>
                    <div className="bg-gray-800/40 rounded-3xl p-5 border border-gray-700/30">
                        <div className="flex items-center space-x-2 mb-4">
                            <Droplets size={16} className="text-blue-400" />
                            <label className="text-sm font-medium text-gray-400">総輸液量 (mL)</label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <AdjustButton icon={Minus} onClick={() => setVolume(v => Math.max(0, v - 50))} />
                            <input
                                type="number"
                                value={volume || ''}
                                onChange={(e) => setVolume(Number(e.target.value))}
                                className="flex-1 min-w-0 w-full bg-gray-900/80 text-white text-center text-2xl font-black rounded-xl py-3 px-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner block"
                            />
                            <AdjustButton icon={Plus} onClick={() => setVolume(v => v + 50)} />
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="bg-gray-800/40 rounded-3xl p-5 border border-gray-700/30 flex-1">
                            <div className="flex items-center space-x-2 mb-4">
                                <Clock size={16} className="text-green-400" />
                                <label className="text-sm font-medium text-gray-400">時間 (h)</label>
                            </div>
                            <input
                                type="number"
                                step="0.5"
                                value={time || ''}
                                onChange={(e) => setTime(Number(e.target.value))}
                                className="w-full min-w-0 bg-gray-900/80 text-white text-center text-2xl font-bold rounded-xl py-3 px-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner block"
                            />
                        </div>

                        <div className="bg-gray-800/40 rounded-3xl p-5 border border-gray-700/30 flex-1 flex flex-col justify-center">
                            <label className="text-sm font-medium text-gray-400 mb-4">輸液セット</label>
                            <div className="flex bg-gray-900/80 rounded-2xl p-1 shadow-inner w-full">
                                <button
                                    onClick={() => setDripFactor(20)}
                                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${dripFactor === 20 ? 'bg-indigo-500 text-white shadow-md' : 'text-gray-500'}`}
                                >
                                    20
                                </button>
                                <button
                                    onClick={() => setDripFactor(60)}
                                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${dripFactor === 60 ? 'bg-indigo-500 text-white shadow-md' : 'text-gray-500'}`}
                                >
                                    60
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="h-4" /> {/* Spacer */}
            </main>

            {/* === フッター: 片手操作用タップ計測エリア (スクロール表示) === */}
            <div className={`relative z-20 backdrop-blur-2xl border-t p-5 pt-6 pb-safe rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-colors duration-300 ${activeMode === 'measured' ? 'bg-purple-900/10 border-purple-500/20' : 'bg-gray-800/90 border-gray-700/50'}`}>

                {/* フラッシュ用トップボーダー（実測モード時） */}
                <div className={`absolute top-0 left-0 w-full h-1 rounded-t-[2.5rem] transition-colors duration-100 ${flash && activeMode === 'measured' ? 'bg-purple-400 shadow-[0_0_20px_rgba(168,85,247,1)]' : 'bg-transparent'}`} />

                <div className="flex justify-between items-center mb-5 px-2">
                    <div>
                        <h2 className="text-xs font-semibold uppercase tracking-wider mb-1 flex items-center gap-2 text-gray-400">
                            <Activity size={14} className={activeMode === 'measured' ? 'text-purple-400' : ''} />
                            現在の実測値
                        </h2>
                        <div className="flex items-baseline gap-2">
                            <span className={`text-4xl font-black tracking-tighter ${measuredDrops ? 'text-white' : 'text-gray-600'}`}>
                                {measuredDrops !== null ? measuredDrops : '--'}
                            </span>
                            <span className="text-gray-500 text-sm font-medium">滴/分</span>
                        </div>
                    </div>
                    <button
                        onClick={resetTap}
                        className="p-3 bg-gray-900/50 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors border border-gray-600/30"
                        aria-label="タップ計測をリセット"
                    >
                        <RefreshCw size={20} />
                    </button>
                </div>

                {/* モード操作ガイド（下部へ移動） */}
                <p className="text-center text-xs text-gray-400 font-medium mb-3 px-2">
                    ※「実測」モードでは、このTAPボタンで計測したリズムが反映されます。
                </p>

                {/* タップ領域 (波紋エフェクトコンテナ) */}
                <div
                    className={`relative w-full h-28 rounded-[2rem] overflow-hidden border cursor-pointer select-none transition-colors duration-300 flex flex-col items-center justify-center ${activeMode === 'measured' ? 'bg-purple-950/40 border-purple-500/30' : 'bg-gray-900 border-gray-700/50'}`}
                    onTouchStart={handleTap}
                    onMouseDown={handleTap}
                    style={{ touchAction: 'manipulation' }}
                >
                    {/* 波紋アニメーション要素 */}
                    {ripples.map(ripple => (
                        <div
                            key={ripple.id}
                            className={`absolute inset-0 m-auto w-16 h-16 rounded-full pointer-events-none animate-ripple ${activeMode === 'target' ? 'bg-indigo-500/40' : 'bg-purple-500/40'}`}
                        />
                    ))}

                    {/* タップボタンUI本体 */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <Activity size={32} className={`mb-1 transition-colors duration-150 ${flash ? (activeMode === 'target' ? 'text-indigo-300' : 'text-purple-300') : 'text-gray-600'}`} />
                        <span className="text-xl font-black tracking-[0.2em] text-white/90">TAP</span>
                    </div>
                </div>

                {/* 免責事項 */}
                <p className="text-[10px] text-gray-500/40 text-center mt-5 mb-1 leading-relaxed select-none pointer-events-none px-2">
                    本アプリは計算補助ツールです。実際の投与速度や設定は、必ず医療従事者の責任において最終確認を行ってください。
                </p>
            </div>
        </div>
    );
}
