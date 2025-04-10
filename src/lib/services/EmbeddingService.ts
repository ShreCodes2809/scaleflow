// src/lib/services/EmbeddingService.ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Consider making model configurable
const EMBEDDING_MODEL = "text-embedding-3-small";

export class EmbeddingService {
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      console.warn("Attempted to generate embedding for empty text.");
      // Return a zero vector or handle as appropriate
      // Fetching dimension dynamically or setting a constant is needed
      // Example dimension for text-embedding-3-small
      return Array(1024).fill(0);
    }

    try {
      // Normalize whitespace and potentially truncate long text
      const inputText = text.replace(/\s+/g, " ").trim().slice(0, 8000); // Truncate based on model limits

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputText,
        dimensions: 1024
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating embedding:", error);
      // Depending on the error, you might want to retry or return a zero vector
      throw new Error(
        `Failed to generate embedding: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    // Implement batching if the OpenAI client/library supports it directly
    // Otherwise, process in parallel (with rate limiting considerations)
    // For simplicity, using Promise.all here:
    try {
      // Normalize/truncate texts first
      const inputTexts = texts.map((text) =>
        (text || "").replace(/\s+/g, " ").trim().slice(0, 8000)
      );

      // Filter out any empty strings after processing
      const validTexts = inputTexts.filter((text) => text.length > 0);
      if (validTexts.length === 0) return [];

      // Note: Check OpenAI API limits for batch size if sending multiple inputs
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: validTexts,
        dimensions: 1024
      });

      // Need to map results back carefully if some inputs were filtered out
      const embeddingMap = new Map<string, number[]>();
      response.data.forEach((embeddingData, index) => {
        embeddingMap.set(validTexts[index], embeddingData.embedding);
      });

      // Return embeddings in the original order, using zero vectors for filtered inputs
      return inputTexts.map(
        (text) => embeddingMap.get(text) || Array(1024).fill(0)
      );
    } catch (error) {
      console.error("Error generating embeddings batch:", error);
      throw new Error(
        `Failed to generate embeddings batch: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
