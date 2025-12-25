export interface PatientData {
  name: string;
  dob: string;
  phone: string;
  symptoms: string;
}

export enum StepId {
  NAME = 0,
  DOB = 1,
  PHONE = 2,
  SYMPTOMS = 3,
  SYMPTOM_CHECK = 4, // New step for verifying AI summary
  REVIEW = 5,
  COMPLETED = 6,
}

export interface QuestionStep {
  id: StepId;
  label: string;
  question: string; // Spoken text
  placeholder: string;
  inputType: 'text' | 'tel' | 'date' | 'textarea';
}

// Global declaration for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

export type WebhookPayload = {
  content: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
  }>;
};