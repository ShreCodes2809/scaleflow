// src/components/qa/Citation.tsx
import React from "react";

interface CitationProps {
  blockId: string;
  contentSnippet?: string;
  onClick: (blockId: string) => void;
}

export const Citation: React.FC<CitationProps> = ({
  blockId,
  contentSnippet,
  onClick
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent any default button behavior
    e.stopPropagation(); // Prevent event bubbling if needed
    onClick(blockId);
  };

  // Use Tailwind classes for purple background, text, and hover effect
  // Adjust shades (e.g., purple-100, purple-200, purple-800) as needed
  return (
    <button
      onClick={handleClick}
      title={
        contentSnippet ? `Source: ${contentSnippet}` : `Source Cell: ${blockId}`
      }
      className='inline-block bg-purple-100 text-purple-800 text-xs font-medium px-1.5 py-0.5 rounded hover:bg-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-300 mx-0.5 align-middle cursor-pointer' // Added cursor-pointer
    >
      {/* Displaying a short, consistent identifier might be better than first 4 chars */}
      {/* Example: Use a hash or a sequence number if available, or keep short UUID */}
      [{blockId.substring(0, 4)}] {/* Show partial ID */}
    </button>
  );
};
