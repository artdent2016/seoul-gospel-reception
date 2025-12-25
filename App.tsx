import React, { useState, useEffect, useRef, useCallback } from 'react';
import { summarizeSymptoms } from './services/geminiService';
import { PatientData, StepId, QuestionStep, WebhookPayload } from './types';
import { VoiceIndicator } from './components/VoiceIndicator';

// --- Constants ---
const STEPS: QuestionStep[] = [
  { id: StepId.NAME, label: "성함", question: "환자분의 성함을 말씀해 주세요.", placeholder: "예: 홍길동 (한글 입력)", inputType: "text" },
  { id: StepId.DOB, label: "생년월일", question: "생년월일 8자리를 말씀해 주세요. (예: 19800101)", placeholder: "예: 19800101 (8자리 숫자)", inputType: "tel" }, 
  { id: StepId.PHONE, label: "연락처", question: "연락 받으실 휴대폰 번호 11자리를 말씀해 주세요.", placeholder: "01012345678 (11자리 숫자)", inputType: "tel" },
  { id: StepId.SYMPTOMS, label: "주요 증상", question: "어디가 불편하신가요? 증상을 자세히 말씀해 주세요.", placeholder: "증상을 자세히 설명해주세요...", inputType: "textarea" },
  { id: StepId.SYMPTOM_CHECK, label: "증상 확인", question: "제가 이해한 내용이 맞나요? 내용을 확인해 주시고, 맞으면 네, 아니면 수정이라고 말씀해 주세요.", placeholder: "", inputType: "textarea" },
  { id: StepId.REVIEW, label: "내용 확인", question: "접수하시기 전에 최종 내용을 확인해 주세요. 수정할 부분이 있다면 수정 버튼을 눌러주세요.", placeholder: "", inputType: "textarea" },
  { id: StepId.COMPLETED, label: "접수 완료", question: "접수가 완료되었습니다. 병원에서 곧 연락드리겠습니다.", placeholder: "", inputType: "text" },
];

const App: React.FC = () => {
  // --- State ---
  const [hasStarted, setHasStarted] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<StepId>(StepId.NAME);
  const [returnToStepId, setReturnToStepId] = useState<StepId | null>(null);

  const [patientData, setPatientData] = useState<PatientData>({
    name: '',
    dob: '',
    phone: '',
    symptoms: ''
  });
  const [summary, setSummary] = useState<string>('');
  const [draftSummary, setDraftSummary] = useState<string>('');
  const [isSummarizingRealtime, setIsSummarizingRealtime] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  // --- Refs ---
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  
  // Refs for callbacks to access latest state in event listeners
  const currentStepIdRef = useRef(currentStepId);
  const isListeningRef = useRef(isListening);
  const isProcessingAIRef = useRef(isProcessingAI);
  const isSpeakingRef = useRef(isSpeaking);

  useEffect(() => { currentStepIdRef.current = currentStepId; }, [currentStepId]);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { isProcessingAIRef.current = isProcessingAI; }, [isProcessingAI]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // --- Helpers ---
  const currentStep = STEPS[currentStepId];

  const formatTextForTTS = (text: string) => {
    return text.replace(/\d+/g, (match) => match.split('').join(' '));
  };

  const parseDOB = (text: string): string => {
    const dateRegex = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/;
    const match = text.match(dateRegex);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}${month}${day}`;
    }
    return text.replace(/[^0-9]/g, '');
  };

  const validateStep = (stepId: StepId, data: PatientData): { isValid: boolean; message?: string } => {
    const val = (str: string) => str ? str.trim() : '';

    switch (stepId) {
      case StepId.NAME:
        if (val(data.name).length < 2) return { isValid: false, message: "성함을 정확히 입력해주세요." };
        break;
      case StepId.DOB:
        const dobDigits = val(data.dob); 
        if (dobDigits.length !== 8) return { isValid: false, message: "생년월일은 년월일 8자리로 입력해주세요. (예: 19800101)" };
        break;
      case StepId.PHONE:
        const phoneDigits = val(data.phone); 
        if (!phoneDigits.startsWith('010') || phoneDigits.length !== 11) return { isValid: false, message: "휴대폰 번호는 010으로 시작하는 11자리 숫자여야 합니다." };
        break;
      case StepId.SYMPTOMS:
        if (val(data.symptoms).length < 5) return { isValid: false, message: "증상을 조금 더 자세히 말씀해주세요." };
        break;
    }
    return { isValid: true };
  };

  const isDOBComplete = (text: string) => text.length >= 8;
  const isPhoneComplete = (text: string) => text.length >= 11;

  // --- Real-time Summarization ---
  useEffect(() => {
    if (currentStepId === StepId.SYMPTOMS && patientData.symptoms.trim().length > 10) {
      const timer = setTimeout(async () => {
        setIsSummarizingRealtime(true);
        const result = await summarizeSymptoms(patientData.symptoms);
        setDraftSummary(result);
        setIsSummarizingRealtime(false);
      }, 2000);
      return () => clearTimeout(timer);
    } else if (currentStepId === StepId.SYMPTOMS && patientData.symptoms.trim().length <= 10) {
      setDraftSummary('');
    }
  }, [patientData.symptoms, currentStepId]);


  // --- Speech Recognition (STT) ---
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (isListeningRef.current) return;
    
    // Safety check: Don't listen if speaking
    if (synthesisRef.current.speaking) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    
    // Mobile optimization
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    recognition.continuous = !isMobile; 
    
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };

    recognition.onresult = (event: any) => {
      let finalScript = '';
      let interimScript = '';

      if (typeof event.results === 'undefined') {
        recognition.stop();
        return;
      }

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalScript += event.results[i][0].transcript;
        } else {
          interimScript += event.results[i][0].transcript;
        }
      }

      setInterimTranscript(interimScript);

      if (finalScript) {
        handleInputChange(finalScript, true);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      recognitionRef.current = null;
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        console.warn("Speech error", event.error);
      }
      setIsListening(false);
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error("Failed to start recognition:", e);
      setIsListening(false);
    }
  }, []);

  // --- Speech Synthesis (TTS) ---
  const speak = useCallback((text: string) => {
    if (!synthesisRef.current) return;
    
    // Stop any current audio or listening
    stopListening();
    synthesisRef.current.cancel();

    const cleanText = text.replace(/\([^)]*\)/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
    };
    
    utterance.onerror = () => setIsSpeaking(false);
    
    utterance.onend = () => {
      setIsSpeaking(false);
      // Automatically start listening after TTS finishes
      // Check conditions to ensure we should be listening
      const step = currentStepIdRef.current;
      const isProcessing = isProcessingAIRef.current;
      
      if (
        step !== StepId.COMPLETED && 
        step !== StepId.REVIEW && 
        step !== StepId.SYMPTOM_CHECK && 
        !isProcessing
      ) {
          // Add a small delay to prevent echo
          setTimeout(() => {
            startListening();
          }, 100);
      }
    };

    synthesisRef.current.speak(utterance);
  }, [stopListening, startListening]);

  // --- Start Interaction ---
  const handleStart = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
    } catch (err) {
        console.warn("Permission denied:", err);
        alert("마이크 권한을 허용해주셔야 상담이 가능합니다.");
        return;
    }

    setHasStarted(true);
    speak(STEPS[StepId.NAME].question);
  };

  // --- Data Handling ---
  const handleInputChange = (value: string, append: boolean = false) => {
    const stepId = currentStepIdRef.current;
    
    // Command handling for check steps
    if (stepId === StepId.REVIEW || stepId === StepId.SYMPTOM_CHECK) {
      // Here you could implement "yes/no" voice commands if desired
      return;
    }

    const fieldMap: Record<number, keyof PatientData> = {
      [StepId.NAME]: 'name',
      [StepId.DOB]: 'dob',
      [StepId.PHONE]: 'phone',
      [StepId.SYMPTOMS]: 'symptoms',
    };

    const field = fieldMap[stepId];
    if (field) {
      setPatientData(prev => {
        let rawNewValue = append ? (prev[field] + ' ' + value) : value;
        let processedValue = rawNewValue.trim();

        if (stepId === StepId.NAME) {
            processedValue = processedValue.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ\s]/g, '');
        } else if (stepId === StepId.DOB) {
            processedValue = parseDOB(rawNewValue);
            if (processedValue.length > 8) processedValue = processedValue.slice(0, 8);
        } else if (stepId === StepId.PHONE) {
            processedValue = processedValue.replace(/[^0-9]/g, '');
            if (processedValue.length > 11) processedValue = processedValue.slice(0, 11);
        }
        
        // Auto-advance logic for fixed length inputs
        if (stepId === StepId.DOB && append && isDOBComplete(processedValue)) {
            setTimeout(() => stopListening(), 500);
        }
        if (stepId === StepId.PHONE && append && isPhoneComplete(processedValue)) {
            setTimeout(() => stopListening(), 500);
        }
        
        return { ...prev, [field]: processedValue };
      });
    }
  };

  // --- Flow Control ---
  useEffect(() => {
    if (!hasStarted) return;

    if (currentStepId !== StepId.COMPLETED) {
      if (currentStepId === StepId.NAME && !patientData.name) {
         return; 
      }

      const timer = setTimeout(() => {
        let text = STEPS[currentStepId].question;
        if (currentStepId === StepId.SYMPTOM_CHECK) {
           text = `제가 이해한 내용이 맞나요? ${summary}. 맞으면 예, 아니면 수정이라고 말씀해 주세요.`;
        }
        if (currentStepId === StepId.DOB) {
            text = formatTextForTTS(text);
        }
        speak(text);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      speak(STEPS[currentStepId].question);
    }
  }, [currentStepId, speak, summary, hasStarted]); 

  const handleNext = async () => {
    const validation = validateStep(currentStepId, patientData);
    if (!validation.isValid) {
      alert(validation.message);
      return;
    }

    stopListening();
    synthesisRef.current.cancel();

    if (currentStepId === StepId.SYMPTOMS) {
      if (draftSummary && !isSummarizingRealtime) {
        setSummary(draftSummary);
        setCurrentStepId(StepId.SYMPTOM_CHECK);
      } else {
        setIsProcessingAI(true);
        const aiSummary = await summarizeSymptoms(patientData.symptoms);
        setSummary(aiSummary);
        setIsProcessingAI(false);
        setCurrentStepId(StepId.SYMPTOM_CHECK);
      }
    } else if (currentStepId === StepId.SYMPTOM_CHECK) {
      setCurrentStepId(StepId.REVIEW);
    } else if (currentStepId === StepId.REVIEW) {
      await sendToDiscord();
      setCurrentStepId(StepId.COMPLETED);
    } else {
      if (returnToStepId !== null) {
        setCurrentStepId(returnToStepId);
        setReturnToStepId(null);
      } else {
        setCurrentStepId(prev => prev + 1);
      }
    }
  };

  const handleBack = () => {
    stopListening();
    synthesisRef.current.cancel();
    if (currentStepId > StepId.NAME && currentStepId !== StepId.COMPLETED) {
      setCurrentStepId(prev => prev - 1);
    }
  };

  const handleEdit = (targetStepId: StepId) => {
    stopListening();
    synthesisRef.current.cancel();
    if (currentStepId === StepId.REVIEW) {
      setReturnToStepId(StepId.REVIEW);
    } else if (currentStepId === StepId.SYMPTOM_CHECK) {
      setReturnToStepId(null); 
    }
    if (targetStepId === StepId.SYMPTOMS) {
      setSummary('');
      setDraftSummary('');
    }
    setCurrentStepId(targetStepId);
  };

  const sendToDiscord = async () => {
    // Discord Webhook URL provided
    const webhookUrl = "https://discord.com/api/webhooks/1453637431629975633/4iR14c4AHq_OLoy1iWJqHeZrsAUpsbwDrSTb45KVy99zCzM5hNM7vTWDisUUW_bDIgNU";
    
    const payload: WebhookPayload = {
      content: "🏥 **새로운 환자 상담 접수 (서울복음치과)**",
      embeds: [{
        title: "환자 정보 요약",
        description: "웹앱을 통해 접수된 상담 내용입니다.",
        color: 3447003,
        fields: [
          { name: "이름", value: patientData.name, inline: true },
          { name: "생년월일", value: patientData.dob, inline: true },
          { name: "연락처", value: patientData.phone, inline: true },
          { name: "증상 요약 (환자 구술)", value: summary },
          { name: "원문", value: patientData.symptoms }
        ]
      }]
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error("Webhook failed", e);
    }
  };

  // --- Rendering ---
  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-medical-50 flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-medical-100 to-white opacity-80" />
        <div className="absolute top-10 left-10 w-32 h-32 bg-medical-200 rounded-full blur-3xl opacity-50 animate-pulse" />
        <div className="absolute bottom-10 right-10 w-48 h-48 bg-blue-200 rounded-full blur-3xl opacity-50 animate-pulse" style={{ animationDelay: '1s' }} />

        <div className="relative z-10 max-w-md w-full bg-white/80 backdrop-blur-sm rounded-3xl shadow-2xl p-8 text-center border border-white/50">
          <div className="mb-8 flex justify-center">
            <div className="w-20 h-20 bg-medical-100 rounded-full flex items-center justify-center shadow-inner">
               <svg className="w-10 h-10 text-medical-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-3">서울복음치과</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">안녕하세요.<br/>AI 음성 상담 접수 시스템입니다.</p>
          <button onClick={handleStart} className="w-full bg-medical-600 hover:bg-medical-700 text-white text-xl font-bold py-4 rounded-xl shadow-lg transform transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
            상담 시작하기
          </button>
        </div>
      </div>
    );
  }

  const renderInputArea = () => {
    if (currentStepId === StepId.SYMPTOM_CHECK) {
       return (
        <div className="w-full flex flex-col gap-4">
           <div className="w-full bg-medical-50 rounded-xl border border-medical-200 p-6 flex flex-col items-center justify-center text-center space-y-4 shadow-inner">
              <h3 className="text-xl font-bold text-slate-800">증상 요약 확인</h3>
              <p className="text-lg text-slate-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
           </div>
           <div className="flex gap-3 w-full">
              <button onClick={() => handleEdit(StepId.SYMPTOMS)} className="flex-1 py-4 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors">수정하기</button>
              <button onClick={handleNext} className="flex-1 py-4 rounded-xl bg-medical-600 text-white font-bold hover:bg-medical-700 transition-colors shadow-lg">네, 맞습니다</button>
           </div>
        </div>
       );
    }

    if (currentStepId === StepId.REVIEW) {
      return (
        <div className="w-full space-y-4 text-left pb-4">
          <h3 className="text-center text-lg font-bold text-slate-800 mb-4">최종 접수 정보 확인</h3>
          <div className="space-y-3">
            {[
              { label: "성함", value: patientData.name, step: StepId.NAME },
              { label: "생년월일", value: patientData.dob, step: StepId.DOB },
              { label: "연락처", value: patientData.phone, step: StepId.PHONE }
            ].map(item => (
              <div key={item.label} className="bg-white p-4 rounded-xl border border-medical-100 shadow-sm flex justify-between items-center">
                <div><p className="text-xs text-slate-400 font-semibold">{item.label}</p><p className="text-lg text-slate-800 font-medium">{item.value}</p></div>
                <button onClick={() => handleEdit(item.step)} className="text-sm bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">수정</button>
              </div>
            ))}
            <div className="bg-medical-50 p-4 rounded-xl border border-medical-200 shadow-sm ring-2 ring-medical-100">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs text-medical-600 font-semibold">증상 내용 정리 (AI)</p>
                <button onClick={() => handleEdit(StepId.SYMPTOMS)} className="text-sm bg-white text-medical-600 border border-medical-200 px-3 py-1.5 rounded-lg hover:bg-medical-50">수정하기</button>
              </div>
              <p className="text-lg text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">{summary}</p>
            </div>
          </div>
        </div>
      );
    }

    if (currentStepId === StepId.COMPLETED) {
      return (
        <div className="w-full flex flex-col">
          <div className="text-center mb-6 shrink-0">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4 animate-bounce">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">접수 완료</h2>
            <p className="text-slate-500 mt-2">입력하신 내용이 병원으로 안전하게 전송되었습니다.</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-6 text-left space-y-4 shadow-inner">
             {/* Content similar to review but read-only */}
             <div className="grid grid-cols-1 gap-4">
                 <p><strong>성함:</strong> {patientData.name}</p>
                 <p><strong>증상:</strong> {summary}</p>
             </div>
          </div>
        </div>
      );
    }

    const commonClasses = "w-full p-4 text-2xl border-b-2 border-medical-200 bg-transparent focus:border-medical-600 focus:outline-none transition-colors placeholder:text-slate-300 text-center";
    
    if (currentStep.inputType === 'textarea') {
      return (
        <div className="w-full flex flex-col">
          <textarea
            className={`${commonClasses} resize-none min-h-[150px] mb-4`}
            placeholder={currentStep.placeholder}
            value={patientData.symptoms}
            onChange={(e) => handleInputChange(e.target.value)}
          />
          <div className="w-full bg-medical-50 rounded-xl border border-medical-100 p-4 transition-all duration-300 min-h-[100px]">
             <div className="flex items-center gap-2 mb-2 text-medical-700 font-semibold text-sm">
                AI 실시간 요약 미리보기
             </div>
             {isSummarizingRealtime ? (
               <div className="text-medical-400 text-sm animate-pulse">내용을 분석하고 있습니다...</div>
             ) : draftSummary ? (
               <p className="text-slate-700 text-base leading-relaxed animate-fade-in whitespace-pre-wrap">{draftSummary}</p>
             ) : (
               <p className="text-medical-300 text-sm">증상을 말씀하시면 AI가 자동으로 요약하여 여기에 보여줍니다.</p>
             )}
          </div>
        </div>
      );
    }

    return (
      <input
        type={currentStep.inputType}
        className={commonClasses}
        placeholder={currentStep.placeholder}
        value={
          currentStepId === StepId.NAME ? patientData.name :
          currentStepId === StepId.DOB ? patientData.dob :
          currentStepId === StepId.PHONE ? patientData.phone : ''
        }
        onChange={(e) => handleInputChange(e.target.value)}
      />
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 py-8 md:p-6 relative">
      <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-medical-100 to-transparent pointer-events-none" />
      <main className="w-full max-w-lg bg-white rounded-3xl shadow-xl z-10 relative flex flex-col">
        <header className="bg-medical-600 p-6 text-white shrink-0 rounded-t-3xl">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold">서울복음치과</h1>
            {currentStepId < StepId.COMPLETED && <span className="text-medical-200 text-sm font-medium">{currentStepId + 1} / 6</span>}
          </div>
          {currentStepId < StepId.COMPLETED && (
            <div className="w-full bg-medical-800/30 rounded-full h-1.5">
              <div className="bg-white h-1.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${((currentStepId + 1) / 6) * 100}%` }} />
            </div>
          )}
        </header>

        <div className="p-6 md:p-8 flex flex-col items-center">
          {currentStepId !== StepId.COMPLETED && currentStepId !== StepId.SYMPTOM_CHECK && (
            <div className="w-full text-center mb-8 min-h-[60px] flex items-center justify-center">
               {isProcessingAI ? (
                 <div className="text-medical-600 font-bold animate-pulse">AI가 정리중입니다...</div>
               ) : (
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-800 leading-tight">{currentStep.question}</h2>
               )}
            </div>
          )}
          <div className="w-full flex flex-col items-center justify-start">
             {!isProcessingAI && renderInputArea()}
             {isListening && interimTranscript && !isProcessingAI && currentStepId !== StepId.SYMPTOMS && currentStepId !== StepId.SYMPTOM_CHECK && (
               <div className="mt-4 text-slate-400 text-sm animate-pulse">"{interimTranscript}"</div>
             )}
          </div>
        </div>

        {currentStepId !== StepId.COMPLETED && currentStepId !== StepId.SYMPTOM_CHECK && !isProcessingAI && (
          <footer className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col gap-4 rounded-b-3xl">
            <div className="flex items-center justify-between w-full gap-4">
              {currentStepId !== StepId.REVIEW && (
                <button onClick={handleBack} disabled={currentStepId === 0} className={`p-3 rounded-full transition-colors ${currentStepId === 0 ? 'text-slate-300' : 'text-slate-500 hover:bg-slate-200'}`}>
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}
              {currentStepId === StepId.REVIEW && <div className="w-12"></div>}

              {currentStepId !== StepId.REVIEW ? (
                <div className="relative">
                  {isListening && <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-75"></div>}
                  <button onClick={() => startListening()} className={`relative z-10 p-5 rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95 ${isListening ? 'bg-red-500 text-white' : 'bg-medical-500 text-white'}`}>
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isListening ? "M21 12a9 9 0 11-18 0 9 9 0 0118 0z" : "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"} /></svg>
                  </button>
                </div>
              ) : <div className="w-10"></div>}

              <button onClick={handleNext} className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-full font-semibold hover:bg-slate-800 transition-colors shadow-md">
                {currentStepId === StepId.REVIEW ? '최종 접수' : '다음'}
              </button>
            </div>
            {currentStepId !== StepId.REVIEW && (
              <>
                <div className="h-6 flex items-center justify-center"><VoiceIndicator isListening={isListening} /></div>
                <p className="text-center text-xs text-slate-400">{isListening ? '말씀하신 후 다음 버튼을 누르세요.' : '질문이 끝나면 마이크가 켜집니다.'}</p>
              </>
            )}
          </footer>
        )}
      </main>
    </div>
  );
};

export default App;