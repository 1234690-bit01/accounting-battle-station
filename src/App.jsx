import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// 辅助函数：洗牌算法（打乱选项顺序）
const shuffleOptions = (options, correctAnswerStr) => {
  if (!options || options.length === 0) return { shuffledOptions: [], newAnswerStr: correctAnswerStr };
  
  const parsedOptions = options.map(opt => {
    const match = opt.match(/^([A-Z])[\.、]\s*(.*)$/);
    return match ? { originalLabel: match[1], text: match[2], full: opt } : { originalLabel: '', text: opt, full: opt };
  });

  if (parsedOptions.some(o => !o.originalLabel)) return { shuffledOptions: options, newAnswerStr: correctAnswerStr };

  const shuffled = [...parsedOptions].sort(() => Math.random() - 0.5);
  const newOptions = [];
  const oldToNewLabel = {};
  const labels = ['A', 'B', 'C', 'D', 'E', 'F']; 

  shuffled.forEach((opt, index) => {
    const newLabel = labels[index];
    newOptions.push(`${newLabel}. ${opt.text}`);
    oldToNewLabel[opt.originalLabel] = newLabel;
  });

  const answerChars = correctAnswerStr.split('');
  let newAnswerStr = '';
  answerChars.forEach(char => {
    if (oldToNewLabel[char]) newAnswerStr += oldToNewLabel[char];
    else newAnswerStr += char; 
  });

  newAnswerStr = newAnswerStr.split('').sort().join('');
  return { shuffledOptions: newOptions, newAnswerStr };
};

function App() {
  const [username, setUsername] = useState('');
  const [isLogged, setIsLogged] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]);
  
  const [db, setDb] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wrongBank, setWrongBank] = useState([]);
  
  const [showAnswer, setShowAnswer] = useState(false);
  const [inputMode, setInputMode] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [testMode, setTestMode] = useState('all'); 
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [currentDisplayQ, setCurrentDisplayQ] = useState(null);

  // 初始化获取可用章节
  useEffect(() => {
    if (isLogged) {
      const rooms = Object.keys(localStorage).filter(k => k.startsWith('acc_room_')).map(k => k.replace('acc_room_', ''));
      setAvailableRooms(rooms);
    }
  }, [isLogged]);

  // 监听章节切换，加载数据
  useEffect(() => {
    if (!isLogged || !roomCode) return;
    
    let targetData = [];
    if (roomCode === 'RANDOM_ALL') {
      const allRooms = Object.keys(localStorage).filter(k => k.startsWith('acc_room_'));
      allRooms.forEach(key => {
        const roomData = JSON.parse(localStorage.getItem(key) || '[]');
        const chapterName = key.replace('acc_room_', '');
        targetData = targetData.concat(roomData.map(q => ({...q, sourceChapter: chapterName})));
      });
      targetData = targetData.sort(() => Math.random() - 0.5);
    } else {
      targetData = JSON.parse(localStorage.getItem(`acc_room_${roomCode}`) || '[]');
    }

    if (targetData.length > 0) {
      setDb(targetData);
      setInputMode(false);
    } else {
      setDb([]);
      setInputMode(true);
    }

    const savedProgress = JSON.parse(localStorage.getItem(`acc_prog_${username}_${roomCode}`) || '{"index":0, "wrong":[]}');
    setCurrentIndex(savedProgress.index || 0);
    setWrongBank(savedProgress.wrong || []);
    setTestMode('all');
    setShowAnswer(false);
  }, [isLogged, roomCode, username]);

  // 处理题目乱序展示
  useEffect(() => {
      const currentQuestions = testMode === 'all' ? db : wrongBank;
      const rawQ = currentQuestions[currentIndex];

      if (!rawQ) {
          setCurrentDisplayQ(null);
          return;
      }

      if (shuffleEnabled && !showAnswer) {
          const { shuffledOptions, newAnswerStr } = shuffleOptions(rawQ.options, rawQ.a);
          setCurrentDisplayQ({ ...rawQ, displayOptions: shuffledOptions, displayAnswer: newAnswerStr });
      } else if (!shuffleEnabled) {
          setCurrentDisplayQ({ ...rawQ, displayOptions: rawQ.options, displayAnswer: rawQ.a });
      }
  }, [db, wrongBank, currentIndex, testMode, shuffleEnabled, showAnswer]);

  const saveProgress = (newIndex, newWrongBank) => {
    setCurrentIndex(newIndex);
    setWrongBank(newWrongBank);
    localStorage.setItem(`acc_prog_${username}_${roomCode}`, JSON.stringify({ index: newIndex, wrong: newWrongBank }));
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    if (!roomCode) setRoomCode('RANDOM_ALL');
    setUsername(username.trim().toUpperCase());
    setIsLogged(true);
  };

  const loadDataToLocal = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("数据必须是非空数组");
      
      const targetRoom = roomCode === 'RANDOM_ALL' ? '通用题库' : roomCode; 
      localStorage.setItem(`acc_room_${targetRoom}`, JSON.stringify(parsed));
      
      setDb(parsed);
      saveProgress(0, wrongBank); 
      setShowAnswer(false);
      setInputMode(false);
      setErrorMsg('');
      setTestMode('all');
      
      if (!availableRooms.includes(targetRoom)) {
          setAvailableRooms([...availableRooms, targetRoom]);
      }
    } catch (e) {
      setErrorMsg("数据格式错误: " + e.message);
    }
  };

  const handleNext = (isCorrect) => {
    let nextIndex = currentIndex;
    let nextWrongBank = [...wrongBank];
    const rawQ = (testMode === 'all' ? db : wrongBank)[currentIndex];

    if (!isCorrect) {
      if (!nextWrongBank.find(wq => wq.q === rawQ.q)) nextWrongBank.push(rawQ);
    } else if (testMode === 'wrong') {
      nextWrongBank = nextWrongBank.filter(wq => wq.q !== rawQ.q);
      if (nextWrongBank.length === 0) {
        alert("干得漂亮，错题本已清空！");
        setTestMode('all');
        saveProgress(0, nextWrongBank); 
        setShowAnswer(false);
        return;
      }
      if (nextIndex >= nextWrongBank.length) nextIndex = 0;
      saveProgress(nextIndex, nextWrongBank);
      setShowAnswer(false);
      return; 
    }

    if (nextIndex < (testMode === 'all' ? db : wrongBank).length - 1) {
      nextIndex += 1;
    } else {
      alert(testMode === 'all' ? `牛逼，本章节已刷穿！` : "错题复习完毕，下一轮！");
      nextIndex = 0;
    }
    
    if (testMode === 'all') saveProgress(nextIndex, nextWrongBank);
    else { saveProgress(currentIndex, nextWrongBank); setCurrentIndex(nextIndex); }
    setShowAnswer(false);
  };

  if (!isLogged) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
          <div className="text-center mb-8">
             <div className="w-16 h-16 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
             </div>
             <h1 className="text-2xl font-bold mb-2">终极特训基地</h1>
             <p className="text-slate-400 text-sm">本地隔离版 - 随时随地，极速响应。</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none uppercase" value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="你的代号 (如: 张三)" />
            <div>
               {availableRooms.length > 0 ? (
                 <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none text-slate-200" value={roomCode} onChange={(e) => setRoomCode(e.target.value)}>
                   <option value="" disabled>-- 选择已部署章节 --</option>
                   <option value="RANDOM_ALL" className="text-emerald-400 font-bold">🔥 终极打散特训 (全部混合)</option>
                   {availableRooms.map(room => <option key={room} value={room}>{room}</option>)}
                 </select>
               ) : <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg text-slate-500 text-sm">暂无题库，先进入新建。</div>}
            </div>
            <input type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none uppercase" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="或 创建新章节 (如: 经济法第一章)" />
            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-lg shadow-lg">进入特训</button>
          </form>
        </div>
      </div>
    );
  }

  if (inputMode) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 flex flex-col">
        <div className="max-w-3xl mx-auto w-full space-y-6">
          <div className="bg-slate-800 p-4 rounded-lg flex justify-between">
            <div>区块: <span className="text-emerald-400">{roomCode}</span></div>
            <button onClick={() => setIsLogged(false)} className="text-slate-400">退出</button>
          </div>
          <textarea className="w-full h-96 p-4 bg-slate-900 border border-slate-600 rounded-lg font-mono text-sm text-emerald-100" value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} placeholder="粘贴AI转换好的JSON代码..." />
          {errorMsg && <p className="text-rose-400">{errorMsg}</p>}
          <button onClick={loadDataToLocal} className="w-full bg-emerald-600 font-bold py-4 rounded-lg">写入本地题库并开刷</button>
        </div>
      </div>
    );
  }

  if (!currentDisplayQ) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">正在加载...</div>;

  const currentQuestions = testMode === 'all' ? db : wrongBank;
  const progress = ((currentIndex) / currentQuestions.length) * 100 || 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-6 flex flex-col font-sans">
      <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
        
        <div className="bg-slate-800 rounded-xl p-4 mb-4 border border-slate-700 shadow-md flex justify-between items-center text-sm">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500">{roomCode === 'RANDOM_ALL' ? '全局混合特训' : roomCode}</span>
            <span className="font-bold text-emerald-400 text-lg">{username}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className={testMode === 'wrong' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>{testMode === 'all' ? '主线推进' : '错题死磕'}</span>
            <span className="text-slate-400">{currentIndex + 1} / {currentQuestions.length}</span>
          </div>
          <div className="flex gap-3 items-center">
             <label className="flex items-center gap-1 cursor-pointer text-slate-400" title="选项乱序">
                 <input type="checkbox" checked={shuffleEnabled} onChange={(e) => setShuffleEnabled(e.target.checked)} className="accent-emerald-500 w-4 h-4"/>
                 <span className="hidden sm:inline">乱序</span>
             </label>
             <button onClick={() => setInputMode(true)} className="text-slate-400">加题</button>
             <button onClick={() => setIsLogged(false)} className="text-rose-400">撤</button>
          </div>
        </div>

        <div className="w-full bg-slate-800 rounded-full h-1.5 mb-6"><div className={`${testMode === 'all' ? 'bg-emerald-500' : 'bg-rose-500'} h-1.5 rounded-full transition-all`} style={{ width: `${progress}%` }}></div></div>

        <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl border border-slate-700 flex-1 flex flex-col relative">
          <div className="mb-6">
              {roomCode === 'RANDOM_ALL' && currentDisplayQ.sourceChapter && <span className="inline-block px-3 py-1 bg-slate-700 text-slate-300 text-xs rounded-full mb-3 border border-slate-600">来源: {currentDisplayQ.sourceChapter}</span>}
              <h2 className="text-xl sm:text-2xl font-medium leading-relaxed">{currentDisplayQ.q}</h2>
          </div>
          <div className="space-y-3 mb-8">
            {currentDisplayQ.displayOptions && currentDisplayQ.displayOptions.map((opt, idx) => (
              <div key={idx} className={`p-4 bg-slate-900/50 hover:bg-slate-700 rounded-xl border border-slate-700 cursor-pointer ${showAnswer && currentDisplayQ.displayAnswer.includes(opt.charAt(0)) ? 'ring-2 ring-emerald-500/50 bg-emerald-900/20' : ''}`} onClick={() => !showAnswer && setShowAnswer(true)}>{opt}</div>
            ))}
          </div>

          <div className="mt-auto">
            {!showAnswer ? (
              <button onClick={() => setShowAnswer(true)} className="w-full bg-slate-700 text-white font-bold py-5 rounded-xl">看答案</button>
            ) : (
              <div className="animate-fade-in space-y-4">
                <div className="p-5 bg-slate-900 border border-slate-600 rounded-xl">
                  <div className="text-emerald-400 font-bold text-xl mb-2">正确答案: {currentDisplayQ.displayAnswer}</div>
                  <div className="text-slate-300 text-sm sm:text-base"><span className="font-bold">解析：</span>{currentDisplayQ.exp}</div>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => handleNext(false)} className="flex-1 bg-slate-800 text-rose-400 border border-rose-900/50 font-bold py-4 rounded-xl">做错了</button>
                  <button onClick={() => handleNext(true)} className="flex-[2] bg-emerald-600 text-white font-bold py-4 rounded-xl">下一题</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {testMode === 'all' && wrongBank.length > 0 && (
           <div className="mt-8 text-center">
             <button onClick={() => {setTestMode('wrong'); setCurrentIndex(0); setShowAnswer(false);}} className="text-sm text-slate-400 hover:text-rose-400 underline">累计错题: {wrongBank.length} (点击死磕)</button>
           </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 极其关键的“点火开关”！之前就是漏了这段代码导致你的页面白屏。
// 这一段代码的作用是将上面写好的 App 组件真正渲染到网页上。
// ------------------------------------------------------------------
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
