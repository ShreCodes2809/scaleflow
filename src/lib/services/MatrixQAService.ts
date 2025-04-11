// src/lib/services/MatrixQAService.ts
import { BlockService } from "./BlockService";
import { EmbeddingService } from "./EmbeddingService";
import { ReasoningAgent, RetrievalPlan } from "@/lib/agents/ReasoningAgent";
import { RetrievalAgent } from "@/lib/agents/RetrievalAgent";
import { SynthesisAgent } from "@/lib/agents/SynthesisAgent";
import {
  MatrixQARequest,
  MatrixQAResponse,
  Evidence,
  CellBlock,
  BlockTypeEnum
} from "@/lib/types";
import { v4 as uuidv4 } from "uuid";
import { ChatOpenAI } from "@langchain/openai";
import { LangChainStream, StreamingTextResponse } from "ai"; // StreamingTextResponse might be used in API route
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

// Enhanced conversation history structure
interface ConversationState {
  messages: any[]; // Consider defining a stricter type e.g., { role: 'user' | 'assistant', content: string }[]
  schema?: SchemaInfo;
  lastQuery?: string;
  lastAnswer?: string;
}

// Schema analysis type definitions
interface SchemaInfo {
  columnTypes: Record<string, string>; // Key: columnName, Value: inferredType ('number', 'text', 'date', etc.)
  primaryKeyCandidate: string | null;
  valueColumns: string[]; // Columns likely containing numerical or date values for analysis
  relationships?: Record<string, string[]>; // Potential relationships between columns
}

// Simple in-memory store for conversation history (Replace with DB for production)
const conversationStore: Record<string, ConversationState> = {};

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

  // Original method for non-streaming responses (Keep as is)
  async processQuery(request: MatrixQARequest): Promise<MatrixQAResponse> {
    const { sheetId } = request;
    const conversationId = request.conversationId || uuidv4();

    // Initialize or retrieve conversation state
    if (!conversationStore[conversationId]) {
      conversationStore[conversationId] = { messages: [] };
    }
    const conversationState = conversationStore[conversationId];
    const history = conversationState.messages;

    const steps: string[] = []; // Track agent steps

    try {
      // 1. Enhanced Schema Analysis
      steps.push("Analyzing table structure...");
      const columns = await this.blockService.getColumnsBySheetId(sheetId);
      const rows = await this.blockService.getRowsBySheetId(sheetId);

      if (rows.length === 0) {
        throw new Error("Sheet contains no rows. Cannot process query.");
      }

      // Reuse schema if we already analyzed it in this conversation
      let schemaInfo: SchemaInfo;
      if (conversationState.schema) {
        schemaInfo = conversationState.schema;
        steps.push(
          "Using previously analyzed schema from conversation history."
        );
      } else {
        // Sample a few rows to understand data types and relationships
        const sampleSize = Math.min(5, rows.length);
        const sampleRows = rows.slice(0, sampleSize);

        schemaInfo = {
          columnTypes: {},
          primaryKeyCandidate: null,
          valueColumns: []
        };

        steps.push(`Analyzing schema using ${sampleSize} sample rows...`);

        // For each column, examine sample values to infer type and role
        for (const column of columns) {
          const columnName = column.properties?.name || column.id;
          const sampleValues = [];

          // Get sample values for this column
          for (const row of sampleRows) {
            const cell = await this.blockService.getCellByColumnAndRow(
              row.id,
              column.id
            );
            if (cell && cell.properties?.value !== undefined) {
              sampleValues.push(cell.properties.value);
            }
          }

          // Infer column type and role
          if (sampleValues.length > 0) {
            const nonNullValues = sampleValues.filter(
              (v) => v !== null && v !== undefined
            );
            if (nonNullValues.length > 0) {
              const uniqueValueRatio =
                new Set(nonNullValues).size / nonNullValues.length;
              const inferredType = this.inferDataType(nonNullValues); // Use existing helper

              schemaInfo.columnTypes[columnName] = inferredType;

              // Identify potential primary keys and value columns
              if (
                uniqueValueRatio === 1 &&
                inferredType === "text" &&
                !schemaInfo.primaryKeyCandidate
              ) {
                // Simple heuristic: unique text columns might be PKs
                schemaInfo.primaryKeyCandidate = columnName;
              }

              // Identify numeric/date columns that likely contain values for analysis
              if (inferredType === "number" || inferredType === "date") {
                schemaInfo.valueColumns.push(columnName);
              }
            } else {
              schemaInfo.columnTypes[columnName] = "unknown";
            }
          } else {
            schemaInfo.columnTypes[columnName] = "unknown";
          }
        }

        // Identify potential relationships between columns (simple version)
        schemaInfo.relationships = {};
        for (const colA of columns) {
          const colAName = colA.properties?.name || colA.id;
          schemaInfo.relationships[colAName] = columns
            .map((c) => c.properties?.name || c.id)
            .filter((name) => name !== colAName);
        }

        // Store schema for future queries in this conversation
        conversationState.schema = schemaInfo;
      }

      steps.push(
        `Schema analysis complete: ${columns.length} columns, ${
          Object.keys(schemaInfo.columnTypes).length
        } typed.`
      );

      // Enhanced context for reasoning agent
      const sheetContext = {
        sheetId,
        columnNames: columns.map((c) => c.properties?.name || c.id),
        rowIds: rows.map((r) => r.id),
        schema: schemaInfo
      };

      // 2. Reasoning Agent: Plan Retrieval with enhanced schema awareness
      steps.push("Planning retrieval with schema awareness...");
      const currentQuery =
        request.messages[request.messages.length - 1].content;
      const { plan, thoughts } = await this.reasoningAgent.planRetrieval(
        currentQuery,
        sheetContext,
        history
      );
      steps.push(...thoughts.map((t) => `Reasoning: ${t}`));
      steps.push(`Plan generated with ${plan.length} steps.`);

      if (plan.length === 0) {
        steps.push(
          "No retrieval plan generated. Synthesizing based on query and schema alone."
        );
      }

      // 3. Retrieval Agent: Execute Initial Plan
      steps.push("Retrieving initial evidence...");
      let evidence: Evidence[] = [];

      if (plan.length > 0) {
        evidence = await this.retrievalAgent.retrieveEvidence(plan, sheetId);
        steps.push(`Retrieved ${evidence.length} initial evidence pieces.`);
      }

      // 4. Implement feedback loop for adaptive retrieval (Using existing synthesizeWithFeedbackWrapper)
      let finalAnswer = "";
      let needsMoreInfo = true;
      let attempts = 0;
      const maxAttempts = 2; // Limit feedback loops
      let currentEvidence = [...evidence]; // Start with initial evidence

      while (
        needsMoreInfo &&
        attempts < maxAttempts &&
        currentEvidence.length > 0
      ) {
        attempts++;
        steps.push(`Synthesis attempt ${attempts}...`);

        const synthesisResult = await this.synthesizeWithFeedbackWrapper(
          currentQuery,
          currentEvidence,
          history,
          schemaInfo,
          sheetContext
        );

        if (
          synthesisResult.needsMoreInfo &&
          synthesisResult.followupPlan &&
          synthesisResult.followupPlan.length > 0 &&
          attempts < maxAttempts // Only retrieve more if we have attempts left
        ) {
          steps.push(
            `Synthesis needs more information. Retrieving additional data...`
          );
          try {
            const additionalEvidence =
              await this.retrievalAgent.retrieveEvidence(
                synthesisResult.followupPlan,
                sheetId
              );
            // Add *new* evidence only (prevent duplicates if retrieval is broad)
            const existingEvidenceIds = new Set(
              currentEvidence.map((e) => e.blockId)
            );
            const newEvidence = additionalEvidence.filter(
              (e) => !existingEvidenceIds.has(e.blockId)
            );
            currentEvidence.push(...newEvidence);
            steps.push(
              `Retrieved ${newEvidence.length} additional unique evidence pieces.`
            );
          } catch (retrievalError) {
            console.error(
              "Error retrieving additional evidence:",
              retrievalError
            );
            steps.push(
              "Error retrieving additional evidence. Proceeding with current data."
            );
            needsMoreInfo = false; // Stop loop if retrieval fails
            finalAnswer = synthesisResult.answer; // Use the answer indicating need for more info
          }
        } else {
          // We have enough info or reached max attempts
          finalAnswer = synthesisResult.answer;
          needsMoreInfo = false;
        }
      }

      // If we never got a final answer (e.g., no initial evidence, loop finished without success)
      if (!finalAnswer) {
        if (currentEvidence.length > 0) {
          // Fallback: Use standard synthesis if feedback loop didn't conclude
          steps.push("Synthesizing final answer after feedback attempts...");
          finalAnswer = await this.synthesisAgent.synthesizeAnswer(
            currentQuery,
            currentEvidence,
            sheetContext,
            history
          );
        } else {
          finalAnswer =
            "I couldn't find relevant information to answer your query based on the available data.";
          steps.push("No relevant evidence found to synthesize an answer.");
        }
      }

      // 5. Update Conversation History
      history.push({ role: "user", content: currentQuery });
      history.push({ role: "assistant", content: finalAnswer });
      conversationState.lastQuery = currentQuery;
      conversationState.lastAnswer = finalAnswer;
      // conversationStore[conversationId] = conversationState; // Not needed, history is mutated by reference

      // 6. Format Response with enhanced citations using the final evidence set
      const citations = this.extractCitations(finalAnswer, currentEvidence); // Use the final evidence set

      return {
        answer: finalAnswer,
        citations,
        conversationId,
        steps
      };
    } catch (error: any) {
      console.error("Error in MatrixQAService (processQuery):", error);
      // Return a user-friendly error response
      return {
        answer: `Sorry, I encountered an error processing your request: ${error.message}`,
        citations: [],
        conversationId,
        steps: [...steps, `Error: ${error.message}`]
      };
    }
  }

  // --- RESTRUCTURED Streaming Method ---
  async processStreamingQuery(
    request: MatrixQARequest
  ): Promise<{ stream: ReadableStream<any>; metadata: any }> {
    const { messages, sheetId } = request;
    const conversationId = request.conversationId || uuidv4();
    const steps: string[] = [];
    let citations: MatrixQAResponse["citations"] = []; // Use the type from MatrixQAResponse

    // Initialize or retrieve conversation state
    if (!conversationStore[conversationId]) {
      conversationStore[conversationId] = { messages: [] };
    }
    const conversationState = conversationStore[conversationId];
    const history = conversationState.messages; // Use existing history

    try {
      // --- Perform ALL data gathering and pre-processing SEQUENTIALLY ---
      steps.push("Analyzing table structure...");
      const columns = await this.blockService.getColumnsBySheetId(sheetId);
      const rows = await this.blockService.getRowsBySheetId(sheetId);

      if (rows.length === 0) {
        throw new Error("Sheet contains no rows. Cannot process query.");
      }

      // 1. Enhanced Schema Analysis (using existing logic structure)
      let schemaInfo: SchemaInfo;
      if (conversationState.schema) {
        schemaInfo = conversationState.schema;
        steps.push(
          "Using previously analyzed schema from conversation history."
        );
      } else {
        // Sample a few rows to understand data types and relationships
        const sampleSize = Math.min(5, rows.length);
        const sampleRows = rows.slice(0, sampleSize);

        schemaInfo = {
          columnTypes: {},
          primaryKeyCandidate: null,
          valueColumns: []
        };

        steps.push(`Analyzing schema using ${sampleSize} sample rows...`);

        // For each column, examine sample values to infer type and role
        for (const column of columns) {
          const columnName = column.properties?.name || column.id;
          const sampleValues = [];

          // Get sample values for this column
          for (const row of sampleRows) {
            try {
              const cell = await this.blockService.getCellByColumnAndRow(
                row.id,
                column.id
              );
              if (cell && cell.properties?.value !== undefined) {
                sampleValues.push(cell.properties.value);
              } else {
                sampleValues.push(null); // Handle missing cells
              }
            } catch (cellError) {
              console.warn(
                `Could not get cell for row ${row.id}, col ${column.id}`,
                cellError
              );
              sampleValues.push(null);
            }
          }

          // Infer column type and role
          const nonNullValues = sampleValues.filter(
            (v) => v !== null && v !== undefined
          );
          if (nonNullValues.length > 0) {
            const uniqueValueRatio =
              new Set(nonNullValues).size / nonNullValues.length;
            const inferredType = this.inferDataType(nonNullValues); // Use existing helper

            schemaInfo.columnTypes[columnName] = inferredType;

            // Identify potential primary keys and value columns
            if (
              uniqueValueRatio === 1 &&
              inferredType === "text" &&
              !schemaInfo.primaryKeyCandidate
            ) {
              schemaInfo.primaryKeyCandidate = columnName;
            }
            if (inferredType === "number" || inferredType === "date") {
              schemaInfo.valueColumns.push(columnName);
            }
          } else {
            schemaInfo.columnTypes[columnName] = "unknown";
          }
        }

        // Identify potential relationships (simple version)
        schemaInfo.relationships = {};
        for (const colA of columns) {
          const colAName = colA.properties?.name || colA.id;
          schemaInfo.relationships[colAName] = columns
            .map((c) => c.properties?.name || c.id)
            .filter((name) => name !== colAName);
        }
        conversationState.schema = schemaInfo; // Store schema for future use
      }
      steps.push(
        `Schema analysis complete: ${columns.length} columns, ${
          Object.keys(schemaInfo.columnTypes).length
        } typed.`
      );

      const sheetContext = {
        sheetId,
        columnNames: columns.map((c) => c.properties?.name || c.id),
        rowIds: rows.map((r) => r.id),
        schema: schemaInfo
      };

      // 2. Reasoning Agent: Plan Retrieval
      steps.push("Planning retrieval with schema awareness...");
      const currentQuery = messages[messages.length - 1].content;
      const { plan, thoughts } = await this.reasoningAgent.planRetrieval(
        currentQuery,
        sheetContext,
        history // Pass conversation history
      );
      steps.push(...thoughts.map((t) => `Reasoning: ${t}`));
      steps.push(`Plan generated with ${plan.length} steps.`);

      if (plan.length === 0) {
        steps.push(
          "No retrieval plan generated. Attempting synthesis based on query and schema alone."
        );
      }

      // 3. Retrieval Agent: Execute Plan
      steps.push("Retrieving initial evidence...");
      let evidence: Evidence[] = [];
      if (plan.length > 0) {
        evidence = await this.retrievalAgent.retrieveEvidence(plan, sheetId);
      }
      steps.push(`Retrieved ${evidence.length} initial evidence pieces.`);

      // --- (Optional) Add adaptive retrieval/feedback loop here if needed ---
      // For simplicity in this refactor, we'll use the initial evidence directly for synthesis.
      // If you need the feedback loop from processQuery, integrate the 'while' loop here,
      // ensuring 'finalEvidence' holds the result before proceeding.
      const finalEvidence = [...evidence]; // Use initial evidence for streaming synthesis

      // 4. Calculate Citations from the FINAL evidence set using existing helper
      citations = this.extractCitationsFromEvidence(finalEvidence);
      steps.push(
        `Found ${citations.length} potential citation points in evidence.`
      );

      // 5. Prepare Evidence Context for Synthesis Prompt
      const evidenceContext = finalEvidence
        .map(
          (e, index) =>
            // Ensure this format includes [cell:ID] markers correctly
            `Evidence Row ${index + 1} (ID: ${
              e.blockId // Assuming blockId is the row ID or similar container
            }):\n${e.content.trim()}\n---`
        )
        .join("\n\n");

      // --- Setup LangChain Streaming ---
      steps.push("Synthesizing answer..."); // Add step *before* invoking the chain
      const { stream, handlers } = LangChainStream();

      const model = new ChatOpenAI({
        modelName: "gpt-4o", // Or your preferred model
        temperature: 0.2,
        streaming: true
      });

      // Use the existing prompt structure, ensure it asks for [cell:ID] citations
      const synthesisPrompt = PromptTemplate.fromTemplate(`
          You are an AI assistant analyzing tabular data. Your task is to answer the user's query based *only* on the provided evidence.

          **Instructions:**
          * Each "Evidence Row" represents a complete row from a table with multiple columns.
          * All data points within a single "Evidence Row" are related and describe the same entity/item.
          * Analyze the structure of each evidence row to understand:
            - What entity/item the row represents
            - What attributes or measurements are provided about that entity
            - How these data points relate to the user's question
          * For questions about specific entities: Find rows containing that entity and report its attributes.
          * For comparative questions (highest, lowest, average): Compare the relevant attribute across rows.
          * For counting or aggregation: Analyze multiple rows to produce summary statistics.
          * Always maintain the context and relationships between data points in the same row.
          * Use [cell:ID] citations when referencing specific values, exactly as they appear in the evidence. Do not add extra characters around the citation.

          **Evidence:**
          ${evidenceContext || "No evidence provided."}

          **Conversation History:**
          ${
            history.length > 0
              ? history.map((msg) => `${msg.role}: ${msg.content}`).join("\n")
              : "No history."
          }

          **User Query:**
          {query}

          **Answer:**
          `);

      const chain = RunnableSequence.from([
        synthesisPrompt,
        model,
        new StringOutputParser()
      ]);

      // --- Invoke the chain asynchronously ---
      // This starts the stream. We don't await the full response here.
      chain
        .invoke({ query: currentQuery }, { callbacks: [handlers] })
        .then(async (fullResponse) => {
          // This block executes *after* the streaming is complete
          try {
            // Update conversation history in the store
            history.push({ role: "user", content: currentQuery });
            history.push({ role: "assistant", content: fullResponse });
            conversationState.lastQuery = currentQuery;
            conversationState.lastAnswer = fullResponse;
            // No need to re-assign conversationState to store, it's a reference
            console.log(
              `Conversation ${conversationId} history updated post-stream.`
            );
          } catch (histError) {
            console.error(
              "Error updating conversation history post-stream:",
              histError
            );
          }
        })
        .catch((error) => {
          console.error("Error during streaming synthesis invoke:", error);
          // Ensure the error is propagated to the stream
          try {
            handlers.handleLLMError(error as Error, "");
          } catch (handlerError) {
            console.error("Error handling LLM error in handler:", handlerError);
          }
        });

      // --- Return the stream and the NOW COMPLETE metadata ---
      console.log("FINAL STEPS before return:", steps);
      console.log("FINAL CITATIONS before return:", citations);
      return {
        stream,
        metadata: {
          citations, // Contains the calculated citations
          conversationId,
          steps // Contains ALL steps generated before synthesis
        }
      };
    } catch (error: any) {
      console.error("Error in MatrixQAService (processStreamingQuery):", error);
      // Create an error stream to inform the client
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            `Error processing request: ${error.message || "Unknown error"}`
          );
          controller.close();
        }
      });
      return {
        stream: errorStream,
        metadata: {
          error: error.message,
          conversationId,
          steps: [...steps, `Error: ${error.message}`], // Include error in steps
          citations: [] // Ensure citations is an empty array on error
        }
      };
    }
  }

  // --- Helper Methods (Keep all existing helpers as they were) ---

  // Helper to analyze evidence and provide feedback for additional retrieval if needed
  private async synthesizeWithFeedbackWrapper(
    query: string,
    evidence: Evidence[],
    history: any[],
    schema: SchemaInfo,
    sheetContext: {
      sheetId: string;
      columnNames: string[];
      rowIds: string[];
      schema: SchemaInfo;
    }
  ): Promise<{
    answer: string;
    needsMoreInfo: boolean;
    followupPlan?: RetrievalPlan[];
  }> {
    // If query is about aggregation (max, min, avg, sum), use our specialized analysis
    const lowerQuery = query.toLowerCase();
    const isAggregationQuery =
      lowerQuery.includes("highest") ||
      lowerQuery.includes("lowest") ||
      lowerQuery.includes("maximum") ||
      lowerQuery.includes("minimum") ||
      lowerQuery.includes("average") ||
      lowerQuery.includes("total") ||
      lowerQuery.includes("sum");

    // Handle aggregation queries
    if (isAggregationQuery && evidence.length > 0) {
      try {
        // Check if we have enough evidence for all rows
        const aggregationType = this.detectAggregationType(lowerQuery);
        const relevantValues = this.preprocessEvidenceForAggregation(
          evidence,
          schema
        );

        // If we need more data, create a followup plan
        // Check if *any* relevant value column has insufficient data for the aggregation type
        let insufficientData = false;
        if (aggregationType === "average" || aggregationType === "sum") {
          // Need at least one value for sum/avg, but ideally more for meaningful avg
          insufficientData = Object.values(relevantValues).some(
            (colData) => colData.values.length < 1
          );
        } else {
          // max, min
          // Need at least one value
          insufficientData = Object.values(relevantValues).some(
            (colData) => colData.values.length < 1
          );
        }
        // Heuristic: If we have very few values overall, maybe ask for more anyway for better context
        const totalValues = Object.values(relevantValues).reduce(
          (sum, col) => sum + col.values.length,
          0
        );
        if (totalValues < 3 && schema.valueColumns.length > 0) {
          // Arbitrary threshold
          insufficientData = true;
        }

        if (insufficientData) {
          // Some columns have too few values for meaningful aggregation
          const followupPlan: RetrievalPlan[] = [
            {
              type: "semantic", // Or 'keyword' depending on retrieval strategy
              query: `${query} data points`, // Broaden query slightly
              filters: {
                rowIds: ["*"], // Consider getting all rows for aggregation context
                columnIds: schema.valueColumns // Focus on numeric/date columns
              },
              reasoning: "Need more complete data for aggregation analysis"
            }
          ];

          return {
            // Provide a placeholder answer indicating more data is needed
            answer:
              "I have some initial data, but I need to gather more to fully calculate the requested aggregation. Retrieving more information...",
            needsMoreInfo: true,
            followupPlan
          };
        }

        // At this point, we assume sufficient data for aggregation based on initial check
        const aggregatedResult = this.performAggregation(
          relevantValues,
          aggregationType,
          schema
        );

        // Check if aggregation actually produced results
        if (Object.keys(aggregatedResult).length === 0) {
          // This can happen if evidence parsing failed or no numeric data found in value columns
          return {
            answer:
              "I found some related rows, but couldn't extract the necessary numeric data to perform the calculation.",
            needsMoreInfo: false // Don't loop if we can't parse what we have
          };
        }

        const formattedAnswer = this.formatAggregationAnswer(
          aggregatedResult,
          query,
          aggregationType
        );

        return {
          answer: formattedAnswer,
          needsMoreInfo: false
        };
      } catch (error) {
        console.error("Error during aggregation analysis:", error);
        // Fall through to standard synthesis if aggregation fails
      }
    }

    // For non-aggregation queries or if aggregation failed
    // Let's analyze what we have and check if we need more specific information

    // Get standard synthesis result using the main SynthesisAgent
    const answer = await this.synthesisAgent.synthesizeAnswer(
      query,
      evidence,
      sheetContext,
      history
    );

    // Check if the answer indicates missing information (using existing indicators)
    const uncertaintyIndicators = [
      "i don't have enough information",
      "cannot determine",
      "not provided in the evidence",
      "not find relevant information",
      "based on the provided data, i cannot",
      "the evidence does not contain"
    ];

    const needsMoreInfo = uncertaintyIndicators.some((indicator) =>
      answer.toLowerCase().includes(indicator)
    );

    if (needsMoreInfo) {
      // Create a more targeted followup plan based on the initial uncertain answer
      const followupPlan: RetrievalPlan[] = [
        {
          type: "semantic", // Or keyword, depending on strategy
          query: query, // Re-use the original query
          filters: {
            // Potentially broaden filters or remove them if initial retrieval was too narrow
            rowIds: [], // Example: Remove row filter if one was applied
            columnIds: [] // Example: Remove column filter
          },
          reasoning:
            "Initial evidence was insufficient or lacked specific details, attempting broader retrieval for the same query."
        }
      ];

      return {
        answer, // Return the answer indicating uncertainty
        needsMoreInfo: true,
        followupPlan
      };
    }

    // If the answer seems complete, return it
    return {
      answer,
      needsMoreInfo: false
    };
  }

  // Helper methods for aggregation analysis
  private detectAggregationType(query: string): string {
    const lowerQuery = query.toLowerCase();
    if (
      lowerQuery.includes("highest") ||
      lowerQuery.includes("maximum") ||
      lowerQuery.includes("max") ||
      lowerQuery.includes("largest") ||
      lowerQuery.includes("top")
    ) {
      return "max";
    }
    if (
      lowerQuery.includes("lowest") ||
      lowerQuery.includes("minimum") ||
      lowerQuery.includes("min") ||
      lowerQuery.includes("smallest") ||
      lowerQuery.includes("bottom")
    ) {
      return "min";
    }
    if (
      lowerQuery.includes("average") ||
      lowerQuery.includes("avg") ||
      lowerQuery.includes("mean")
    ) {
      return "average";
    }
    if (lowerQuery.includes("total") || lowerQuery.includes("sum")) {
      return "sum";
    }
    // Default guess if unclear, maybe based on keywords?
    if (lowerQuery.includes("how many") || lowerQuery.includes("count"))
      return "count"; // Add count if needed
    return "max"; // Default fallback
  }

  private preprocessEvidenceForAggregation(
    evidence: Evidence[],
    schema: SchemaInfo
  ): Record<string, { values: number[]; citations: string[] }> {
    const result: Record<string, { values: number[]; citations: string[] }> =
      {};

    // Initialize for all known value columns
    schema.valueColumns.forEach((colName) => {
      result[colName] = { values: [], citations: [] };
    });

    // Extract numeric values from evidence, associating them with columns
    evidence.forEach((e) => {
      // Assuming e.content format is like: "ColumnName: Value [cell:ID]\nColumnName2: Value2 [cell:ID2]..."
      const lines = e.content.split("\n");
      lines.forEach((line) => {
        const match = line.match(
          /^([^:]+):\s*(.*?)\s*\[cell:([a-fA-F0-9-]+)\]$/
        );
        if (match) {
          const columnName = match[1].trim();
          const valueStr = match[2].trim();
          const cellId = match[3];

          // Only process if it's a known value column
          if (schema.valueColumns.includes(columnName)) {
            // Attempt to parse as number
            const numericValue = parseFloat(valueStr.replace(/[^0-9.-]+/g, "")); // Clean currency/commas
            if (!isNaN(numericValue)) {
              if (!result[columnName]) {
                // Safety check if column wasn't in initial schema.valueColumns
                result[columnName] = { values: [], citations: [] };
              }
              result[columnName].values.push(numericValue);
              result[columnName].citations.push(cellId);
            }
          }
        }
      });
    });

    // Clean up columns that ended up with no valid numbers
    Object.keys(result).forEach((colName) => {
      if (result[colName].values.length === 0) {
        delete result[colName];
      }
    });

    return result;
  }

  private performAggregation(
    data: Record<string, { values: number[]; citations: string[] }>,
    aggregationType: string,
    schema: SchemaInfo // May not be needed here but passed for consistency
  ): Record<string, { result: number; citations: string[] }> {
    const aggregatedResult: Record<
      string,
      { result: number; citations: string[] }
    > = {};

    Object.entries(data).forEach(([columnName, columnData]) => {
      if (columnData.values.length === 0) return; // Skip empty columns

      let calculationResult: number | undefined;
      let relevantCitations: string[] = [];

      switch (aggregationType) {
        case "max":
          calculationResult = Math.max(...columnData.values);
          const maxIndex = columnData.values.indexOf(calculationResult);
          relevantCitations = [columnData.citations[maxIndex]];
          break;
        case "min":
          calculationResult = Math.min(...columnData.values);
          const minIndex = columnData.values.indexOf(calculationResult);
          relevantCitations = [columnData.citations[minIndex]];
          break;
        case "sum":
          calculationResult = columnData.values.reduce(
            (acc, val) => acc + val,
            0
          );
          relevantCitations = columnData.citations; // All values contributed
          break;
        case "average":
          const sum = columnData.values.reduce((acc, val) => acc + val, 0);
          calculationResult = sum / columnData.values.length;
          relevantCitations = columnData.citations; // All values contributed
          break;
        // Add 'count' if needed:
        // case "count":
        //   calculationResult = columnData.values.length;
        //   relevantCitations = columnData.citations;
        //   break;
      }

      if (calculationResult !== undefined && !isNaN(calculationResult)) {
        aggregatedResult[columnName] = {
          result: calculationResult,
          citations: relevantCitations
        };
      }
    });

    return aggregatedResult;
  }

  private formatAggregationAnswer(
    aggregatedResult: Record<string, { result: number; citations: string[] }>,
    query: string, // Keep original query for context
    aggregationType: string
  ): string {
    if (Object.keys(aggregatedResult).length === 0) {
      return "I couldn't perform the requested calculation with the available data.";
    }

    let answerParts: string[] = [];
    const resultEntries = Object.entries(aggregatedResult);

    // Simple intro based on type
    let intro = `Based on the data, the ${aggregationType}`;
    if (aggregationType === "average") intro = `Based on the data, the average`;
    if (aggregationType === "sum") intro = `Based on the data, the total`;

    resultEntries.forEach(([columnName, data]) => {
      let valueStr = data.result.toLocaleString(undefined, {
        maximumFractionDigits: 2
      }); // Format number nicely
      let citationStr = "";

      // Add citation(s) - handle single vs multiple
      if (data.citations.length === 1) {
        citationStr = ` [cell:${data.citations[0]}]`;
      } else if (
        data.citations.length > 1 &&
        (aggregationType === "sum" || aggregationType === "average")
      ) {
        // For sum/avg, maybe don't list all citations if too many
        citationStr = ` (calculated from ${data.citations.length} values)`;
      } // For max/min, we usually only have one citation

      answerParts.push(
        `the ${aggregationType} ${columnName} is ${valueStr}${citationStr}`
      );
    });

    if (answerParts.length === 0) {
      return "Although I found relevant data, I couldn't complete the calculation.";
    }

    // Construct the final answer string
    if (resultEntries.length === 1) {
      // If only one column was aggregated, make it more direct
      return `Based on the data, ${answerParts[0]}.`;
    } else {
      // If multiple columns, list them
      return `${intro} values are:\n- ${answerParts.join("\n- ")}`;
    }
  }

  // Helper to extract citations from evidence for metadata (Keep as is)
  private extractCitationsFromEvidence(
    evidence: Evidence[]
  ): MatrixQAResponse["citations"] {
    const citations: MatrixQAResponse["citations"] = [];
    const processedIds = new Set<string>();

    for (const e of evidence) {
      // Extract cell IDs from the evidence content
      // Regex looks for patterns like "Any Text [cell:uuid]"
      const cellMatches = Array.from(
        e.content.matchAll(/(.*?)\s*\[cell:([a-fA-F0-9-]+)\]/g)
      );

      for (const match of cellMatches) {
        const cellId = match[2];
        if (!processedIds.has(cellId)) {
          processedIds.add(cellId);

          // Find the context snippet for this cell
          let contentSnippet = match[1].trim();
          // Clean up snippet if it contains newlines or is too long
          if (contentSnippet.includes("\n")) {
            contentSnippet = contentSnippet.substring(
              contentSnippet.lastIndexOf("\n") + 1
            );
          }
          if (contentSnippet.length > 100) {
            contentSnippet = "..." + contentSnippet.slice(-97);
          }
          if (!contentSnippet) {
            // Fallback if regex captured nothing before citation
            // Try to find the line containing the citation for better context
            const lines = e.content.split("\n");
            const lineWithCitation = lines.find((line) =>
              line.includes(`[cell:${cellId}]`)
            );
            if (lineWithCitation) {
              contentSnippet =
                lineWithCitation.split("[cell:")[0].trim() || "Referenced data";
            } else {
              contentSnippet = "Referenced data";
            }
          }

          citations.push({
            blockId: cellId,
            contentSnippet: contentSnippet || "Referenced data" // Ensure snippet isn't empty
          });
        }
      }
      // Fallback: If the main regex didn't find anything, try generic marker find
      if (cellMatches.length === 0) {
        const genericMatches = Array.from(
          e.content.matchAll(/\[cell:([a-fA-F0-9-]+)\]/g)
        );
        genericMatches.forEach((gMatch) => {
          const cellId = gMatch[1];
          if (!processedIds.has(cellId)) {
            processedIds.add(cellId);
            citations.push({
              blockId: cellId,
              contentSnippet: "Referenced data"
            });
          }
        });
      }
    }

    return citations;
  }

  // Helper to infer data types from values (Keep as is)
  private inferDataType(values: any[]): string {
    // Filter out null/undefined values
    const nonNullValues = values.filter(
      (v) => v !== null && v !== undefined && String(v).trim() !== ""
    );
    if (nonNullValues.length === 0) return "unknown";

    // Simple type inference logic
    const types = nonNullValues.map((v) => {
      const strValue = String(v).trim();

      // Check if number (allowing for currency symbols, commas)
      if (!isNaN(Number(strValue.replace(/[^0-9.-]+/g, "")))) return "number";

      // Check if date (simple ISO format check or general parse)
      if (
        /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(
          strValue
        ) ||
        !isNaN(Date.parse(strValue))
      )
        return "date";

      // Check if boolean
      if (
        ["true", "false", "0", "1", "yes", "no"].includes(
          strValue.toLowerCase()
        )
      ) {
        return "boolean";
      }

      // Default to text
      return "text";
    });

    // Return most common type
    const typeCounts: Record<string, number> = {};
    types.forEach((t) => {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });

    // Determine majority type
    let majorityType = "text"; // Default
    let maxCount = 0;
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        majorityType = type;
      }
    }

    // Add tie-breaking logic if needed (e.g., prefer number over text if counts are equal)
    if (
      typeCounts["number"] === typeCounts["text"] &&
      maxCount === typeCounts["number"]
    ) {
      return "number";
    }

    return majorityType;
  }

  // Helper to extract citations from the LLM's final answer string (Keep as is)
  private extractCitations(
    answer: string,
    evidence: Evidence[] // Pass the evidence used to generate the answer
  ): MatrixQAResponse["citations"] {
    const citationRegex = /\[cell:([a-fA-F0-9-]+)\]/g;
    const citations: MatrixQAResponse["citations"] = [];
    const citedCells = new Set<string>();

    // Create a map of block IDs (cells and potentially rows) to their evidence content for snippet lookup
    const evidenceMap = new Map<string, string>(); // Map ID to content string
    evidence.forEach((e) => {
      // Map the main evidence block ID (e.g., row ID)
      if (e.blockId && !evidenceMap.has(e.blockId)) {
        evidenceMap.set(e.blockId, e.content);
      }
      // Map cell IDs found within the content
      const cellMatches = Array.from(
        e.content.matchAll(/\[cell:([a-fA-F0-9-]+)\]/g)
      );
      cellMatches.forEach((match) => {
        const cellId = match[1];
        if (!evidenceMap.has(cellId)) {
          // Store the content of the *parent* evidence block for context
          evidenceMap.set(cellId, e.content);
        }
      });
    });

    // Extract citations from the answer string
    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      const cellId = match[1];
      if (!citedCells.has(cellId)) {
        citedCells.add(cellId);

        const relatedEvidenceContent = evidenceMap.get(cellId);
        let contentSnippet = "Referenced data"; // Default snippet

        if (relatedEvidenceContent) {
          // Try to find the specific line/context containing this cell ID within its evidence block
          const lines = relatedEvidenceContent.split("\n");
          const lineWithCitation = lines.find((line) =>
            line.includes(`[cell:${cellId}]`)
          );

          if (lineWithCitation) {
            // Extract the text part before the citation marker on that line
            const snippetMatch = lineWithCitation.match(/^(.*?)\s*\[cell:/);
            if (snippetMatch && snippetMatch[1].trim()) {
              contentSnippet = snippetMatch[1].trim();
              // Truncate if too long
              if (contentSnippet.length > 100) {
                contentSnippet = "..." + contentSnippet.slice(-97);
              }
            } else {
              // Basic fallback if regex fails on the line
              contentSnippet =
                lineWithCitation.split("[cell:")[0].trim().substring(0, 70) ||
                contentSnippet;
            }
          } else {
            // Fallback if specific line isn't found, use start of the evidence block content
            contentSnippet = relatedEvidenceContent.substring(0, 70) + "...";
          }
        }

        citations.push({
          blockId: cellId,
          contentSnippet: contentSnippet
        });
      }
    }

    return citations;
  }
}
