import { useEffect, useState } from 'react';
import './AICaption.css';

interface AICaptionProps {
  text: string | null;
  isVisible: boolean;
}

export function AICaption({ text, isVisible }: AICaptionProps) {
  const [displayText, setDisplayText] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!text) {
      setDisplayText(null);
      setIsAnimating(false);
      return;
    }
    
    if (text !== displayText) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayText(text);
        setIsAnimating(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [text, displayText]);

  if (!isVisible || !displayText) {
    return null;
  }

  return (
    <div className={`ai-caption ${isAnimating ? 'fading' : ''}`}>
      <div className="ai-caption-content">
        <span className="ai-caption-text">{displayText}</span>
      </div>
    </div>
  );
}
