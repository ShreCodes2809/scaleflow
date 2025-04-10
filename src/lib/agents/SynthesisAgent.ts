import OpenAI from "openai";
import { Evidence } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SYNTHESIS_MODEL = "gpt-4o"; // Or a model good at following instructions

export class SynthesisAgent {
  // Add to SynthesisAgent.ts
  async analyzeAggregateData(
    evidence: Evidence[],
    aggregationType: string
  ): Promise<any> {
    // Group evidence by columns for cross-row analysis
    const columnData: Record<
      string,
      Array<{ value: string | number; rowId: string; cellId: string }>
    > = {};

    // Extract numeric values by column
    evidence.forEach((e) => {
      // Parse the row data format to extract column values
      const rowLines = e.content.split("\n");
      rowLines.forEach((line) => {
        const match = line.match(/- ([^:]+): (.*) \[cell:([^\]]+)\]/);
        if (match) {
          const [_, columnName, value, cellId] = match;

          if (!columnData[columnName]) {
            columnData[columnName] = [];
          }

          // Store value with row reference and cell citation
          columnData[columnName].push({
            value: isNaN(Number(value)) ? value : Number(value),
            rowId: e.rowId,
            cellId
          });
        }
      });
    });

    // Perform the requested aggregation
    const results: Record<
      string,
      { value: number; citation?: string; citations?: string[] }
    > = {};

    Object.entries(columnData).forEach(([column, dataPoints]) => {
      // Only process numeric columns for aggregation
      const numericValues = dataPoints
        .filter((dp) => typeof dp.value === "number")
        .map((dp) => dp.value as number);

      if (numericValues.length === 0) return;

      switch (aggregationType.toLowerCase()) {
        case "max":
          const maxValue = Math.max(...numericValues);
          const maxPoint = dataPoints.find((dp) => dp.value === maxValue);
          results[column] = { value: maxValue, citation: maxPoint?.cellId };
          break;
        case "min":
          const minValue = Math.min(...numericValues);
          const minPoint = dataPoints.find((dp) => dp.value === minValue);
          results[column] = { value: minValue, citation: minPoint?.cellId };
          break;
        case "sum":
          const sum = numericValues.reduce((acc, val) => acc + val, 0);
          results[column] = {
            value: sum,
            citations: dataPoints.map((dp) => dp.cellId)
          };
          break;
        case "average":
          const avg =
            numericValues.reduce((acc, val) => acc + val, 0) /
            numericValues.length;
          results[column] = {
            value: avg,
            citations: dataPoints.map((dp) => dp.cellId)
          };
          break;
      }
    });

    return results;
  }

  async synthesizeAnswer(
    userQuery: string,
    evidence: Evidence[],
    conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  ): Promise<string> {
    if (evidence.length === 0) {
      return "I couldn't find any relevant information in the sheet to answer your question.";
    }

    // This formatting IS providing the linked row data.
    const evidenceContext = evidence
      .map(
        (e, index) =>
          // Maybe simplify the header?
          `Evidence Row ${index + 1} (ID: ${e.blockId}):\n${
            e.content // Contains "Key: Value [cell:CELL_ID]\n..."
          }\n---`
      )
      .join("\n\n");

    console.log("Evidence Context for Synthesis:", evidenceContext); // CRITICAL: Check this log output carefully! Does it contain the linked Country/Population data as expected?

    // --- FURTHER REFINEMENT IDEAS FOR SYSTEM PROMPT ---
    // In SynthesisAgent.ts
    const systemPrompt = `
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
`;

    // --- END REFINEMENT IDEAS ---

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userQuery }
    ];

    try {
      console.log("Sending request to Synthesis LLM...");
      const response = await openai.chat.completions.create({
        model: SYNTHESIS_MODEL,
        messages: messages,
        temperature: 0.2,
        max_tokens: 1000
      });
      console.log("Received response from Synthesis LLM.");

      const answer = response.choices[0]?.message?.content;
      if (!answer) {
        throw new Error("Synthesis agent returned empty content.");
      }
      console.log("Synthesized Answer:", answer.trim());
      return answer.trim();
    } catch (error) {
      console.error("Error in SynthesisAgent:", error);
      console.error(
        "Messages sent to Synthesis API:",
        JSON.stringify(messages, null, 2)
      );
      throw new Error(
        `SynthesisAgent failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
