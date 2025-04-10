// src/lib/services/MatrixQAService.ts
import { BlockService } from "./BlockService";
import { EmbeddingService } from "./EmbeddingService";
import { ReasoningAgent } from "@/lib/agents/ReasoningAgent";
import { RetrievalAgent } from "@/lib/agents/RetrievalAgent";
import { SynthesisAgent } from "@/lib/agents/SynthesisAgent";
import { MatrixQARequest, MatrixQAResponse, Evidence } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

// Simple in-memory store for conversation history (Replace with DB for production)
const conversationStore: Record<string, any[]> = {};

export class MatrixQAService {
  private blockService: BlockService;
  private embeddingService: EmbeddingService;
  private reasoningAgent: ReasoningAgent;
  private retrievalAgent: RetrievalAgent;
  private synthesisAgent: SynthesisAgent;

  constructor() {
    this.blockService = new BlockService();
    this.embeddingService = new EmbeddingService();
    this.reasoningAgent = new ReasoningAgent();
    this.retrievalAgent = new RetrievalAgent(
      this.blockService,
      this.embeddingService
    );
    this.synthesisAgent = new SynthesisAgent();
  }

  async processQuery(request: MatrixQARequest): Promise<MatrixQAResponse> {
    const { query, sheetId } = request;
    const conversationId = request.conversationId || uuidv4();
    const history = conversationStore[conversationId] || [];
    const steps: string[] = []; // Track agent steps

    try {
      // 1. Get Sheet Context (Columns, Rows)
      steps.push("Fetching sheet context...");
      const columns = await this.blockService.getColumnsBySheetId(sheetId);
      const rows = await this.blockService.getRowsBySheetId(sheetId); // Need row IDs for filtering
      const sheetContext = {
        sheetId,
        columnNames: columns.map((c) => c.properties?.name || c.id),
        rowIds: rows.map((r) => r.id)
      };
      if (rows.length === 0) {
        throw new Error("Sheet contains no rows. Cannot process query.");
      }
      steps.push(`Context: ${columns.length} columns, ${rows.length} rows.`);

      // 2. Reasoning Agent: Plan Retrieval
      steps.push("Planning retrieval...");
      const { plan, thoughts } = await this.reasoningAgent.planRetrieval(
        query,
        sheetContext,
        history
      );
      steps.push(...thoughts.map((t) => `Reasoning: ${t}`));
      steps.push(`Plan generated with ${plan.length} steps.`);
      if (plan.length === 0) {
        steps.push(
          "No retrieval plan generated. Synthesizing based on query alone (likely limited)."
        );
        // Fallback? Or return specific message? For now, proceed to synthesis with no evidence.
      }

      // 3. Retrieval Agent: Execute Plan
      steps.push("Retrieving evidence...");
      const evidence =
        plan.length > 0
          ? await this.retrievalAgent.retrieveEvidence(plan, sheetId)
          : [];
      steps.push(`Retrieved ${evidence.length} evidence pieces.`);

      // 4. Synthesis Agent: Generate Answer
      steps.push("Synthesizing answer...");
      const answer = await this.synthesisAgent.synthesizeAnswer(
        query,
        evidence,
        history
      );
      steps.push("Answer synthesized.");

      // 5. Update Conversation History (Simple)
      history.push({ role: "user", content: query });
      history.push({ role: "assistant", content: answer });
      conversationStore[conversationId] = history;

      // 6. Format Response
      const citations = this.extractCitations(answer, evidence);

      return {
        answer,
        citations,
        conversationId,
        steps
      };
    } catch (error: any) {
      console.error("Error in MatrixQAService:", error);
      // Return a user-friendly error response
      return {
        answer: `Sorry, I encountered an error processing your request: ${error.message}`,
        citations: [],
        conversationId,
        steps: [...steps, `Error: ${error.message}`]
      };
    }
  }

  private extractCitations(
    answer: string,
    evidence: Evidence[]
  ): MatrixQAResponse["citations"] {
    const citationRegex = /\[cell:([a-fA-F0-9-]+)\]/g;
    const citations: MatrixQAResponse["citations"] = [];
    const evidenceMap = new Map(evidence.map((e) => [e.blockId, e]));
    let match;

    while ((match = citationRegex.exec(answer)) !== null) {
      const blockId = match[1];
      const relatedEvidence = evidenceMap.get(blockId);
      citations.push({
        blockId,
        contentSnippet: relatedEvidence?.content.substring(0, 50) + "..." // Add snippet
      });
    }
    // Deduplicate citations by blockId
    return Array.from(new Map(citations.map((c) => [c.blockId, c])).values());
  }
}
