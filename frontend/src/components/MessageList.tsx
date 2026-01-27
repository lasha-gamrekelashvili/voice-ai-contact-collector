import React, { useEffect, useRef } from 'react';
import { Message } from '../types';
import './MessageList.css';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="message-list" ref={listRef}>
      {messages.map((message) => (
        <div 
          key={message.id} 
          className={`message ${message.role}`}
        >
          <div className="message-avatar">
            {message.role === 'user' ? '👤' : '🤖'}
          </div>
          <div className="message-content">
            <span className="message-role">
              {message.role === 'user' ? 'You' : 'AI Assistant'}
            </span>
            <p className="message-text">{message.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
