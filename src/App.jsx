import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';

// ==========================================
// Firebase 初始化 (底层云服务配置)
// ==========================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestoreDb = getFirestore(app);

// 辅助函数：洗牌算法（打乱选项顺序）
const shuffleOptions = (options, correctAnswerStr) => {
  if (!options || options.length === 0) return { shuffledOptions: [], newAnswerStr: correctAnswerStr };
  
  // 将 "A. 内容" 解析为 { label: 'A', text: '内容' }
  const parsedOptions = options.map(opt => {
    const match = opt.match(/^([A-Z])[\.、]\s*(.*)$/);
    return match ? { originalLabel: match[1], text: match[2], full: opt } : { originalLabel: '', text: opt, full: opt };
  });

  // 如果解析失败，直接返回原样
  if (parsedOptions.some(o => !o.originalLabel)) return { shuffledOptions: options, newAnswerStr: correctAnswerStr };

  // 打乱数组
  const shuffled = [...parsedOptions].sort(() => Math.random() - 0.5);

  // 重建选项数组并映射新答案
  const newOptions = [];
  const oldToNewLabel = {};
  const labels = ['A', 'B', 'C', 'D', 'E', 'F']; // 支持多选题

  shuffled.forEach((opt, index) => {
    const newLabel = labels[index];
    newOptions.push(`${newLabel}. ${opt.text}`);
    oldToNewLabel[opt.originalLabel] = newLabel;
  });

  // 转换正确答案字符串 (例如 "AC" 转换为新的对应标签)
  const answerChars = correctAnswerStr.split('');
  let newAnswerStr = '';
  answerChars.forEach(char => {
    if (oldToNewLabel[char]) {
      newAnswerStr += oldToNewLabel[char];
    } else {
      newAnswerStr += char; // 保留无法映射的字符
    }
  });

  // 对新答案字符串排序 (保证比如 "CA" 变成 "AC")
  newAnswerStr = newAnswerStr.split('').sort().join('');

  return { shuffledOptions: newOptions, newAnswerStr };
};

export default function App() {
  const [user, setUser] = useState(null);
  
  // 登录/自习室状态
  const [roomCode, setRoomCode] = useState(''); // 这里对应章节名或“全局”
  const [username, setUsername] = useState('');
  const [isLogged, setIsLogged] = useState(false);
  
  // 核心数据状态
  const [db, setDb] = useState([]); // 当前正在刷的题库
  const [availableRooms, setAvailableRooms] = useState([]); // 所有可用的章节/题库
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wrongBank, setWrongBank] = useState([]);
  
  // UI状态
  const [showAnswer, setShowAnswer] = useState(false);
  const [inputMode, setInputMode] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [testMode, setTestMode] = useState('all'); 
  const [loading, setLoading] = useState(true);
  
  // 乱序开关
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [currentDisplayQ, setCurrentDisplayQ] = useState(null);

  // 1. 初始化鉴权
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (initToken) {
          await signInWithCustomToken(auth, initToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Auth init failed:", e);
        setErrorMsg("服务器连接失败，请刷新重试。");
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 登录后获取所有可用的章节（自习室）列表
  useEffect(() => {
    if (!user || !isLogged) return;
    const fetchRooms = async () => {
      try {
         const roomsCol = collection(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_rooms');
         const roomSnapshot = await getDocs(roomsCol);
         const roomList = roomSnapshot.docs.map(doc => doc.id);
         setAvailableRooms(roomList);
      } catch (e) {
         console.error("Fetch rooms failed", e);
      }
    };
    fetchRooms();
  }, [user, isLogged]);

  // 2. 监听当前选定章节的云端数据
  useEffect(() => {
    if (!user || !isLogged || !roomCode || !username) return;

    const fetchDb = async () => {
      setLoading(true);
      try {
        if (roomCode === 'RANDOM_ALL') {
           // 打散练习模式：合并所有章节题目
           const roomsCol = collection(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_rooms');
           const roomSnapshot = await getDocs(roomsCol);
           let allQuestions = [];
           roomSnapshot.docs.forEach(doc => {
             const data = doc.data();
             if (data.questions) {
                 // 给每道题加上章节来源标签
                 const qsWithTag = data.questions.map(q => ({...q, sourceChapter: doc.id}));
                 allQuestions = allQuestions.concat(qsWithTag);
             }
           });
           
           if (allQuestions.length > 0) {
              // 打乱题库顺序
              const shuffledQuestions = allQuestions.sort(() => Math.random() - 0.5);
              setDb(shuffledQuestions);
              setInputMode(false);
           } else {
              setDb([]);
              setInputMode(true);
           }
        } else {
            // 普通单章节模式
            const roomRef = doc(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_rooms', roomCode);
            const roomSnap = await getDoc(roomRef);
            if (roomSnap.exists() && roomSnap.data().questions) {
              setDb(roomSnap.data().questions);
              setInputMode(false);
            } else {
              setDb([]);
              setInputMode(true);
            }
        }
      } catch (err) {
        console.error("Fetch DB error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDb();

    // 实时监听个人进度
    const userProgressId = `${roomCode}_${username}`;
    const progressRef = doc(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_users', userProgressId);
    
    const unsubscribeProgress = onSnapshot(progressRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCurrentIndex(data.currentIndex || 0);
        setWrongBank(data.wrongBank || []);
      } else {
        setDoc(progressRef, { currentIndex: 0, wrongBank: [] }, { merge: true });
        setCurrentIndex(0);
        setWrongBank([]);
      }
    });

    return () => unsubscribeProgress();
  }, [user, isLogged, roomCode, username]);

  // 处理题目展示（乱序逻辑）
  useEffect(() => {
      const currentQuestions = testMode === 'all' ? db : wrongBank;
      const rawQ = currentQuestions[currentIndex];

      if (!rawQ) {
          setCurrentDisplayQ(null);
          return;
      }

      if (shuffleEnabled && !showAnswer) { // 只在未看答案前打乱一次，防止切换状态时选项跳动
          const { shuffledOptions, newAnswerStr } = shuffleOptions(rawQ.options, rawQ.a);
          setCurrentDisplayQ({
              ...rawQ,
              displayOptions: shuffledOptions,
              displayAnswer: newAnswerStr
          });
      } else if (!shuffleEnabled) {
          setCurrentDisplayQ({
              ...rawQ,
              displayOptions: rawQ.options,
              displayAnswer: rawQ.a
          });
      }
  }, [db, wrongBank, currentIndex, testMode, shuffleEnabled, showAnswer]);

  const syncToCloud = async (newIndex, newWrongBank) => {
    if (!user || !isLogged) return;
    const userProgressId = `${roomCode}_${username}`;
    const progressRef = doc(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_users', userProgressId);
    
    setCurrentIndex(newIndex);
    setWrongBank(newWrongBank);
    
    try {
      await setDoc(progressRef, { currentIndex: newIndex, wrongBank: newWrongBank }, { merge: true });
    } catch (err) {
      console.error("Failed to save to cloud:", err);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    // 如果没有选择房间，默认进入全局打散模式，或者强制要求输入新房间
    if (!roomCode) {
        setRoomCode('RANDOM_ALL'); 
    }
    setUsername(username.trim().toUpperCase());
    setIsLogged(true);
  };

  const handleLogout = () => {
    setIsLogged(false);
    setDb([]);
    setCurrentIndex(0);
    setWrongBank([]);
    setRoomCode('');
    setCurrentDisplayQ(null);
  };

  const loadDataToCloud = async () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("数据必须是非空数组");
      
      // 检查大小，Firestore单个文档1MB限制
      const sizeStr = JSON.stringify(parsed);
      if (sizeStr.length > 800000) throw new Error(`题库体积 ${Math.round(sizeStr.length/1024)}KB，接近1MB限制！请拆分章节上传。`);
      
      setLoading(true);
      // 注意：这里强制使用用户输入的 roomCode 作为章节名
      const targetRoom = roomCode === 'RANDOM_ALL' ? '通用题库' : roomCode; 
      const roomRef = doc(firestoreDb, 'artifacts', appId, 'public', 'data', 'accounting_rooms', targetRoom);
      await setDoc(roomRef, { questions: parsed });
      
      setDb(parsed);
      syncToCloud(0, wrongBank); 
      
      setShowAnswer(false);
      setInputMode(false);
      setErrorMsg('');
      setTestMode('all');
      
      // 刷新可用章节列表
      if (!availableRooms.includes(targetRoom)) {
          setAvailableRooms([...availableRooms, targetRoom]);
      }
      
    } catch (e) {
      setErrorMsg("上传失败: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = (isCorrect) => {
    let nextIndex = currentIndex;
    let nextWrongBank = [...wrongBank];
    const rawQ = (testMode === 'all' ? db : wrongBank)[currentIndex];

    if (!isCorrect) {
      if (!nextWrongBank.find(wq => wq.q === rawQ.q)) {
         nextWrongBank.push(rawQ);
      }
    } else if (testMode === 'wrong') {
      nextWrongBank = nextWrongBank.filter(wq => wq.q !== rawQ.q);
      if (nextWrongBank.length === 0) {
        alert("干得漂亮，错题本已清空！");
        setTestMode('all');
        syncToCloud(0, nextWrongBank); 
        setShowAnswer(false);
        return;
      }
      if (nextIndex >= nextWrongBank.length) nextIndex = 0;
      syncToCloud(nextIndex, nextWrongBank);
      setShowAnswer(false);
      return; 
    }

    if (nextIndex < (testMode === 'all' ? db : wrongBank).length - 1) {
      nextIndex += 1;
    } else {
      if (testMode === 'all') {
        alert(`牛逼，本章节已刷穿！`);
      } else {
        alert("这轮错题复习完毕，继续下一轮！");
        nextIndex = 0;
      }
    }
    
    if (testMode === 'all') {
      syncToCloud(nextIndex, nextWrongBank);
    } else {
      syncToCloud(currentIndex, nextWrongBank); 
      setCurrentIndex(nextIndex); 
    }
    setShowAnswer(false);
  };

  const startWrongMode = () => {
    if (wrongBank.length === 0) return alert("错题本是空的！");
    setTestMode('wrong');
    setCurrentIndex(0);
    setShowAnswer(false);
  };

  if (loading && !isLogged) {
    return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">连接核心服务器...</div>;
  }

  // 1. 登录与主菜单界面
  if (!isLogged) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
          <div className="text-center mb-8">
             <div className="w-16 h-16 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
             </div>
             <h1 className="text-2xl font-bold mb-2">终极特训基地</h1>
             <p className="text-slate-400 text-sm">488个文档的降维打击中心。</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">你的代号</label>
              <input 
                type="text" 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none uppercase"
                value={username} onChange={(e) => setUsername(e.target.value)} required
                placeholder="输入你的名字"
              />
            </div>
            
            <div>
               <label className="block text-sm font-medium text-slate-400 mb-1">选择作战章节</label>
               {availableRooms.length > 0 ? (
                 <select 
                   className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none text-slate-200"
                   value={roomCode}
                   onChange={(e) => setRoomCode(e.target.value)}
                 >
                   <option value="" disabled>-- 选择已上传的章节 --</option>
                   <option value="RANDOM_ALL" className="text-emerald-400 font-bold">🔥 终极打散特训 (全部章节混合)</option>
                   {availableRooms.map(room => (
                     <option key={room} value={room}>{room}</option>
                   ))}
                 </select>
               ) : (
                 <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg text-slate-500 text-sm">
                   暂无可用章节，请先登录并新建。
                 </div>
               )}
            </div>
            
            {/* 允许输入新章节号以供导入数据 */}
            <div className="pt-2 border-t border-slate-700">
               <label className="block text-sm font-medium text-slate-400 mb-1">或 创建/进入新章节</label>
               <input 
                 type="text" 
                 className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 focus:border-emerald-500 outline-none uppercase"
                 value={roomCode} onChange={(e) => setRoomCode(e.target.value)}
                 placeholder="例如: 经济法第一章"
               />
            </div>

            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-lg transition-colors mt-4 shadow-lg shadow-emerald-900/30">
              进入特训
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. 题库导入界面
  if (inputMode) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 font-sans flex flex-col">
        <div className="max-w-3xl mx-auto w-full space-y-6">
          <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg flex justify-between items-center shadow-md">
            <div>当前目标区块: <span className="font-bold text-emerald-400">{roomCode}</span></div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-white">退出返回主菜单</button>
          </div>
          
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">部署题库到区块：{roomCode}</h1>
            <div className="bg-rose-900/20 border border-rose-900/50 p-4 rounded-lg text-left mt-4">
                <p className="text-rose-400 font-bold mb-2">导师严重警告 (488个文件的处理法则)：</p>
                <ul className="list-disc pl-5 text-slate-300 text-sm space-y-1">
                    <li>Firestore 云数据库单一文档上限为 <strong>1MB</strong>。</li>
                    <li>绝不允许尝试用脚本把488个PDF转成一个巨大无比的JSON塞进来！系统会直接崩溃。</li>
                    <li>必须 <strong>按物理逻辑分块</strong> (例如：“经济法_合同法卷”、“实务_存货卷”)。</li>
                    <li>在这个界面，把单次的JSON粘贴进去，上传。传完一个退出去，建新名字，再传下一个。</li>
                </ul>
            </div>
          </div>
          
          <textarea
            className="w-full h-80 p-4 bg-slate-900 border border-slate-600 rounded-lg font-mono text-sm focus:border-emerald-500 outline-none text-emerald-100"
            value={jsonInput} onChange={(e) => setJsonInput(e.target.value)}
            placeholder="[{'q': '题目文本', 'options': ['A. 选项', 'B. 选项'], 'a': 'A', 'exp': '解析文本'}]"
          />
          {errorMsg && <p className="text-rose-400 font-medium">{errorMsg}</p>}
          
          <button 
            onClick={loadDataToCloud} disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded-lg shadow-lg"
          >
            {loading ? '数据加密上传中...' : '确认部署本区块题库'}
          </button>
        </div>
      </div>
    );
  }

  // 3. 刷题主界面
  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">正在同步云端进度...</div>;
  if (!currentDisplayQ) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">题库加载完毕，暂无数据。</div>;

  const currentQuestions = testMode === 'all' ? db : wrongBank;
  const progress = ((currentIndex) / currentQuestions.length) * 100 || 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-6 flex flex-col font-sans">
      <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col relative">
        
        {/* Header */}
        <div className="bg-slate-800 rounded-xl p-4 mb-4 border border-slate-700 shadow-md flex justify-between items-center text-sm">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500">区块: {roomCode === 'RANDOM_ALL' ? '全局混合特训' : roomCode}</span>
            <span className="font-bold text-emerald-400 text-lg">{username}</span>
          </div>
          
          <div className="flex flex-col items-center">
            <span className={testMode === 'wrong' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
              {testMode === 'all' ? '主线推进' : '错题死磕'}
            </span>
            <span className="text-slate-400 font-mono text-base">{currentIndex + 1} / {currentQuestions.length}</span>
          </div>

          <div className="flex gap-4 items-center">
             <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-emerald-400" title="打乱选项顺序">
                 <input 
                    type="checkbox" 
                    checked={shuffleEnabled} 
                    onChange={(e) => setShuffleEnabled(e.target.checked)}
                    className="accent-emerald-500 w-4 h-4 cursor-pointer"
                 />
                 <span className="hidden sm:inline">选项乱序</span>
                 <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
             </label>
             <button onClick={() => setInputMode(true)} className="text-slate-400 hover:text-emerald-400">重配</button>
             <button onClick={handleLogout} className="text-slate-400 hover:text-rose-400">撤退</button>
          </div>
        </div>

        {/* Progress */}
        <div className="w-full bg-slate-800 rounded-full h-1.5 mb-6 overflow-hidden">
          <div className={`${testMode === 'all' ? 'bg-emerald-500' : 'bg-rose-500'} h-1.5 rounded-full transition-all duration-300 ease-out`} style={{ width: `${progress}%` }}></div>
        </div>

        {/* Card */}
        <div className="bg-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-700 flex-1 flex flex-col relative">
          <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent ${testMode === 'all' ? 'via-emerald-500/30' : 'via-rose-500/30'} to-transparent`}></div>
          
          <div className="mb-6">
              {roomCode === 'RANDOM_ALL' && currentDisplayQ.sourceChapter && (
                  <span className="inline-block px-3 py-1 bg-slate-700 text-slate-300 text-xs rounded-full mb-3 border border-slate-600">
                      来源: {currentDisplayQ.sourceChapter}
                  </span>
              )}
              <h2 className="text-xl sm:text-2xl font-medium leading-relaxed text-slate-100">
                {currentDisplayQ.q}
              </h2>
          </div>
          
          <div className="space-y-3 mb-8">
            {currentDisplayQ.displayOptions && currentDisplayQ.displayOptions.map((opt, idx) => (
              <div key={idx} 
                className={`p-4 sm:p-5 bg-slate-900/50 hover:bg-slate-700 transition-colors rounded-xl border border-slate-700 text-slate-300 cursor-pointer ${showAnswer && currentDisplayQ.displayAnswer.includes(opt.charAt(0)) ? 'ring-2 ring-emerald-500/50 bg-emerald-900/20' : ''}`}
                onClick={() => !showAnswer && setShowAnswer(true)}
              >
                {opt}
              </div>
            ))}
          </div>

          <div className="mt-auto">
            {!showAnswer ? (
              <button 
                onClick={() => setShowAnswer(true)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-5 rounded-xl transition-all shadow-md"
              >
                交卷 / 看解析
              </button>
            ) : (
              <div className="animate-fade-in space-y-4">
                <div className="p-5 bg-slate-900 border border-slate-600 rounded-xl relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full ${testMode === 'all' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                  <div className="text-emerald-400 font-bold text-xl mb-3 flex items-center gap-2">
                      <span>正确答案: {currentDisplayQ.displayAnswer}</span>
                      {shuffleEnabled && currentDisplayQ.displayAnswer !== currentDisplayQ.a && (
                          <span className="text-xs font-normal text-slate-500 bg-slate-800 px-2 py-1 rounded">
                              (原题答案: {currentDisplayQ.a})
                          </span>
                      )}
                  </div>
                  <div className="text-slate-300 leading-relaxed text-sm sm:text-base">
                    <span className="font-bold text-slate-400">名师解析：</span>{currentDisplayQ.exp}
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <button 
                    onClick={() => handleNext(false)}
                    className="flex-1 bg-slate-800 hover:bg-rose-900/40 text-rose-400 border border-rose-900/50 hover:border-rose-500 font-bold py-4 rounded-xl transition-all"
                  >
                    记不住，做错了
                  </button>
                  <button 
                    onClick={() => handleNext(true)}
                    className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 font-bold py-4 rounded-xl transition-all"
                  >
                    太简单，下一题
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {testMode === 'all' && wrongBank.length > 0 && (
           <div className="mt-8 text-center flex justify-center items-center gap-4">
             <div className="text-sm text-slate-500">累计击杀失败: <span className="text-rose-400 font-bold">{wrongBank.length}</span></div>
             <button onClick={startWrongMode} className="text-sm text-slate-400 hover:text-rose-400 underline transition-colors">
               切入错题死磕模式
             </button>
           </div>
        )}
      </div>
    </div>
  );
}
