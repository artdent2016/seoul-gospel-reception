import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, CheckCircle, ChevronRight, User, Calendar, Phone, Stethoscope, Send, AlertCircle, Volume2, ArrowRight, Edit3 } from 'lucide-react';

// --- CONFIGURATION ---
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1453637431629975633/4iR14c4AHq_OLoy1iWJqHeZrsAUpsbwDrSTb45KVy99zCzM5hNM7vTWDisUUW_bDIgNU";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "AIzaSyDG0fMMZ3FuArDTVtcWwS7bOpVLxcmg3nw";
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";

const STEPS = [
  { id: 'welcome', label: '시작', question: '안녕하세요. 서울복음치과입니다. 접수를 시작하려면 아래 버튼을 눌러주세요.' },
  { id: 'name', label: '성함', question: '성함을 말씀해 주시거나 입력해 주세요.', placeholder: '이름 입력' },
  { id: 'birth', label: '생년월일', question: '생년월일 8자리를 말씀해 주세요.', placeholder: '예: 1990년 01월 01일' },
  { id: 'phone', label: '연락처', question: '연락처를 말씀해 주세요.', placeholder: '예: 01012345678' },
  { id: 'symptoms', label: '증상 설명', question: '어디가 어떻게 불편하신지 편하게 말씀해 주세요.', placeholder: '불편하신 곳을 상세히 말씀해 주세요' },
  { id: 'confirm', label: '내용 확인', question: '입력하신 내용이 맞는지 확인해 주세요.' },
  { id: 'complete', label: '완료', question: '접수가 완료되었습니다. 병원에서 확인 후 곧 연락드리겠습니다.' }
];

const App = () => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    birth: '',
    phone: '',
    symptomsRaw: '',
    symptomsSummary: ''
  });
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [isEditingMode, setIsEditingMode] = useState(false);

  const recognitionRef = useRef(null);
  const summaryTimeoutRef = useRef(null);
  const currentStep = STEPS[currentStepIndex];

  // --- 1. AI Content Generation (Gemini with Backoff) ---
  const summarizeSymptoms = async (rawText) => {
    if (!rawText || rawText.length < 3) return;
    if (!GEMINI_API_KEY) {
      console.warn("Gemini API Key is missing.");
      return;
    }

    setIsProcessing(true);

    // 말투 수정: 원장님께 직접 말하는 환자의 1인칭 말투로 프롬프트 강화
    const systemPrompt = "당신은 치과에 방문한 환자입니다. 원장님(의사)에게 당신의 증상을 직접 설명하는 친절하고 자연스러운 1인칭 말투로 요약하세요. (~해서 왔어요, ~가 아파요). 핵심 증상 위주로 요약된 문장만 한 줄로 출력하세요. 예: '원장님, 왼쪽 아래 어금니가 찬 거 마실 때마다 너무 시리고 아파요.'";

    const fetchWithRetry = async (retries = 5, delay = 1000) => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `환자가 횡설수설하며 말한 내용: ${rawText}` }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          setFormData(prev => ({ ...prev, symptomsSummary: text.trim() }));
          setError('');
        } else {
          throw new Error("Invalid response format");
        }
      } catch (err) {
        if (retries > 0) {
          await new Promise(res => setTimeout(res, delay));
          return fetchWithRetry(retries - 1, delay * 2);
        } else {
          console.error("Gemini summary failed after retries.");
        }
      } finally {
        setIsProcessing(false);
      }
    };

    await fetchWithRetry();
  };

  const sendToDiscord = async (finalData) => {
    const embed = {
      title: "🦷 서울복음치과 신규 접수 알림",
      color: 0x2563EB,
      fields: [
        { name: "👤 성함", value: finalData.name || "미기입", inline: true },
        { name: "🎂 생년월일", value: finalData.birth || "미기입", inline: true },
        { name: "📞 연락처", value: finalData.phone || "미기입", inline: true },
        { name: "📝 환자가 전하는 증상", value: finalData.symptomsSummary || finalData.symptomsRaw || "내용 없음" },
        { name: "🎤 음성 기록 원문", value: finalData.symptomsRaw || "기록 없음" }
      ],
      timestamp: new Date().toISOString()
    };
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });
    } catch (err) { console.error("Discord send error:", err); }
  };

  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      if (['name', 'birth', 'phone', 'symptoms'].includes(currentStep.id)) startListening();
    };
    window.speechSynthesis.speak(utterance);
  }, [currentStep.id]);

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("크롬 브라우저를 사용해 주세요.");
      return;
    }
    if (isListening) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;
    recognition.onstart = () => {
      setIsListening(true);
      setError('');
    };
    recognition.onresult = (event) => {
      const isFinalResult = event.results[event.results.length - 1].isFinal;
      const latestText = event.results[event.results.length - 1][0].transcript.trim();

      if (isFinalResult) {
        if (currentStep.id === 'symptoms') {
          setTranscript(prev => (prev ? `${prev} ${latestText}` : latestText));
          clearTimeout(summaryTimeoutRef.current);
          summaryTimeoutRef.current = setTimeout(() => {
            setTranscript(curr => {
              summarizeSymptoms(curr);
              return curr;
            });
          }, 1500);
        } else {
          let filtered = latestText;
          if (currentStep.id === 'birth') filtered = latestText.replace(/[^0-9년월일\s]/g, "");
          if (currentStep.id === 'phone') filtered = latestText.replace(/[^0-9]/g, "");
          setTranscript(filtered);
        }
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleNextStep = async () => {
    stopListening();
    window.speechSynthesis.cancel();
    const nextData = { ...formData };
    if (currentStep.id === 'name') nextData.name = transcript;
    else if (currentStep.id === 'birth') nextData.birth = transcript;
    else if (currentStep.id === 'phone') nextData.phone = transcript;
    else if (currentStep.id === 'symptoms') {
      nextData.symptomsRaw = transcript;
      if (!nextData.symptomsSummary) await summarizeSymptoms(transcript);
    }
    setFormData(nextData);
    setTranscript('');
    if (isEditingMode) { setCurrentStepIndex(5); setIsEditingMode(false); }
    else { setCurrentStepIndex(prev => prev + 1); }
  };

  const startIndividualEdit = (idx) => {
    setIsEditingMode(true);
    const keys = ['name', 'birth', 'phone', 'symptomsRaw'];
    setTranscript(formData[keys[idx]]);
    setCurrentStepIndex(idx + 1);
  };

  useEffect(() => {
    if (currentStepIndex > 0 || currentStep.id === 'welcome') speak(currentStep.question);
    if (currentStep.id === 'complete') sendToDiscord(formData);
  }, [currentStepIndex, speak]);

  const VoiceIndicator = () => (
    <div className="flex items-center justify-center space-x-1.5 h-10">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className={`w-1.5 bg-blue-500 rounded-full transition-all duration-300 ${isListening ? 'animate-bounce' : 'opacity-20'}`}
          style={{ height: isListening ? `${Math.random() * 80 + 20}%` : '30%', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-xl mb-6 flex justify-between items-center">
        <h1 className="text-xl font-black text-blue-900 flex items-center gap-2">
          <span className="p-2 bg-blue-600 text-white rounded-xl shadow-lg">🦷</span>
          서울복음치과
        </h1>
        <div className="text-sm font-bold text-blue-600">{currentStepIndex + 1} / {STEPS.length}</div>
      </div>
      <main className="w-full max-w-xl bg-white rounded-[3rem] shadow-2xl border border-blue-50 overflow-hidden min-h-[580px] flex flex-col transition-all">
        <div className="p-10 bg-blue-600 text-white text-center relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center">
            <div className="mb-6 w-14 h-14 bg-white/20 rounded-2xl backdrop-blur-md border border-white/30 flex items-center justify-center shadow-inner">
              {isSpeaking ? <Volume2 className="animate-pulse" size={28} /> : <div className="text-xl">🏥</div>}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black leading-tight break-keep drop-shadow-sm">{currentStep.question}</h2>
          </div>
        </div>
        <div className="flex-1 p-8 flex flex-col">
          {currentStep.id === 'welcome' ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <button onClick={() => setCurrentStepIndex(1)} className="group flex flex-col items-center gap-6 p-12 rounded-[3rem] bg-blue-50 hover:bg-blue-100 transition-all border-2 border-dashed border-blue-200 w-full active:scale-95 shadow-sm">
                <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl group-hover:scale-110 transition-transform"><ChevronRight size={48} /></div>
                <span className="text-2xl font-black text-blue-900">접수 시작하기</span>
              </button>
            </div>
          ) : ['name', 'birth', 'phone', 'symptoms'].includes(currentStep.id) ? (
            <div className="w-full space-y-6 flex-1 flex flex-col">
              <div className="space-y-4 flex-1">
                {currentStep.id === 'symptoms' ? (
                  <div className="space-y-4">
                    <label className="text-xs font-black text-slate-400 ml-3 uppercase tracking-widest block">불편사항 말씀 (이어서 말씀하세요)</label>
                    <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={currentStep.placeholder} className="w-full p-6 text-xl font-bold bg-slate-50 border-2 border-slate-100 rounded-[2rem] focus:border-blue-500 outline-none transition-all min-h-[160px] resize-none shadow-inner" />
                    <div className="p-5 bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-[2rem]">
                      <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-2 font-black italic">원장님께 드릴 말씀 (AI 실시간 정리)</span>
                      <p className="text-lg font-bold text-slate-700 leading-relaxed italic">{isProcessing ? "정리 중..." : (formData.symptomsSummary || "말씀하시면 내용을 자연스럽게 정리합니다.")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <label className="text-xs font-black text-slate-400 ml-3 uppercase tracking-widest block mb-2">{currentStep.label}</label>
                    <input type="text" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={currentStep.placeholder} className="w-full p-8 text-2xl font-black bg-slate-50 border-2 border-slate-100 rounded-[2.5rem] focus:border-blue-500 outline-none shadow-inner" />
                  </div>
                )}
              </div>
              <div className="pt-4 space-y-5">
                <div className="flex gap-4">
                  <button onClick={isListening ? stopListening : startListening} className={`flex-1 py-7 rounded-[2rem] flex flex-col items-center justify-center gap-1 font-black transition-all shadow-lg ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white border-2 border-blue-600 text-blue-600 hover:bg-blue-50'}`}>{isListening ? <MicOff size={32} /> : <Mic size={32} />}{isListening ? '정지' : '음성 입력'}</button>
                  <button onClick={handleNextStep} disabled={!transcript && !isEditingMode} className="flex-[2] py-7 bg-blue-600 text-white rounded-[2rem] font-black text-2xl flex items-center justify-center gap-3 hover:bg-blue-700 shadow-xl disabled:bg-slate-200 active:scale-95 transition-transform">{isEditingMode ? '수정 완료' : '다음 단계'}<ArrowRight size={24} /></button>
                </div>
                <VoiceIndicator />
              </div>
            </div>
          ) : currentStep.id === 'confirm' ? (
            <div className="w-full space-y-4">
              <div className="grid grid-cols-1 gap-3">
                {[{ icon: <User size={18}/>, label: "성함", value: formData.name }, { icon: <Calendar size={18}/>, label: "생년월일", value: formData.birth }, { icon: <Phone size={18}/>, label: "연락처", value: formData.phone }, { icon: <Stethoscope size={18}/>, label: "불편하신 내용", value: formData.symptomsSummary || formData.symptomsRaw }].map((item, idx) => (
                  <button key={idx} onClick={() => startIndividualEdit(idx)} className="flex items-center justify-between p-5 bg-slate-50 rounded-3xl border border-slate-100 hover:border-blue-300 transition-all text-left w-full group shadow-sm">
                    <div className="flex items-center gap-4 text-left">
                      <div className="text-blue-500 bg-white p-3 rounded-2xl shadow-sm border border-blue-50 group-hover:bg-blue-600 group-hover:text-white transition-all">{item.icon}</div>
                      <div><p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-0.5">{item.label}</p><p className="text-lg font-bold text-slate-800 line-clamp-1">{item.value || "미입력"}</p></div>
                    </div><Edit3 size={18} className="text-slate-300 group-hover:text-blue-500" /></button>))}
              </div>
              <button onClick={handleNextStep} className="w-full mt-6 py-8 bg-blue-600 text-white rounded-[2.5rem] font-black text-2xl flex items-center justify-center gap-4 hover:bg-blue-700 shadow-2xl active:scale-95 transition-all">최종 접수 완료<Send size={28} /></button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <div className="relative mb-12">
                <div className="absolute inset-0 bg-green-200 rounded-full animate-ping opacity-20" />
                <div className="relative w-32 h-32 bg-green-100 text-green-600 rounded-full flex items-center justify-center shadow-inner border-4 border-white"><CheckCircle size={80} strokeWidth={2.5} /></div>
              </div>
              <h3 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">접수가 잘 되었습니다!</h3>
              <div className="space-y-4 p-10 bg-slate-50 rounded-[3rem] border border-dashed border-slate-200 shadow-sm relative overflow-hidden">
                <p className="text-slate-600 text-xl font-bold relative z-10">원장님께서 확인하신 후,<br /><span className="text-blue-700 text-2xl font-black">곧 연락을 드리겠습니다.</span></p>
                <div className="pt-6 border-t border-slate-200 relative z-10"><p className="text-slate-400 font-bold font-black">데스크 근처에서 잠시만 대기해 주세요.</p></div>
              </div>
            </div>
          )}
        </div>
      </main>
      <footer className="mt-10 text-slate-400 text-[10px] font-black tracking-[0.3em] flex items-center gap-4 uppercase font-black">SEOUL GOSPEL DENTAL CLINIC</footer>
    </div>
  );
};
export default App;