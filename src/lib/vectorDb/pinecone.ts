import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || ""
});

const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME || "");

export interface PineconeMetadata {
  blockId: string;
  rowId: string;
  columnId: string;
  sheetId: string;
  orgId: string;
  contentSnippet: string; // Store a snippet for context
}

export interface PineconeVector {
  id: string; // Use blockId
  values: number[];
  metadata: PineconeMetadata;
}

export async function upsertEmbeddings(vectors: PineconeVector[]) {
  if (!vectors || vectors.length === 0) return;
  try {
    // Batch upserts for efficiency
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await pineconeIndex.upsert(batch as any);
      console.log(`Upserted batch ${i / batchSize + 1}`);
    }
  } catch (error) {
    console.error("Error upserting embeddings to Pinecone:", error);
    throw error;
  }
}

export async function queryEmbeddings(
  embedding: number[],
  filter: Partial<PineconeMetadata>, // Filter by orgId, sheetId etc.
  topK: number = 5
): Promise<PineconeVector[]> {
  try {
    const queryResponse = await pineconeIndex.query({
      vector: embedding,
      filter: filter,
      topK: topK,
      includeMetadata: true,
      includeValues: false // Usually don't need vectors back
    });

    return (queryResponse.matches?.map((match) => ({
      id: match.id,
      values: [], // Not requested
      metadata: match.metadata as unknown as PineconeMetadata
      // score: match.score // Pinecone score available if needed
    })) || []) as PineconeVector[];
  } catch (error) {
    console.error("Error querying embeddings from Pinecone:", error);
    throw error;
  }
}
