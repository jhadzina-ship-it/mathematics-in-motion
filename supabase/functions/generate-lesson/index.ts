// Mathematics in Motion - "generate-lesson" Supabase Edge Function.
//
// A conversation with the author that ends in a lesson draft.
//   POST { messages: [{role: "user"|"assistant", content: string}], draft?: Lesson|null, script?: string, existing?: [...] }
//   ->   { reply: string, lesson: Lesson|null, usage }
// The assistant asks for what it still needs (video link, level, number of questions,
// setting, wishes), then proposes the complete lesson through a tool call. The browser
// shows the reply, and when a lesson comes back it fills the admin form for review.
// Only a signed-in author may call it. The Anthropic key lives in the function's
// secrets (ANTHROPIC_API_KEY), never in the browser.

import Anthropic from "npm:@anthropic-ai/sdk@0.72.0";
// The SDK resolves its optional "zod" helper at load time, so the package must exist even though it is not used here.
import "npm:zod@4.1.11";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const QUESTION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["prompt", "answer", "tolerance", "unit", "hint", "solution"],
  properties: {
    prompt: { type: "string", description: "The question as the student reads it. Give every number the student needs." },
    answer: { type: "number", description: "The correct numeric answer." },
    tolerance: { type: "number", description: "How far off still counts: 0.15 for answers to 1 decimal place, 0.01 for whole-number answers." },
    unit: { type: "string", description: "Unit shown after the answer box: '°', 'm', 'cm', or '' if none." },
    hint: { type: "string", description: "One sentence shown after a wrong attempt. Points at the method, never gives the answer." },
    solution: { type: "string", description: "Worked solution with every step and the final answer." },
  },
};

// The lesson record, exactly the fields of the lessons table that the author edits.
const LESSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["slug", "number", "title", "topic", "chapter", "level", "duration", "hook", "summary", "outcomes", "skills",
    "theorem", "explanation", "us_name", "textbook_envision", "textbook_bigideas", "textbook_hmh", "standard", "questions"],
  properties: {
    slug: { type: "string", description: "Lowercase letters, digits and dashes only, e.g. angle-of-depression." },
    number: { type: "string", description: "Lesson number within its chapter, e.g. 8.2. Do not reuse a number that an existing lesson already has." },
    title: { type: "string", description: "The lesson title." },
    topic: { type: "string", description: "One of: Trigonometry, Circles, Algebra & Functions, Calculus, Statistics & Probability, Geometry & Transformations, Mathematical Modelling." },
    chapter: { type: "string", description: "Format 'Chapter N · Topic', e.g. 'Chapter 8 · Trigonometry'. Reuse an existing chapter when the topic matches." },
    level: { type: "string", description: "e.g. 'Forms 3 and 4'." },
    duration: { type: "string", description: "Video length as m:ss if known, else ''." },
    hook: { type: "string", description: "One or two sentences, the real-world situation that makes a student curious." },
    summary: { type: "string", description: "At most 30 words, shown on the lesson card." },
    outcomes: { type: "string", description: "'What you'll learn': 4 to 6 points, one per line, separated by newline characters." },
    skills: { type: "string", description: "'Skills you'll gain': 4 to 6 short skill names, comma-separated." },
    theorem: { type: "string", description: "The idea in one sentence, as a theorem or rule statement." },
    explanation: { type: "string", description: "The explanation that sits under the video, 120 to 220 words, using the video's own numbers." },
    us_name: { type: "string", description: "What US textbooks call this result." },
    textbook_envision: { type: "string", description: "Where it sits in Savvas enVision Geometry (or Algebra), chapter/topic level." },
    textbook_bigideas: { type: "string", description: "Where it sits in Big Ideas Math Geometry (or Algebra), chapter level." },
    textbook_hmh: { type: "string", description: "Where it sits in HMH Into Geometry (or Algebra), unit level." },
    standard: { type: "string", description: "The matching Common Core standard code, e.g. HSG-SRT.C.8." },
    questions: { type: "array", description: "4 to 6 practice questions in rising difficulty unless the author asked for a number. Typed numeric answers only, never multiple choice.", items: QUESTION_SCHEMA },
  },
};

interface Question { prompt: string; answer: number; tolerance: number; unit: string; hint: string; solution: string; position?: number; figure?: string }
interface Lesson { slug: string; number: string; title: string; topic: string; chapter: string; level: string; duration: string; hook: string; summary: string; outcomes: string; skills: string; theorem: string; explanation: string; us_name: string; textbook_envision: string; textbook_bigideas: string; textbook_hmh: string; standard: string; questions: Question[]; video_id?: string; status?: string }
interface ChatMessage { role: "user" | "assistant"; content: string }

const SYSTEM = `You help Jephias Hadzina post lessons on Mathematics in Motion, a free site of short animated mathematics videos. Students are in Forms 3 and 4 in Zimbabwe (US grades 9 to 11), strong at mathematics and easily bored; the aim is to make them excited. You are talking with Jephias, the author, in a chat on his admin page.

Every lesson has one video, one idea, and a practice quiz with typed numeric answers (never multiple choice). Your job is to get from his words to a complete, correct lesson record, then propose it with the propose_lesson tool.

How to run the conversation:
- Be brief and friendly. One or two short questions at a time, never a long form.
- You need, at minimum: the YouTube link (or a clear description of the video if it is not uploaded yet) and what the lesson is about. Useful if he has them: the level (Form 3, Form 4, both), how many questions, a setting or story for the questions, anything he wants included or avoided, and his script if the video details are thin.
- If he gives you everything in his first message, do not ask questions: propose the lesson straight away.
- When the video details (title, description, length) are available, use them and do not ask for what they already tell you.
- Once you have enough, call propose_lesson with the complete record and say in one or two sentences what you made and what he might want to change. Do not paste the lesson as text.
- If a draft already exists and he asks for a change, call propose_lesson again with the whole record, changing only what he asked. Keep everything else exactly as it was.
- Never mark anything as posted or live yourself; he saves it from the form.

Writing rules for the lesson:
- Use the video's own numbers and setting in the explanation and in the first question. Later questions vary the numbers and the situation.
- Questions rise in difficulty: first the same calculation as the video, then new numbers, then an inverse (find a side from an angle, or vice versa), then a two-step question, then a conceptual twist.
- Every answer must be correct. Recompute each one from the question's numbers before you write it down, and show that computation in the solution. Round as the question asks and set the tolerance to match (0.15 for one decimal place, 0.01 for whole numbers).
- Hints point at the method and never state the answer.
- Plain British English with metres, degrees and decimal points. Use ÷ and × rather than / and *. Write angles like 33.7°.
- Textbook placement at chapter or topic level unless you are certain of a section. Never invent a section number.`;

function videoId(s: string): string {
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(s || "");
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test((s || "").trim()) ? s.trim() : "";
}

// Title, description and length of a YouTube video, via YouTube's own player endpoint, with oEmbed as a fallback for the title.
async function videoDetails(id: string): Promise<{ title: string; description: string; duration: string }> {
  const out = { title: "", description: "", duration: "" };
  if (!id) return out;
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en" } }, videoId: id }),
    });
    const j = await r.json();
    const d = j?.videoDetails || {};
    if (d.title) out.title = String(d.title);
    if (d.shortDescription) out.description = String(d.shortDescription);
    if (d.lengthSeconds) { const n = parseInt(d.lengthSeconds, 10); out.duration = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; }
  } catch (_) { /* fall through */ }
  if (!out.title) {
    try {
      const o = await (await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)).json();
      if (o?.title) out.title = String(o.title);
    } catch (_) { /* optional */ }
  }
  return out;
}

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

  // Only the signed-in author may generate.
  const auth = req.headers.get("Authorization") || "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "Sign in on the admin page first." }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set in the function's secrets." }, 500);

  let body: { messages?: ChatMessage[]; draft?: Lesson | null; script?: string; existing?: { number: string; title: string; chapter: string }[] };
  try { body = await req.json(); } catch { return json({ error: "Bad request body." }, 400); }
  const history = (body.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send at least one user message." }, 400);

  // Find the video: the latest link in the conversation, else the draft's id.
  let id = "";
  for (let i = history.length - 1; i >= 0 && !id; i--) id = videoId(history[i].content);
  if (!id && body.draft?.video_id) id = videoId(body.draft.video_id);
  const details = await videoDetails(id);

  // Context the model gets with every turn (kept out of the chat transcript itself).
  const context: string[] = [];
  if (id) context.push(`YouTube video id: ${id}`);
  if (details.title) context.push(`Video title: ${details.title}`);
  if (details.duration) context.push(`Video length: ${details.duration}`);
  if (details.description) context.push(`Video description:\n${details.description}`);
  if (body.script) context.push(`The author's script or transcript of the video:\n${body.script}`);
  if (body.existing?.length) context.push(`Lessons already on the site (number, title, chapter):\n` + body.existing.map((l) => `${l.number} ${l.title} (${l.chapter})`).join("\n"));
  if (body.draft) context.push(`The draft currently in the author's form (JSON). If he asks for changes, change only what he asks:\n${JSON.stringify(body.draft)}`);

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  if (context.length) {
    // Attach the context to the latest user turn so it is always current.
    const last = messages[messages.length - 1];
    last.content = `${last.content}\n\n[Context for you, not written by the author]\n${context.join("\n\n")}`;
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM,
      tools: [{
        name: "propose_lesson",
        description: "Propose the complete lesson record for the author to review in his form. Call it once you have enough to write a good lesson, and again with the whole record whenever he asks for a change.",
        strict: true,
        input_schema: LESSON_SCHEMA,
      }],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages,
    });
    if (response.stop_reason === "refusal") {
      return json({ error: "The model declined this request: " + (response.stop_details?.explanation || "no reason given") }, 422);
    }
    let reply = "";
    let lesson: Lesson | null = null;
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
      if (block.type === "tool_use" && block.name === "propose_lesson") {
        const l = block.input as Lesson;
        if (l && typeof l.title === "string" && Array.isArray(l.questions)) {
          l.slug = slugify(l.slug || l.title);
          if (!l.duration && details.duration) l.duration = details.duration;
          l.questions = l.questions.map((q, i) => ({ ...q, position: i + 1, figure: "" }));
          lesson = { ...l, video_id: id, status: "draft" };
        }
      }
    }
    if (!reply && lesson) reply = `I have put a draft of "${lesson.title}" with ${lesson.questions.length} questions in the form. Tell me what to change, or check the answers and save it.`;
    if (!reply && !lesson) reply = "Sorry, I did not manage to write anything. Try again or give me a bit more detail.";
    return json({ reply, lesson, usage: response.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Generation failed: " + message }, 500);
  }
});
