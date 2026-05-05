import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// ── Gemini message format converter ──────────────────────────
// Anthropic uses { role: "user"|"assistant", content: "..." }
// Gemini uses  { role: "user"|"model",       parts: [{ text }] }
function toGeminiHistory(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// ── Chat endpoint ─────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // Gemini doesn't have a dedicated system field in the REST API —
  // we prepend the system prompt as the first user turn + model ack.
  const systemTurns = [
    { role: "user", parts: [{ text: `[SYSTEM INSTRUCTIONS]\n${system}` }] },
    { role: "model", parts: [{ text: "Understood. I'll follow those instructions." }] },
  ];

  const history = toGeminiHistory(messages);

  // The last message is the current user turn; everything before is history.
  const currentTurn = history.pop();
  const fullContents = [...systemTurns, ...history, currentTurn];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: fullContents,
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.9,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Gemini API error:", err);
      return res.status(response.status).json({
        error: err?.error?.message || `Gemini API error ${response.status}`,
      });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: "No response from Gemini" });
    }

    res.json({ text });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`✓ PrepRoom server running on http://localhost:${PORT}`);
  console.log(`✓ Gemini model: gemini-2.0-flash`);
  console.log(`✓ Accepting requests from: ${process.env.CLIENT_URL || "http://localhost:5173"}`);
});
