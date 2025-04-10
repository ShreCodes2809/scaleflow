import OpenAI from "openai";
import { Evidence } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SYNTHESIS_MODEL = "gpt-4o"; // Or a model good at following instructions

export class SynthesisAgent {
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
    const systemPrompt = `
You are an AI assistant. Your task is to answer the user's query based *only* on the provided "Evidence Row" blocks.

**Instructions:**
*   Each "Evidence Row" contains data points from a single row in a table.
*   Data points are formatted like "Column Name: Value [cell:CELL_ID]". The [cell:CELL_ID] tag identifies the specific source cell for that value.
*   Analyze the user's query.
*   Examine the content within each "Evidence Row" block. Data points listed together in the same block are related (belong to the same row).
*   Synthesize a concise answer using *only* information present in the evidence.
*   **CITATION:** When you use a specific value (like a name, number, or text) from the evidence, you MUST immediately include the \`[cell:CELL_ID]\` tag that follows that value in the evidence.
    *   Example Evidence: \`Country: France [cell:abc]\nPopulation: 67M [cell:def]\`
    *   Example Answer: "France [cell:abc] has a population of 67M [cell:def]."
*   **COMPARISONS:** If the query asks for highest/lowest etc., compare the relevant values (e.g., 'Population') found within the evidence blocks. Make sure to link the value back to the correct entity (e.g., 'Country') from the *same* evidence block.
*   Do NOT use the "Evidence Row ID" (e.g., \`ID: row-uuid\`) for citation. Use only the inline \`[cell:CELL_ID]\` tags.
*   If the necessary linked information isn't present within any single evidence block (e.g., you find population numbers but no country names in the same blocks), state that you cannot answer the question based on the provided evidence structure. Do not make assumptions.

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
