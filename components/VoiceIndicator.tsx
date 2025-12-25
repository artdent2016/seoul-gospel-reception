import React from 'react';

interface VoiceIndicatorProps {
  isListening: boolean;
}

export const VoiceIndicator: React.FC<VoiceIndicatorProps> = ({ isListening }) => {
  if (!isListening) return null;

  return (
    <div className="flex items-center justify-center gap-1.5 h-8">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-1.5 bg-medical-500 rounded-full animate-pulse"
          style={{
            height: `${Math.random() * 16 + 8}px`,
            animationDuration: `${0.6 + Math.random() * 0.4}s`,
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};