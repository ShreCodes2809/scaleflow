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
    onClick(blockId);
  };

  return (
    <button
      onClick={handleClick}
      title={
        contentSnippet ? `Source: ${contentSnippet}` : `Source Cell: ${blockId}`
      }
      className='inline-block bg-blue-100 text-blue-800 text-xs font-medium px-1.5 py-0.5 rounded hover:bg-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-300 mx-0.5 align-middle'
    >
      [{blockId.substring(0, 4)}] {/* Show partial ID */}
    </button>
  );
};
