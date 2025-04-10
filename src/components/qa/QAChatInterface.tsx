"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { MatrixQAResponse, MatrixQARequest } from "@/lib/types";
import { Citation } from "./Citation";
import { useChat } from "ai/react";

interface QAChatInterfaceProps {
  sheetId: string;
  onCitationClick: (blockId: string) => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: MatrixQAResponse["citations"];
  steps?: string[];
}

export const QAChatInterface: React.FC<QAChatInterfaceProps> = ({
  sheetId,
  onCitationClick
}) => {
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [citations, setCitations] = useState<
    Record<string, MatrixQAResponse["citations"]>
  >({});
  const [steps, setSteps] = useState<Record<string, string[]>>({});

  // Use Vercel AI SDK's useChat hook for streaming
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: handleAISubmit,
    isLoading,
    setMessages
  } = useChat({
    api: "/api/matrix-qa",
    body: {
      sheetId,
      conversationId
    },
    onFinish: (message: any) => {
      try {
        // Extract citations and steps from metadata if available
        const metadata = message.metadata as any;
        if (metadata) {
          if (metadata.citations) {
            setCitations((prev) => ({
              ...prev,
              [message.id]: metadata.citations
            }));
          }
          if (metadata.steps) {
            setSteps((prev) => ({
              ...prev,
              [message.id]: metadata.steps
            }));
          }
          if (metadata.conversationId) {
            setConversationId(metadata.conversationId);
          }
        }
      } catch (error) {
        console.error("Error processing message metadata:", error);
      }
    }
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAISubmit(e);
  };

  // Custom component renderer for markdown
  const renderMarkdown = (
    content: string,
    messageCitations?: MatrixQAResponse["citations"]
  ) => {
    const citationMap = new Map(
      messageCitations?.map((c) => [`[cell:${c.blockId}]`, c])
    );

    return (
      <ReactMarkdown
        components={{
          p: ({ node, ...props }) => (
            <p className='mb-2 last:mb-0' {...props} />
          ),
          // Custom renderer to replace citation text with the Citation component
          text: ({ node: textNode, ...textProps }) => {
            const textValue = (textNode as any).value;
            const citationMatch = textValue.match(/(\[cell:[a-fA-F0-9-]+\])/);

            if (citationMatch) {
              const citationText = citationMatch[0];
              const citationData = citationMap.get(citationText);
              const parts = textValue.split(citationText);

              return (
                <>
                  {parts[0]}
                  {citationData ? (
                    <Citation
                      blockId={citationData.blockId}
                      contentSnippet={citationData.contentSnippet}
                      onClick={onCitationClick}
                    />
                  ) : (
                    citationText // Render as text if citation data not found
                  )}
                  {parts[1]}
                </>
              );
            }
            // Create a safe set of props for the span element
            const safeProps = {
              className: textProps.className,
              style: textProps.style,
              id: textProps.id
            };
            return <span {...safeProps}>{textValue}</span>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  return (
    <div className='flex flex-col h-[600px] border rounded bg-white shadow'>
      {/* Message Display Area */}
      <div className='flex-grow overflow-y-auto p-4 space-y-4'>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-lg px-4 py-2 rounded-lg ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-800"
              }`}
            >
              {renderMarkdown(msg.content, citations[msg.id])}
              {/* Optional: Display agent steps */}
              {msg.role === "assistant" && steps[msg.id] && (
                <details className='text-xs mt-2 text-gray-500'>
                  <summary>Agent Steps ({steps[msg.id].length})</summary>
                  <ul className='list-disc pl-4'>
                    {steps[msg.id].map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} /> {/* Anchor for scrolling */}
      </div>

      {/* Input Area */}
      <div className='p-4 border-t'>
        <form onSubmit={handleFormSubmit} className='flex space-x-2'>
          <input
            type='text'
            value={input}
            onChange={handleInputChange}
            placeholder='Ask about the data...'
            disabled={isLoading}
            className='flex-grow px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100'
          />
          <button
            type='submit'
            disabled={isLoading || !input.trim()}
            className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
          >
            {isLoading ? "Thinking..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
};
