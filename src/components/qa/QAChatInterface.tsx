// src/components/qa/QAChatInterface.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { MatrixQAResponse } from "@/lib/types";
import { Citation } from "./Citation";
import { useChat, Message as VercelMessage } from "ai/react";

interface QAChatInterfaceProps {
  sheetId: string;
  onCitationClick: (blockId: string) => void;
}

export const QAChatInterface: React.FC<QAChatInterfaceProps> = ({
  sheetId,
  onCitationClick
}) => {
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  // State to store metadata (citations, steps) associated with message IDs
  const [messageMetadata, setMessageMetadata] = useState<
    Record<
      string,
      {
        citations?: MatrixQAResponse["citations"];
        steps?: string[];
      }
    >
  >({});

  // State to temporarily hold metadata from the latest response header
  const [lastResponseMetadata, setLastResponseMetadata] = useState<any>(null);

  const {
    messages: vercelMessages,
    input,
    handleInputChange,
    handleSubmit: handleAISubmit,
    isLoading,
    setMessages,
    reload,
    stop
  } = useChat({
    api: "/api/matrix-qa",
    body: {
      sheetId,
      conversationId
    },
    // --- Capture metadata from header ---
    onResponse: (response) => {
      console.log("onResponse received");
      const resMetadataHeader = response.headers.get("X-Metadata");
      if (resMetadataHeader) {
        try {
          const resMetadata = JSON.parse(resMetadataHeader);
          console.log("Metadata from header:", resMetadata);
          // Store the latest metadata received
          setLastResponseMetadata(resMetadata);
          // Set conversationId immediately if available and not set
          if (resMetadata.conversationId && !conversationId) {
            setConversationId(resMetadata.conversationId);
          }
        } catch (e) {
          console.error("Failed to parse X-Metadata header", e);
          setLastResponseMetadata(null); // Clear if parsing fails
        }
      } else {
        console.log("No X-Metadata header found in response.");
        setLastResponseMetadata(null); // Clear if header is missing
      }
    },
    // --- Associate metadata with the completed message ---
    onFinish: (message) => {
      console.log(
        `onFinish for message ${message.id}. Last metadata:`,
        lastResponseMetadata
      );
      // Associate the *last received* metadata with this finished message
      if (lastResponseMetadata) {
        setMessageMetadata((prev) => ({
          ...prev,
          [message.id]: {
            citations: lastResponseMetadata.citations,
            steps: lastResponseMetadata.steps
          }
        }));
        // Clear the temporary metadata holder
        setLastResponseMetadata(null);
      }
      // Update conversationId if it came late
      if (lastResponseMetadata?.conversationId && !conversationId) {
        setConversationId(lastResponseMetadata.conversationId);
      }
    },
    onError: (error) => {
      console.error("Chat error:", error);
      setLastResponseMetadata(null); // Clear temp metadata on error
    }
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [vercelMessages]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLastResponseMetadata(null); // Clear temp metadata before new request
    handleAISubmit(e, {
      options: {
        body: {
          sheetId,
          conversationId
        }
      }
    });
  };

  // Render individual message content with markdown and citations
  const renderMessageContent = (messageId: string, content: string) => {
    // Get metadata specific to this message ID from state
    const metadata = messageMetadata[messageId] || {};
    const messageCitations = metadata.citations || [];

    // Create a mapping of citation IDs to their data
    const citationMap = new Map();
    messageCitations.forEach((citation) => {
      citationMap.set(citation.blockId, citation);
    });

    // Create a regex that looks for the citation pattern
    const regex = /\[cell:([a-fA-F0-9-]+)\]/g;

    // Split the content into parts (text and citations)
    const parts = [];
    let lastIndex = 0;
    let match;

    // Make a copy of content to manipulate
    let tempContent = content;

    // Find all matches in the content
    while ((match = regex.exec(tempContent)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textPart = tempContent.substring(lastIndex, match.index);
        parts.push({
          type: "text",
          content: textPart
        });
      }

      // Add the citation
      const blockId = match[1];
      parts.push({
        type: "citation",
        blockId: blockId,
        contentSnippet: citationMap.get(blockId)?.contentSnippet
      });

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining text
    if (lastIndex < tempContent.length) {
      parts.push({
        type: "text",
        content: tempContent.substring(lastIndex)
      });
    }

    // Render the parts
    return parts.map((part, index) => {
      if (part.type === "text") {
        // Use ReactMarkdown to render text parts with markdown formatting
        return (
          <React.Fragment key={`${messageId}-text-${index}`}>
            <ReactMarkdown>{part.content}</ReactMarkdown>
          </React.Fragment>
        );
      } else {
        // Render citation components directly
        return (
          <Citation
            key={`${messageId}-citation-${index}`}
            blockId={part.blockId || ""}
            contentSnippet={part.contentSnippet}
            onClick={onCitationClick}
          />
        );
      }
    });
  };

  return (
    <div className='flex flex-col h-full border rounded bg-white shadow overflow-hidden'>
      {/* Message Display Area */}
      <div className='flex-grow overflow-y-auto p-4 space-y-4'>
        {vercelMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-lg px-4 py-2 rounded-lg shadow-sm ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {/* Use the updated rendering function */}
              <div
                className={`prose prose-sm max-w-none ${
                  msg.role === "user" ? "prose-invert" : ""
                }`}
              >
                {renderMessageContent(msg.id, msg.content)}
              </div>

              {/* Optional: Display agent steps */}
              {msg.role === "assistant" && messageMetadata[msg.id]?.steps && (
                <details className='text-xs mt-2 text-gray-500 cursor-pointer'>
                  <summary>
                    Agent Steps ({messageMetadata[msg.id]?.steps?.length})
                  </summary>
                  <ul className='list-disc pl-4 mt-1'>
                    {messageMetadata[msg.id]?.steps?.map((step, i) => (
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
      <div className='p-4 border-t bg-gray-50 flex-shrink-0'>
        <form onSubmit={handleFormSubmit} className='flex space-x-2'>
          <input
            type='text'
            value={input}
            onChange={handleInputChange}
            placeholder='Ask about the data...'
            disabled={isLoading}
            className='flex-grow px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100'
            aria-label='Chat input'
          />
          <button
            type='submit'
            disabled={isLoading || !input.trim()}
            className='px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
            aria-label='Send chat message'
          >
            {isLoading ? (
              <span className='flex items-center'>
                <svg
                  className='animate-spin -ml-1 mr-2 h-4 w-4 text-white'
                  xmlns='http://www.w3.org/2000/svg'
                  fill='none'
                  viewBox='0 0 24 24'
                >
                  <circle
                    className='opacity-25'
                    cx='12'
                    cy='12'
                    r='10'
                    stroke='currentColor'
                    strokeWidth='4'
                  ></circle>
                  <path
                    className='opacity-75'
                    fill='currentColor'
                    d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                  ></path>
                </svg>
                Thinking...
              </span>
            ) : (
              "Send"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
