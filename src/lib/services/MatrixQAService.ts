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
import { LangChainStream } from "ai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

// Enhanced conversation history structure
interface ConversationState {
  messages: any[];
  schema?: SchemaInfo;
  lastQuery?: string;
  lastAnswer?: string;
}

// Schema analysis type definitions
interface SchemaInfo {
  columnTypes: Record<string, string>;
  primaryKeyCandidate: string | null;
  valueColumns: string[];
  relationships?: Record<string, string[]>;
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

  // Original method for non-streaming responses
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
            const uniqueValueRatio =
              new Set(sampleValues).size / sampleValues.length;
            const inferredType = this.inferDataType(sampleValues);

            schemaInfo.columnTypes[columnName] = inferredType;

            // Identify potential primary keys and value columns
            if (uniqueValueRatio === 1) {
              schemaInfo.primaryKeyCandidate = columnName;
            }

            // Identify numeric/date columns that likely contain values for analysis
            if (inferredType === "number" || inferredType === "date") {
              schemaInfo.valueColumns.push(columnName);
            }
          }
        }

        // Identify potential relationships between columns
        schemaInfo.relationships = {};
        for (const colA of columns) {
          const colAName = colA.properties?.name || colA.id;
          schemaInfo.relationships[colAName] = [];

          // Look for columns that frequently appear together with meaningful values
          for (const colB of columns) {
            const colBName = colB.properties?.name || colB.id;
            if (colAName !== colBName) {
              // Could implement more sophisticated relationship detection here
              // For now, we'll just group all columns together
              schemaInfo.relationships[colAName].push(colBName);
            }
          }
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
      const { plan, thoughts } = await this.reasoningAgent.planRetrieval(
        request.messages[request.messages.length - 1].content,
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

      // 4. Implement feedback loop for adaptive retrieval
      let finalAnswer = "";
      let needsMoreInfo = true;
      let attempts = 0;
      const maxAttempts = 2;

      while (needsMoreInfo && attempts < maxAttempts && evidence.length > 0) {
        attempts++;

        // Try synthesis with current evidence
        steps.push(`Synthesis attempt ${attempts}...`);

        // For the feedback loop, we'd need to update SynthesisAgent to support this
        // For now, we'll simulate it here
        const synthesisResult = await this.synthesizeWithFeedbackWrapper(
          request.messages[request.messages.length - 1].content,
          evidence,
          history,
          schemaInfo,
          sheetContext
        );

        if (
          synthesisResult.needsMoreInfo &&
          synthesisResult.followupPlan &&
          synthesisResult.followupPlan.length > 0
        ) {
          steps.push(
            `Synthesis needs more information. Retrieving additional data...`
          );
          // Get more evidence based on feedback
          const additionalEvidence = await this.retrievalAgent.retrieveEvidence(
            synthesisResult.followupPlan,
            sheetId
          );
          // Add to existing evidence
          evidence.push(...additionalEvidence);
          steps.push(
            `Retrieved ${additionalEvidence.length} additional evidence pieces.`
          );
        } else {
          // We have enough info
          finalAnswer = synthesisResult.answer;
          needsMoreInfo = false;
        }
      }

      // If we went through the feedback loop but didn't get an answer, use the last synthesis attempt
      if (!finalAnswer && evidence.length > 0) {
        finalAnswer = await this.synthesisAgent.synthesizeAnswer(
          request.messages[request.messages.length - 1].content,
          evidence,
          sheetContext,
          history
        );
        steps.push(
          "Synthesized final answer after evidence retrieval attempts."
        );
      } else if (!finalAnswer) {
        finalAnswer =
          "I couldn't find relevant information to answer your query based on the available data.";
        steps.push("No relevant evidence found to synthesize an answer.");
      }

      // 5. Update Conversation History
      history.push({
        role: "user",
        content: request.messages[request.messages.length - 1].content
      });
      history.push({ role: "assistant", content: finalAnswer });
      conversationState.lastQuery =
        request.messages[request.messages.length - 1].content;
      conversationState.lastAnswer = finalAnswer;
      conversationStore[conversationId] = conversationState;

      // 6. Format Response with enhanced citations
      const citations = this.extractCitations(finalAnswer, evidence);

      return {
        answer: finalAnswer,
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

  // New method for streaming responses using Langchain and Vercel AI SDK
  async processStreamingQuery(
    request: MatrixQARequest
  ): Promise<{ stream: ReadableStream<any>; metadata: any }> {
    const { messages, sheetId } = request;
    const conversationId = request.conversationId || uuidv4();
    const steps: string[] = [];

    // Initialize or retrieve conversation state
    if (!conversationStore[conversationId]) {
      conversationStore[conversationId] = { messages: [] };
    }
    const conversationState = conversationStore[conversationId];
    const history = conversationState.messages;

    try {
      // Setup the LangChain streaming
      const { stream, handlers } = LangChainStream();

      // Run the processing in the background to allow streaming
      (async () => {
        try {
          steps.push("Analyzing table structure...");
          // 1. Enhanced Schema Analysis (same as before)
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
                const uniqueValueRatio =
                  new Set(sampleValues).size / sampleValues.length;
                const inferredType = this.inferDataType(sampleValues);

                schemaInfo.columnTypes[columnName] = inferredType;

                // Identify potential primary keys and value columns
                if (uniqueValueRatio === 1) {
                  schemaInfo.primaryKeyCandidate = columnName;
                }

                // Identify numeric/date columns that likely contain values for analysis
                if (inferredType === "number" || inferredType === "date") {
                  schemaInfo.valueColumns.push(columnName);
                }
              }
            }

            // Identify potential relationships between columns
            schemaInfo.relationships = {};
            for (const colA of columns) {
              const colAName = colA.properties?.name || colA.id;
              schemaInfo.relationships[colAName] = [];

              // Look for columns that frequently appear together with meaningful values
              for (const colB of columns) {
                const colBName = colB.properties?.name || colB.id;
                if (colAName !== colBName) {
                  // Could implement more sophisticated relationship detection here
                  // For now, we'll just group all columns together
                  schemaInfo.relationships[colAName].push(colBName);
                }
              }
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

          // 2. Reasoning Agent: Plan Retrieval
          steps.push("Planning retrieval with schema awareness...");
          const { plan, thoughts } = await this.reasoningAgent.planRetrieval(
            request.messages[request.messages.length - 1].content,
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
            evidence = await this.retrievalAgent.retrieveEvidence(
              plan,
              sheetId
            );
            steps.push(`Retrieved ${evidence.length} initial evidence pieces.`);
          }

          // 4. Check if we need a feedback loop for more data
          let needsMoreInfo = false;
          let finalEvidence = [...evidence];

          // Check if query is asking for aggregation or comparison
          const lowerQuery =
            request.messages[request.messages.length - 1].content.toLowerCase();
          const isAggregationQuery =
            lowerQuery.includes("highest") ||
            lowerQuery.includes("lowest") ||
            lowerQuery.includes("maximum") ||
            lowerQuery.includes("minimum") ||
            lowerQuery.includes("average") ||
            lowerQuery.includes("total") ||
            lowerQuery.includes("sum");

          if (isAggregationQuery && evidence.length > 0) {
            // For aggregation queries, we may need more comprehensive data
            const aggregationType = this.detectAggregationType(lowerQuery);
            const relevantValues = this.preprocessEvidenceForAggregation(
              evidence,
              schemaInfo
            );

            // If we have too few values for meaningful aggregation, get more
            if (
              Object.values(relevantValues).some(
                (columnData) => columnData.values.length < 2
              )
            ) {
              steps.push("Need more data for aggregation analysis...");

              // Create a plan to get more comprehensive data
              const followupPlan: RetrievalPlan[] = [
                {
                  type: "semantic",
                  query: `${
                    request.messages[request.messages.length - 1].content
                  } data points`,
                  filters: {
                    rowIds: ["*"], // Get all rows
                    columnIds: schemaInfo.valueColumns // Focus on numeric/date columns
                  },
                  reasoning: "Need more complete data for aggregation analysis"
                }
              ];

              // Get additional evidence
              const additionalEvidence =
                await this.retrievalAgent.retrieveEvidence(
                  followupPlan,
                  sheetId
                );
              steps.push(
                `Retrieved ${additionalEvidence.length} additional evidence pieces for aggregation.`
              );

              // Add to our evidence
              finalEvidence = [...evidence, ...additionalEvidence];
            }
          }

          // 5. Prepare evidence context for streaming synthesis
          const evidenceContext = finalEvidence
            .map(
              (e, index) =>
                `Evidence Row ${index + 1} (ID: ${e.blockId}):\n${
                  e.content
                }\n---`
            )
            .join("\n\n");

          steps.push("Synthesizing answer...");

          // 6. Setup streaming synthesis using LangChain
          const model = new ChatOpenAI({
            modelName: "gpt-4o",
            temperature: 0.2,
            streaming: true
          });

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
          * Use [cell:ID] citations when referencing specific values.

          **Evidence:**
          ${evidenceContext}

          **Conversation History:**
          ${history.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}

          **User Query:**
          {query}

          **Answer:**
          `);

          // Create the chain that will stream the response
          const chain = RunnableSequence.from([
            synthesisPrompt,
            model,
            new StringOutputParser()
          ]);

          // Execute the chain and stream the response
          const response = await chain.invoke(
            {
              query: request.messages[request.messages.length - 1].content
            },
            { callbacks: [handlers] }
          );

          // 7. Update conversation history (after streaming has already started)
          history.push({
            role: "user",
            content: request.messages[request.messages.length - 1].content
          });
          history.push({ role: "assistant", content: response });
          conversationState.lastQuery =
            request.messages[request.messages.length - 1].content;
          conversationState.lastAnswer = response;

          // 8. Extract citations from evidence
          const citations = this.extractCitationsFromEvidence(finalEvidence);

          // Send metadata along with the streamed response
          handlers.handleLLMEnd({}, "stream-complete");

          console.log("STEPS before return:", steps);

          // Return the stream and metadata immediately while processing continues in the background
          return {
            stream,
            metadata: {
              citations,
              conversationId,
              steps
            }
          };
        } catch (error) {
          console.error("Error during streaming:", error);
          handlers.handleToolError(error as Error, "stream-error");
          throw error;
        }
      })();

      // Return the stream and metadata immediately while processing continues in the background
      return {
        stream,
        metadata: {
          conversationId,
          steps
        }
      };
    } catch (error: any) {
      console.error("Error in MatrixQAService streaming setup:", error);
      // Create an error stream
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(`Error: ${error.message}`);
          controller.close();
        }
      });

      return {
        stream: errorStream,
        metadata: {
          error: error.message,
          conversationId,
          steps
        }
      };
    }
  }

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
        if (
          Object.values(relevantValues).some(
            (columnData) => columnData.values.length < 2
          )
        ) {
          // Some columns have too few values for meaningful aggregation
          const followupPlan: RetrievalPlan[] = [
            {
              type: "semantic",
              query: `${query} data points`,
              filters: {
                rowIds: ["*"], // Get all rows
                columnIds: schema.valueColumns // Focus on numeric/date columns
              },
              reasoning: "Need more complete data for aggregation analysis"
            }
          ];

          return {
            answer: "I need more data to fully answer this aggregation query.",
            needsMoreInfo: true,
            followupPlan
          };
        }

        // At this point, we should have sufficient data for aggregation
        const aggregatedResult = this.performAggregation(
          relevantValues,
          aggregationType,
          schema
        );

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
      }
    }

    // For non-aggregation queries or if aggregation failed
    // Let's analyze what we have and check if we need more specific information

    // Get standard synthesis result
    const answer = await this.synthesisAgent.synthesizeAnswer(
      query,
      evidence,
      sheetContext,
      history
    );

    // Check if the answer indicates missing information
    const uncertaintyIndicators = [
      "I don't have enough information",
      "cannot determine",
      "not provided in the evidence",
      "not find relevant information"
    ];

    const needsMoreInfo = uncertaintyIndicators.some((indicator) =>
      answer.toLowerCase().includes(indicator.toLowerCase())
    );

    if (needsMoreInfo) {
      // Create a more targeted followup plan
      const followupPlan: RetrievalPlan[] = [
        {
          type: "semantic",
          query: query, // Keep the same query but expand column coverage
          filters: {
            rowIds: ["*"], // Try all rows
            columnIds: [] // No column filter to get more comprehensive data
          },
          reasoning:
            "Initial evidence was insufficient, retrieving broader context"
        }
      ];

      return {
        answer,
        needsMoreInfo: true,
        followupPlan
      };
    }

    return {
      answer,
      needsMoreInfo: false
    };
  }

  // Helper methods for aggregation analysis
  private detectAggregationType(query: string): string {
    if (
      query.includes("highest") ||
      query.includes("maximum") ||
      query.includes("max")
    ) {
      return "max";
    }
    if (
      query.includes("lowest") ||
      query.includes("minimum") ||
      query.includes("min")
    ) {
      return "min";
    }
    if (
      query.includes("average") ||
      query.includes("avg") ||
      query.includes("mean")
    ) {
      return "average";
    }
    if (query.includes("total") || query.includes("sum")) {
      return "sum";
    }
    return "max"; // Default to max if unclear
  }

  private preprocessEvidenceForAggregation(
    evidence: Evidence[],
    schema: SchemaInfo
  ): Record<string, { values: number[]; citations: string[] }> {
    const result: Record<string, { values: number[]; citations: string[] }> =
      {};

    // Initialize for all value columns
    schema.valueColumns.forEach((col) => {
      result[col] = { values: [], citations: [] };
    });

    // Extract numeric values from evidence
    evidence.forEach((e) => {
      // Parse the content format: "Column: Value [cell:ID]"
      const lines = e.content.split("\n");

      for (const line of lines) {
        const match = line.match(/([^:]+): (.*) \[cell:([^\]]+)\]/);
        if (match) {
          const [_, columnName, valueStr, cellId] = match;

          // Only process columns that are in our valueColumns list
          if (schema.valueColumns.includes(columnName)) {
            const numericValue = parseFloat(valueStr);
            if (!isNaN(numericValue)) {
              result[columnName].values.push(numericValue);
              result[columnName].citations.push(cellId);
            }
          }
        }
      }
    });

    return result;
  }

  private performAggregation(
    data: Record<string, { values: number[]; citations: string[] }>,
    aggregationType: string,
    schema: SchemaInfo
  ): Record<string, { result: number; citations: string[] }> {
    const result: Record<string, { result: number; citations: string[] }> = {};

    Object.entries(data).forEach(([column, columnData]) => {
      if (columnData.values.length === 0) return;

      switch (aggregationType) {
        case "max":
          const maxValue = Math.max(...columnData.values);
          const maxIndex = columnData.values.indexOf(maxValue);
          result[column] = {
            result: maxValue,
            citations: [columnData.citations[maxIndex]]
          };
          break;
        case "min":
          const minValue = Math.min(...columnData.values);
          const minIndex = columnData.values.indexOf(minValue);
          result[column] = {
            result: minValue,
            citations: [columnData.citations[minIndex]]
          };
          break;
        case "sum":
          const sum = columnData.values.reduce((acc, val) => acc + val, 0);
          result[column] = {
            result: sum,
            citations: columnData.citations
          };
          break;
        case "average":
          const avg =
            columnData.values.reduce((acc, val) => acc + val, 0) /
            columnData.values.length;
          result[column] = {
            result: avg,
            citations: columnData.citations
          };
          break;
      }
    });

    return result;
  }

  private formatAggregationAnswer(
    aggregatedResult: Record<string, { result: number; citations: string[] }>,
    query: string,
    aggregationType: string
  ): string {
    // If no results, return appropriate message
    if (Object.keys(aggregatedResult).length === 0) {
      return "I couldn't find any numeric data to calculate the requested aggregation.";
    }

    // Format the answer based on aggregation type
    let answer = "";

    switch (aggregationType) {
      case "max":
        answer = "Based on the data provided, here are the maximum values:\n\n";
        Object.entries(aggregatedResult).forEach(([column, data]) => {
          answer += `- The maximum ${column} is ${data.result} [cell:${data.citations[0]}]\n`;
        });
        break;
      case "min":
        answer = "Based on the data provided, here are the minimum values:\n\n";
        Object.entries(aggregatedResult).forEach(([column, data]) => {
          answer += `- The minimum ${column} is ${data.result} [cell:${data.citations[0]}]\n`;
        });
        break;
      case "sum":
        answer = "Based on the data provided, here are the totals:\n\n";
        Object.entries(aggregatedResult).forEach(([column, data]) => {
          answer += `- The sum of all ${column} values is ${data.result}`;
          // Too many citations could get unwieldy, so we'll summarize
          answer += ` (calculated from ${data.citations.length} values)\n`;
        });
        break;
      case "average":
        answer = "Based on the data provided, here are the averages:\n\n";
        Object.entries(aggregatedResult).forEach(([column, data]) => {
          answer += `- The average ${column} is ${data.result.toFixed(2)}`;
          answer += ` (calculated from ${data.citations.length} values)\n`;
        });
        break;
    }

    return answer.trim();
  }

  // Helper to extract citations from evidence for metadata
  private extractCitationsFromEvidence(
    evidence: Evidence[]
  ): MatrixQAResponse["citations"] {
    const citations: MatrixQAResponse["citations"] = [];
    const processedIds = new Set<string>();

    for (const e of evidence) {
      // Extract cell IDs from the evidence content
      const cellMatches = Array.from(
        e.content.matchAll(/\[cell:([a-fA-F0-9-]+)\]/g)
      );

      for (const match of cellMatches) {
        const cellId = match[1];
        if (!processedIds.has(cellId)) {
          processedIds.add(cellId);

          // Find the context snippet for this cell
          const contextRegex = new RegExp(`([^\\n]+)\\[cell:${cellId}\\]`);
          const contextMatch = e.content.match(contextRegex);
          const contentSnippet = contextMatch
            ? contextMatch[1].trim()
            : "Referenced data";

          citations.push({
            blockId: cellId,
            contentSnippet
          });
        }
      }
    }

    return citations;
  }

  // Helper to infer data types from values
  private inferDataType(values: any[]): string {
    // Filter out null/undefined values
    const nonNullValues = values.filter((v) => v !== null && v !== undefined);
    if (nonNullValues.length === 0) return "unknown";

    // Simple type inference logic
    const types = nonNullValues.map((v) => {
      const strValue = String(v).trim();

      // Check if number
      if (!isNaN(Number(strValue)) && strValue !== "") return "number";

      // Check if date (simple ISO format check)
      if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) return "date";

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

    return (
      Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .map((entry) => entry[0])[0] || "text"
    );
  }

  private extractCitations(
    answer: string,
    evidence: Evidence[]
  ): MatrixQAResponse["citations"] {
    const citationRegex = /\[cell:([a-fA-F0-9-]+)\]/g;
    const citations: MatrixQAResponse["citations"] = [];
    const citedCells = new Set<string>();

    // Create a map of block IDs to their evidence
    const evidenceMap = new Map<string, Evidence>();
    evidence.forEach((e) => {
      evidenceMap.set(e.blockId, e);

      // Also extract cell IDs from the structured content
      const cellMatches = Array.from(
        e.content.matchAll(/\[cell:([a-fA-F0-9-]+)\]/g)
      );
      cellMatches.forEach((match) => {
        const cellId = match[1];
        if (!evidenceMap.has(cellId)) {
          // Store a reference to the parent evidence for each cell ID
          evidenceMap.set(cellId, e);
        }
      });
    });

    // Extract citations from the answer
    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      const cellId = match[1];
      if (!citedCells.has(cellId)) {
        citedCells.add(cellId);

        const relatedEvidence = evidenceMap.get(cellId);
        if (relatedEvidence) {
          // Extract the specific data point being cited
          const contextRegex = new RegExp(`([^\\n]+)\\[cell:${cellId}\\]`);
          const contextMatch = relatedEvidence.content.match(contextRegex);
          const contextSnippet = contextMatch
            ? contextMatch[1].trim()
            : relatedEvidence.content.substring(0, 50) + "...";

          citations.push({
            blockId: cellId,
            contentSnippet: contextSnippet
          });
        } else {
          // Fallback if we can't find the evidence
          citations.push({
            blockId: cellId,
            contentSnippet: "Referenced data"
          });
        }
      }
    }

    return citations;
  }
}
