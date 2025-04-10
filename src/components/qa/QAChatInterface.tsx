"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { MatrixQAResponse, MatrixQARequest } from "@/lib/types";
import { Citation } from "./Citation";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const requestBody: MatrixQARequest = {
        query: input,
        sheetId: sheetId,
        conversationId: conversationId
      };

      const response = await fetch("/api/matrix-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || `Request failed with status ${response.status}`
        );
      }

      const data: MatrixQAResponse = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer,
        citations: data.citations,
        steps: data.steps
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setConversationId(data.conversationId); // Persist conversation ID
    } catch (error: any) {
      console.error("QA Error:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${error.message || "Failed to get response."}`
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Custom component renderer for markdown
  const renderMarkdown = useCallback(
    (content: string, citations?: MatrixQAResponse["citations"]) => {
      const citationMap = new Map(
        citations?.map((c) => [`[cell:${c.blockId}]`, c])
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
    },
    [onCitationClick]
  );

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
              {renderMarkdown(msg.content, msg.citations)}
              {/* Optional: Display agent steps */}
              {msg.role === "assistant" && msg.steps && (
                <details className='text-xs mt-2 text-gray-500'>
                  <summary>Agent Steps ({msg.steps.length})</summary>
                  <ul className='list-disc pl-4'>
                    {msg.steps.map((step, i) => (
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
        <form onSubmit={handleSubmit} className='flex space-x-2'>
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
