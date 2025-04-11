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
    e.preventDefault();
    e.stopPropagation();
    onClick(blockId);
  };

  return (
    <button
      onClick={handleClick}
      title={
        contentSnippet ? `Source: ${contentSnippet}` : `Source Cell: ${blockId}`
      }
      className='inline-block bg-purple-900 bg-opacity-20 text-purple-300 text-xs font-medium px-1.5 py-0.5 rounded hover:bg-opacity-30 focus:outline-none focus:ring-1 focus:ring-purple-700 mx-0.5 align-middle cursor-pointer'
    >
      [{blockId.substring(0, 4)}]
    </button>
  );
};
