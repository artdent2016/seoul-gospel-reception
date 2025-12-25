import { GoogleGenAI } from "@google/genai";

const getClient = () => {
  // Always use process.env.API_KEY as per best practices and system instructions.
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please check your environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Summarizes the patient's symptoms into a concise note from the patient's perspective.
 */
export const summarizeSymptoms = async (rawSymptoms: string): Promise<string> => {
  const ai = getClient();
  
  // Use JSON.stringify to safely escape special characters or newlines in the user input
  const safeInput = JSON.stringify(rawSymptoms);

  const prompt = `
    당신은 환자의 말을 정리해주는 AI 비서입니다.
    환자가 두서없이 말한 증상 내용을 듣고, **환자 본인이 의사에게 명확하게 전달하는 말투**로 요약 정리해주세요.
    
    [환자의 말]: ${safeInput}
    
    [필수 요청사항]:
    1. **1인칭 시점**("저", "제")을 사용하여 환자가 직접 말하는 것처럼 작성하세요. (예: "오른쪽 어금니가 욱신거리고 찬 물을 마실 때 시려요. 스케일링을 받고 싶어요.")
    2. 통증 부위, 증상, 기간, 원하는 치료 등을 명확하고 간결하게 2~3문장으로 정리하세요.
    3. 불필요한 추임새나 반복되는 말은 제거하고, 핵심 내용만 자연스럽게 연결하세요.
    4. 존댓말(해요체)을 사용하세요.
    5. 의학 전문 용어보다는 환자가 이해하고 확인하기 쉬운 표현을 사용하세요.
  `;

  // Helper to run generation
  const runModel = async (modelName: string) => {
    return await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });
  };

  try {
    // 1. Try Primary Model (Optimized for Basic Text Tasks)
    const response = await runModel("gemini-3-flash-preview");
    return response.text?.trim() || "증상을 요약할 수 없습니다.";
  } catch (error) {
    console.warn("Primary model failed, attempting fallback...", error);
    
    try {
      // 2. Try Fallback Model (Experimental Flash)
      const response = await runModel("gemini-2.0-flash-exp");
      return response.text?.trim() || "증상을 요약할 수 없습니다.";
    } catch (finalError) {
      console.error("All Gemini models failed:", finalError);
      return "AI 연결 상태가 불안정하여 원문 그대로 접수합니다.";
    }
  }
};