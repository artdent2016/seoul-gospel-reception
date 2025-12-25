import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, CheckCircle, ChevronRight, User, Calendar, Phone, Stethoscope, Send, AlertCircle, Volume2, ArrowRight, Edit3 } from 'lucide-react';

// --- CONFIGURATION ---
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1453637431629975633/4iR14c4AHq_OLoy1iWJqHeZrsAUpsbwDrSTb45KVy99zCzM5hNM7vTWDisUUW_bDIgNU";
const GEMINI_API_KEY = "";
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

  const summarizeSymptoms = async (rawText) => {
    if (!rawText || rawText.length < 3) return;
    setIsProcessing(true);
    const systemPrompt = "당신은 치과 환자입니다. 증상을 원장님께 직접 설명하는 듯한 '자연스러운 1인칭 문장'으로 요약하세요. (~해서 왔어요, ~가 아파요). 요약된 문장만 한 줄로 출력하세요.";

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `다음 내용을 환자의 말처럼 요약해줘: ${rawText}` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });

      if (!response.ok) throw new Error('AI 분석 오류');
      const data = await response.json();
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || rawText;
      setFormData(prev => ({ ...prev, symptomsSummary: summary }));
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const sendToDiscord = async (finalData) => {
    const embed = {
      title: "🦷 서울복음치과 신규 접수 알림",
      color: 0x2563EB,
      fields: [
        { name: "👤 성함", value: finalData.name || "미기입", inline: true },
        { name: "🎂 생년월일", value: finalData.birth || "미기입", inline: true },
        { name: "📞 연락처", value: finalData.phone || "미기입", inline: true },
        { name: "📝 증상 요약 (AI)", value: finalData.symptomsSummary || finalData.symptomsRaw || "내용 없음" },
        { name: "🎤 원문 기록", value: finalData.symptomsRaw || "기록 없음" }
      ],
      timestamp: new Date().toISOString()
    };
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });
    } catch (err) {
      console.error(err);
    }
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
    if (!SpeechRecognition) return;
    if (isListening) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const isFinalResult = event.results[event.results.length - 1].isFinal;
      const latestTranscript = event.results[event.results.length - 1][0].transcript.trim();
      if (isFinalResult) {
        if (currentStep.id === 'symptoms') {
          setTranscript(prev => (prev ? `${prev} ${latestTranscript}` : latestTranscript));
        } else {
          let filtered = latestTranscript;
          if (currentStep.id === 'birth') filtered = latestTranscript.replace(/[^0-9년월일\s]/g, "");
          if (currentStep.id === 'phone') filtered = latestTranscript.replace(/[^0-9]/g, "");
          setTranscript(filtered);
        }
      }
      if (currentStep.id === 'symptoms' && isFinalResult) {
        clearTimeout(summaryTimeoutRef.current);
        summaryTimeoutRef.current = setTimeout(() => {
          setTranscript(current => { summarizeSymptoms(current); return current; });
        }, 1500);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleNextStep = async () => {
    if (recognitionRef.current) recognitionRef.current.stop();
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

  const startIndividualEdit = (index) => {
    setIsEditingMode(true);
    const keys = ['name', 'birth', 'phone', 'symptomsRaw'];
    setTranscript(formData[keys[index]]);
    setCurrentStepIndex(index + 1);
  };

  useEffect(() => {
    if (currentStepIndex > 0 || currentStep.id === 'welcome') speak(currentStep.question);
    if (currentStep.id === 'complete') sendToDiscord(formData);
  }, [currentStepIndex, speak]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-xl mb-6 flex justify-between items-center">
        <h1 className="text-xl font-black text-blue-900 flex items-center gap-2">
          <span className="p-2 bg-blue-600 text-white rounded-xl shadow-lg">🦷</span>
          서울복음치과
        </h1>
        <div className="text-sm font-bold text-blue-600">{currentStepIndex + 1} / {STEPS.length}</div>
      </div>
      <main className="w-full max-w-xl bg-white rounded-[3rem] shadow-2xl border border-blue-50 overflow-hidden min-h-[580px] flex flex-col">
        <div className="p-10 bg-blue-600 text-white text-center relative overflow-hidden">
          <div className="relative z-10">
            <div className="mb-6 inline-flex items-center justify-center w-14 h-14 bg-white/20 rounded-2xl backdrop-blur-md border border-white/30">
              {isSpeaking ? <Volume2 className="animate-pulse" size={28} /> : <div className="text-xl">🏥</div>}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black leading-tight break-keep drop-shadow-sm">{currentStep.question}</h2>
          </div>
        </div>
        <div className="flex-1 p-8 flex flex-col">
          {currentStep.id === 'welcome' && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <button onClick={() => setCurrentStepIndex(1)} className="group flex flex-col items-center gap-6 p-12 rounded-[2.5rem] bg-blue-50 hover:bg-blue-100 transition-all border-2 border-dashed border-blue-200 w-full active:scale-95">
                <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl group-hover:scale-110 transition-transform"><ChevronRight size={48} /></div>
                <span className="text-2xl font-black text-blue-900">접수 시작하기</span>
              </button>
            </div>
          )}
          {['name', 'birth', 'phone', 'symptoms'].includes(currentStep.id) && (
            <div className="w-full space-y-6 flex-1 flex flex-col">
              <div className="space-y-4 flex-1">
                {currentStep.id === 'symptoms' ? (
                  <div className="space-y-4">
                    <label className="text-xs font-black text-slate-400 ml-3 uppercase tracking-widest block">증상 말씀 (계속 이어서 말씀하세요)</label>
                    <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={currentStep.placeholder} className="w-full p-6 text-xl font-bold bg-slate-50 border-2 border-slate-100 rounded-[2rem] focus:border-blue-500 outline-none transition-all min-h-[150px] resize-none" />
                    <div className="p-5 bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-[2rem]">
                      <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-2">원장님께 전달될 요약 내용</span>
                      <p className="text-lg font-bold text-slate-700 leading-relaxed italic">{isProcessing ? "정리 중..." : (formData.symptomsSummary || "말씀하시면 환자분의 말투로 내용을 정리합니다.")}</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <label className="text-xs font-black text-slate-400 ml-3 uppercase tracking-widest block mb-2">{currentStep.label}</label>
                    <input type="text" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={currentStep.placeholder} className="w-full p-7 text-2xl font-black bg-slate-50 border-2 border-slate-100 rounded-[2rem] focus:border-blue-500 outline-none" />
                  </div>
                )}
              </div>
              <div className="pt-4 space-y-5">
                <div className="flex gap-4">
                  <button onClick={() => isListening ? recognitionRef.current.stop() : startListening()} className={`flex-1 py-6 rounded-[1.5rem] flex flex-col items-center justify-center gap-1 font-black transition-all shadow-lg ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white border-2 border-blue-600 text-blue-600 hover:bg-blue-50'}`}>{isListening ? <MicOff size={28} /> : <Mic size={28} />}<span className="text-[10px] uppercase tracking-widest">{isListening ? '정지' : '음성 입력'}</span></button>
                  <button onClick={handleNextStep} disabled={!transcript && !isEditingMode} className="flex-[2] py-6 bg-blue-600 text-white rounded-[1.5rem] font-black text-xl flex items-center justify-center gap-3 hover:bg-blue-700 shadow-xl disabled:bg-slate-200">{isEditingMode ? '수정 완료' : '다음 단계'}<ArrowRight size={20} /></button>
                </div>
              </div>
            </div>
          )}
          {currentStep.id === 'confirm' && (
            <div className="w-full space-y-4">
              <div className="grid grid-cols-1 gap-3">
                {[{ icon: <User size={18}/>, label: "성함", value: formData.name }, { icon: <Calendar size={18}/>, label: "생년월일", value: formData.birth }, { icon: <Phone size={18}/>, label: "연락처", value: formData.phone }, { icon: <Stethoscope size={18}/>, label: "증상 요약", value: formData.symptomsSummary || formData.symptomsRaw }].map((item, idx) => (
                  <button key={idx} onClick={() => startIndividualEdit(idx)} className="flex items-center justify-between p-5 bg-slate-50 rounded-3xl border border-slate-100 hover:border-blue-300 transition-all text-left w-full group">
                    <div className="flex items-center gap-4">
                      <div className="text-blue-500 bg-white p-3 rounded-2xl shadow-sm border border-blue-50 group-hover:bg-blue-600 group-hover:text-white transition-all">{item.icon}</div>
                      <div><p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-0.5">{item.label}</p><p className="text-lg font-bold text-slate-800 line-clamp-1">{item.value || "미입력"}</p></div>
                    </div>
                    <Edit3 size={18} className="text-slate-300 group-hover:text-blue-500" />
                  </button>
                ))}
              </div>
              <button onClick={handleNextStep} className="w-full mt-6 py-7 bg-blue-600 text-white rounded-[2rem] font-black text-2xl flex items-center justify-center gap-4 hover:bg-blue-700 shadow-2xl active:scale-95 transition-all">최종 접수 완료<Send size={24} /></button>
            </div>
          )}
          {currentStep.id === 'complete' && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <CheckCircle size={70} className="text-green-500 mb-6" />
              <h3 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">접수가 완료되었습니다!</h3>
              <p className="text-slate-600 text-lg font-bold">원장님께서 확인하신 후, 곧 연락을 드리겠습니다.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
