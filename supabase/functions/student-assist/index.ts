// Mathematics in Motion - "student-assist" Supabase Edge Function.
//
// The public assistant students use. No account: anyone on the site may call it,
// so it is rate-limited per IP and every mode is narrow.
//
//   POST { mode: "help",   messages: [...], lesson?: {...} }       -> { reply }
//   POST { mode: "mark",   question: {...}, working?: string, image?: {media_type, data} } -> { verdict, score, feedback, next_step }
//   POST { mode: "test",   topic: {...}, lessons: [...], count?: number } -> { questions: [...] }
//   POST { mode: "report", test: {...}, answers: [...] } -> { score, summary, weak_areas: [...] }
//
// The Anthropic key lives in the function's secrets (ANTHROPIC_API_KEY), never in the browser.

import Anthropic from "npm:@anthropic-ai/sdk@0.72.0";
import "npm:zod@4.1.11";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-opus-5-5";

// ---- Rate limit per IP (per function instance; good enough to stop a runaway script).
const LIMIT_PER_HOUR = 60;
const hits = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= LIMIT_PER_HOUR) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr); return true;
}

const SITE_HELP = `Mathematics in Motion is a free Zimbabwean site of short animated mathematics videos for O-Level students (Forms 3 and 4, ZIMSEC Mathematics Syllabus B), made by Jephias Hadzina.
How it works: Lessons are grouped by syllabus topic (for example Topic 10 Trigonometry) and numbered in order, 10.1, 10.2, 10.3. Each lesson has three parts: Watch (the video), Read (the idea in one sentence, with the explanation), and Practice (questions). A lesson opens only when the one before it in the topic is finished; a lesson is finished when its practice is passed (80% or more).
Practice questions are calculations. The student types the final answer and can also type their working or upload a photo of their written working to get it marked with feedback. The first question of every lesson uses the video's own numbers, so watching the video is needed. A hint appears after a wrong attempt and the worked solution opens after two.
Tests: the Tests page builds a short test on one topic from its lessons; after marking, the report shows which lessons to go back to.
Progress is saved in the browser only (no account). Clearing browser data resets it. The site is free and has no sign-up.
For a question about mathematics inside a lesson: give hints and point at the method, never the final answer to a practice question.`;

interface Msg { role: "user" | "assistant"; content: string }
interface Q { prompt: string; answer: number; tolerance?: number; unit?: string; solution?: string; hint?: string; kind?: string; lesson?: string; lesson_slug?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (!allowed(ip)) return json({ error: "Too many requests from this connection. Please wait a little and try again." }, 429);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "The assistant is not configured yet." }, 500);
  const client = new Anthropic({ apiKey });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request body." }, 400); }
  const mode = String(body.mode || "");

  try {
    // ------------------------------------------------------------ help: site usage and hints
    if (mode === "help") {
      const history = ((body.messages as Msg[]) || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-12);
      if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send a message." }, 400);
      const lesson = body.lesson as { title?: string; number?: string; theorem?: string; explanation?: string; questions?: { prompt: string }[] } | undefined;
      let ctx = "";
      if (lesson?.title) {
        ctx = `\n\nThe student is on lesson ${lesson.number || ""} "${lesson.title}". The idea: ${lesson.theorem || ""}. Explanation: ${(lesson.explanation || "").slice(0, 1200)}.` +
          (lesson.questions?.length ? ` Practice questions: ${lesson.questions.map((q, i) => `(${i + 1}) ${q.prompt}`).join(" ")}. Help with the method only; never give a final numeric answer to these.` : "");
      }
      const response = await client.beta.messages.create({
        model: MODEL, max_tokens: 1200,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive" }, output_config: { effort: "low" },
        system: `You are the help assistant on Mathematics in Motion. Answer in two to five short sentences, plain British English, friendly, for a 14 to 16 year old. Only talk about this site and the mathematics in its lessons. If asked for anything else, say what you can help with instead.\n\n${SITE_HELP}${ctx}`,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      const reply = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
      return json({ reply: reply || "Sorry, I did not catch that. Ask me how the site works or for a hint on the lesson." });
    }

    // ------------------------------------------------------------ mark: the student's working
    if (mode === "mark") {
      const q = body.question as Q;
      const working = String(body.working || "").slice(0, 4000);
      const image = body.image as { media_type: string; data: string } | undefined;
      if (!q || !q.prompt || typeof q.answer !== "number") return json({ error: "Missing question." }, 400);
      if (!working.trim() && !image) return json({ error: "Type your working or add a photo of it." }, 400);
      if (image && (!/^image\/(jpeg|png|webp|gif)$/.test(image.media_type) || image.data.length > 2_800_000)) return json({ error: "Photo must be a JPEG, PNG or WebP under 2 MB." }, 400);
      const studentAnswer = body.student_answer == null ? "" : String(body.student_answer);

      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: image.media_type as "image/jpeg", data: image.data } });
      content.push({ type: "text", text:
        `Question: ${q.prompt}\nCorrect answer: ${q.answer}${q.unit ? " " + q.unit : ""} (tolerance ${q.tolerance ?? 0.01})\nMarking scheme (worked solution): ${q.solution || "not given"}\n\n` +
        `Student's final answer: ${studentAnswer || "not typed"}\nStudent's typed working: ${working || "(none; see the photo)"}${image ? "\nThe photo shows the student's handwritten working." : ""}` });

      const response = await client.beta.messages.create({
        model: MODEL, max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive" }, output_config: { effort: "medium", format: { type: "json_schema", schema: {
          type: "object", additionalProperties: false, required: ["verdict", "score", "feedback", "next_step"],
          properties: {
            verdict: { type: "string", enum: ["correct", "partly", "incorrect", "unreadable"], description: "correct = right method and right answer; partly = right method with a slip, or right answer with missing working; incorrect = wrong method or answer; unreadable = the working cannot be read." },
            score: { type: "number", description: "0 to 1: full marks 1, method right but slip 0.5 to 0.8, little of value 0 to 0.3." },
            feedback: { type: "string", description: "Two to four sentences to the student in plain British English: what was right, where it went wrong (name the exact step), and what a correct step looks like. For 'correct', say what they did well. Never belittle." },
            next_step: { type: "string", description: "One sentence: what to try next (redo a step, re-watch a part of the video, move on)." },
          } } } },
        system: "You are a kind, exact O-Level mathematics marker in Zimbabwe (Forms 3 and 4). Mark the student's working against the marking scheme. Method marks matter: a right method with an arithmetic slip earns most of the credit; a bare correct answer with no working earns less than full. Read handwriting carefully; if it truly cannot be read, say so rather than guess. Use ÷ and × and write angles like 33.7°.",
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") return json({ error: "The marker could not look at this submission." }, 422);
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return json(JSON.parse(text));
    }

    // ------------------------------------------------------------ test: build a topic test
    if (mode === "test") {
      const topic = body.topic as { number: number; name: string } | undefined;
      const lessons = (body.lessons as { number: string; title: string; slug: string; theorem?: string; outcomes?: string; questions?: Q[] }[]) || [];
      const count = Math.min(10, Math.max(4, Number(body.count) || 6));
      if (!topic || !lessons.length) return json({ error: "No lessons for this topic yet." }, 400);
      const pool = lessons.map((l) => `Lesson ${l.number} "${l.title}" (slug ${l.slug}). Idea: ${l.theorem || ""}. Outcomes: ${(l.outcomes || "").replace(/\n/g, "; ")}. Sample questions: ` +
        (l.questions || []).slice(0, 4).map((q) => `[${q.prompt} -> ${q.answer}${q.unit || ""}]`).join(" ")).join("\n\n");
      const response = await client.beta.messages.create({
        model: MODEL, max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive" }, output_config: { effort: "high", format: { type: "json_schema", schema: {
          type: "object", additionalProperties: false, required: ["questions"],
          properties: { questions: { type: "array", items: { type: "object", additionalProperties: false,
            required: ["lesson_slug", "lesson", "prompt", "answer", "tolerance", "unit", "solution"],
            properties: {
              lesson_slug: { type: "string", description: "slug of the lesson this question tests" },
              lesson: { type: "string", description: "lesson number and title" },
              prompt: { type: "string" }, answer: { type: "number" }, tolerance: { type: "number" }, unit: { type: "string" },
              solution: { type: "string", description: "worked solution, also the marking scheme" },
            } } } } } } },
        system: `You set a short O-Level (ZIMSEC, Forms 3 and 4) mathematics test on one syllabus topic, built from the site's lessons. Write ${count} fresh calculation questions, spread across the lessons (at least one per lesson, more for the lessons with more content), rising in difficulty, with new numbers and settings (not the sample questions). Every answer must be correct: recompute each from its numbers and show it in the solution. Tolerance 0.15 for answers to 1 d.p., 0.01 for whole numbers. Plain British English, metres and degrees, ÷ and ×.`,
        messages: [{ role: "user", content: `Topic ${topic.number}: ${topic.name}\n\nLessons:\n${pool}` }],
      });
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return json(JSON.parse(text));
    }

    // ------------------------------------------------------------ report: weak areas after a test
    if (mode === "report") {
      const test = body.test as { topic: { number: number; name: string }; questions: Q[] };
      const answers = (body.answers as { answer: string; correct: boolean; working?: string }[]) || [];
      if (!test?.questions?.length || answers.length !== test.questions.length) return json({ error: "Missing test or answers." }, 400);
      const rows = test.questions.map((q, i) => `Q${i + 1} (${q.lesson}, slug ${q.lesson_slug}): ${q.prompt}\n  correct answer ${q.answer}${q.unit || ""}; student answered "${answers[i].answer}" -> ${answers[i].correct ? "right" : "wrong"}${answers[i].working ? "; working: " + String(answers[i].working).slice(0, 600) : ""}`).join("\n");
      const response = await client.beta.messages.create({
        model: MODEL, max_tokens: 3000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "adaptive" }, output_config: { effort: "medium", format: { type: "json_schema", schema: {
          type: "object", additionalProperties: false, required: ["summary", "weak_areas", "strengths"],
          properties: {
            summary: { type: "string", description: "Three sentences to the student: how they did and the single most useful thing to do next." },
            strengths: { type: "array", items: { type: "string" } },
            weak_areas: { type: "array", items: { type: "object", additionalProperties: false, required: ["lesson_slug", "lesson", "what", "advice"],
              properties: { lesson_slug: { type: "string" }, lesson: { type: "string" }, what: { type: "string", description: "the specific skill that went wrong" }, advice: { type: "string", description: "one sentence: which part of the lesson to redo" } } } },
          } } } },
        system: "You write a short, encouraging report for an O-Level student after a topic test, in plain British English. Be specific about which skill failed in each wrong answer and point to the lesson that teaches it. Do not list a lesson as weak if its questions were all right.",
        messages: [{ role: "user", content: `Topic ${test.topic.number}: ${test.topic.name}\nScore: ${answers.filter((a) => a.correct).length} of ${answers.length}\n\n${rows}` }],
      });
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return json({ score: answers.filter((a) => a.correct).length, total: answers.length, ...JSON.parse(text) });
    }

    return json({ error: "Unknown mode." }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "The assistant hit a problem: " + message }, 500);
  }
});
