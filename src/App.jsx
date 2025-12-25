
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, CheckCircle, ChevronRight, User, Calendar, Phone, Stethoscope, Send, AlertCircle, Volume2, ArrowRight, Edit3 } from 'lucide-react';

const DISCORD_WEBHOOK_URL = import.meta.env?.VITE_DISCORD_WEBHOOK_URL || "";
const GEMINI_API_KEY = import.meta.env?.VITE_GEMINI_API_KEY || "";
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
  const [formData, setFormData] = useState({ name: '', birth: '', phone: '', symptomsRaw: '', symptomsSummary: '' });
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
    const systemPrompt = "당신은 치과를 방문한 환자입니다. 사용자가 말한 증상을 원장님께 직접 말하는 듯한 '자연스러운 1인칭 문장'으로 요약하세요. (~해서 왔어요, ~가 아파요). 요약된 문장만 한 줄로 출력하세요.";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `다음 내용을 환자의 말처럼 요약해줘: ${rawText}` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });
      const data = await response.json();
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || rawText;
      setFormData(prev => ({ ...prev, symptomsSummary: summary }));
    } catch (err) { console.error(err); } finally { setIsProcessing(false); }
  };

  const sendToDiscord = async (finalData) => {
    const embed = {
      title: "🦷 서울복음치과 신규 접수 알림",
      color: 0x2563EB,
      fields: [
        { name: "👤 성함", value: finalData.name, inline: true },
        { name: "🎂 생년월일", value: finalData.birth, inline: true },
        { name: "📞 연락처", value: finalData.phone, inline: true },
        { name: "📝 증상 요약 (AI)", value: finalData.symptomsSummary || finalData.symptomsRaw },
        { name: "🎤 원문 기록", value: finalData.symptomsRaw }
      ],
      timestamp: new Date().toISOString()
    };
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });
    } catch (err) { console.error(err); }
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
        }, 2000);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleNextStep = async () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const stepId = currentStep.id;
    let nextData = { ...formData };
    if (stepId === 'name') nextData.name = transcript;
    else if (stepId === 'birth') nextData.birth = transcript;
    else if (stepId === 'phone') nextData.phone = transcript;
    else if (stepId === 'symptoms') {
      nextData.symptomsRaw = transcript;
      if (!nextData.symptomsSummary) await summarizeSymptoms(transcript);
    }
    setFormData(nextData);
    setTranscript('');
    if (isEditingMode) { setCurrentStepIndex(5); setIsEditingMode(false); }
    else { setCurrentStepIndex(prev => prev + 1); }
  };

  useEffect(() => {
    if (currentStepIndex > 0 || currentStep.id === 'welcome') speak(currentStep.question);
    if (currentStep.id === 'complete') sendToDiscord(formData);
  }, [currentStepIndex]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-8 font-sans">
      <div className="w-full max-w-xl mb-6">
        <h1 className="text-2xl font-black text-blue-900 mb-4">🦷 서울복음치과</h1>
        <div className="w-full bg-white h-3 rounded-full overflow-hidden shadow-sm">
          <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <main className="w-full max-w-xl bg-white rounded-[3rem] shadow-xl border border-blue-50 flex flex-col min-h-[600px] overflow-hidden">
        <div className="p-10 bg-blue-600 text-white text-center">
          <h2 className="text-3xl font-black break-keep">{currentStep.question}</h2>
        </div>
        <div className="flex-1 p-8 flex flex-col justify-center">
          {currentStep.id === 'welcome' ? (
            <button onClick={() => setCurrentStepIndex(1)} className="w-full p-12 bg-blue-50 rounded-[3rem] text-2xl font-black text-blue-900">접수 시작하기</button>
          ) : currentStep.id === 'complete' ? (
            <div className="text-center">
              <CheckCircle size={80} className="mx-auto text-green-500 mb-6" />
              <h3 className="text-3xl font-black mb-4">접수가 완료되었습니다!</h3>
              <p className="text-xl text-slate-600">곧 연락드리겠습니다.</p>
            </div>
          ) : currentStep.id === 'confirm' ? (
            <div className="space-y-4">
              {['성함', '생년월일', '연락처', '증상'].map((label, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-xs font-black text-slate-400">{label}</p>
                  <p className="text-lg font-bold">{Object.values(formData)[i] || formData.symptomsSummary}</p>
                </div>
              ))}
              <button onClick={handleNextStep} className="w-full py-6 bg-blue-600 text-white rounded-[2rem] text-2xl font-black">최종 접수 완료</button>
            </div>
          ) : (
            <div className="space-y-6">
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="w-full p-6 text-xl font-bold bg-slate-50 border-2 rounded-3xl min-h-[150px]" />
              <div className="flex gap-4">
                <button onClick={() => (isListening ? recognitionRef.current.stop() : startListening())} className={`flex-1 py-6 rounded-2xl font-black ${isListening ? 'bg-red-500 text-white' : 'bg-white border-2 border-blue-600 text-blue-600'}`}>
                  {isListening ? '듣는 중' : '음성 입력'}
                </button>
                <button onClick={handleNextStep} className="flex-[2] py-6 bg-blue-600 text-white rounded-2xl font-black text-xl">다음 단계</button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
export default App;
