// Mathematics in Motion - "generate-lesson" Supabase Edge Function.
//
// POST { video_url, prompt, script?, draft? }  ->  { lesson }
// Takes a YouTube link and the author's plain-language request and returns a
// complete lesson draft in the site's lesson shape, for review on the admin page.
// Only a signed-in author may call it. The Anthropic key lives in the function's
// secrets (ANTHROPIC_API_KEY), never in the browser.

import Anthropic from "npm:@anthropic-ai/sdk@0.72.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.72.0/helpers/zod";
import { z } from "npm:zod@3.25.76";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const QuestionSchema = z.object({
  prompt: z.string().describe("The question as the student reads it. Give every number the student needs."),
  answer: z.number().describe("The correct numeric answer."),
  tolerance: z.number().describe("How far off still counts: 0.15 for answers to 1 decimal place, 0.01 for whole-number answers."),
  unit: z.string().describe("Unit shown after the answer box: '°', 'm', 'cm', or '' if none."),
  hint: z.string().describe("One sentence shown after a wrong attempt. Points at the method, never gives the answer."),
  solution: z.string().describe("Worked solution with every step and the final answer."),
});

const LessonSchema = z.object({
  slug: z.string().describe("Lowercase letters, digits and dashes only, e.g. angle-of-depression."),
  number: z.string().describe("Lesson number within its chapter, e.g. 8.2."),
  title: z.string(),
  topic: z.string().describe("One of: Trigonometry, Circles, Algebra & Functions, Calculus, Statistics & Probability, Geometry & Transformations, Mathematical Modelling."),
  chapter: z.string().describe("Format 'Chapter N · Topic', e.g. 'Chapter 8 · Trigonometry'. Reuse an existing chapter when the topic matches."),
  level: z.string().describe("e.g. 'Forms 3 and 4'."),
  duration: z.string().describe("Video length as m:ss if known, else ''."),
  hook: z.string().describe("One or two sentences, the real-world situation that makes a student curious."),
  summary: z.string().describe("At most 30 words, shown on the lesson card."),
  outcomes: z.string().describe("'What you'll learn': 4 to 6 points, one per line, separated by newline characters."),
  skills: z.string().describe("'Skills you'll gain': 4 to 6 short skill names, comma-separated."),
  theorem: z.string().describe("The idea in one sentence, as a theorem or rule statement."),
  explanation: z.string().describe("The explanation that sits under the video, 120 to 220 words, using the video's own numbers."),
  us_name: z.string().describe("What US textbooks call this result."),
  textbook_envision: z.string().describe("Where it sits in Savvas enVision Geometry (or Algebra), chapter/topic level."),
  textbook_bigideas: z.string().describe("Where it sits in Big Ideas Math Geometry (or Algebra), chapter level."),
  textbook_hmh: z.string().describe("Where it sits in HMH Into Geometry (or Algebra), unit level."),
  standard: z.string().describe("The matching Common Core standard code, e.g. HSG-SRT.C.8."),
  questions: z.array(QuestionSchema).describe("4 to 6 practice questions in rising difficulty. Typed numeric answers only, never multiple choice."),
});

type Lesson = z.infer<typeof LessonSchema>;

const SYSTEM = `You write lessons for Mathematics in Motion, a free site of short animated mathematics videos by Jephias Hadzina, a Zimbabwean teacher. Students are in Forms 3 and 4 (US grades 9 to 11), strong at mathematics and easily bored; the aim is to make them excited.

Every lesson has one video, one idea, and a practice quiz with typed numeric answers (never multiple choice). You produce the complete lesson record from the video's details and the author's request.

Rules:
- Use the video's own numbers and setting in the explanation and in the first question. Later questions vary the numbers and the situation.
- Questions rise in difficulty: first the same calculation as the video, then new numbers, then an inverse (find a side from an angle, or vice versa), then a two-step question, then a conceptual twist.
- Every answer must be correct. Recompute each one from the question's numbers before you write it down, and show that computation in the solution. Round as the question asks and set the tolerance to match (0.15 for one decimal place, 0.01 for whole numbers).
- Hints point at the method and never state the answer.
- Write in plain British English with metres, degrees and decimal points. Use ÷ and × rather than / and *. Write angles like 33.7°.
- Textbook placement is at chapter or topic level unless you are certain of a section. Never invent a section number.
- Keep the author's wishes: if the request names a setting, a number of questions, a difficulty or a style, follow it.
- If the author gives a draft and an instruction, change only what the instruction asks and keep everything else exactly as it is.`;

function videoId(s: string): string {
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(s || "");
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test((s || "").trim()) ? s.trim() : "";
}

async function videoDetails(id: string): Promise<{ title: string; description: string; duration: string }> {
  const out = { title: "", description: "", duration: "" };
  if (!id) return out;
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; lesson-generator)" },
    })).text();
    const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(html);
    const desc = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html);
    const secs = /"lengthSeconds":"(\d+)"/.exec(html);
    if (title) out.title = JSON.parse(`"${title[1]}"`);
    if (desc) out.description = JSON.parse(`"${desc[1]}"`);
    if (secs) { const n = parseInt(secs[1], 10); out.duration = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; }
  } catch (_) { /* details are optional */ }
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

  let body: { video_url?: string; prompt?: string; script?: string; draft?: Partial<Lesson> | null };
  try { body = await req.json(); } catch { return json({ error: "Bad request body." }, 400); }
  const id = videoId(body.video_url || (body.draft as { video_id?: string } | null | undefined)?.video_id || "");
  const details = await videoDetails(id);

  const parts: string[] = [];
  if (id) parts.push(`YouTube video id: ${id}`);
  if (details.title) parts.push(`Video title: ${details.title}`);
  if (details.duration) parts.push(`Video length: ${details.duration}`);
  if (details.description) parts.push(`Video description:\n${details.description}`);
  if (body.script) parts.push(`The author's script or transcript of the video:\n${body.script}`);
  if (body.draft) parts.push(`Current draft of the lesson (JSON):\n${JSON.stringify(body.draft)}`);
  parts.push(body.draft
    ? `The author's instruction for changing the draft:\n${body.prompt || "Improve it."}`
    : `The author's request for this lesson:\n${body.prompt || "Write the lesson for this video."}`);

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(LessonSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    if (response.stop_reason === "refusal") {
      return json({ error: "The model declined this request: " + (response.stop_details?.explanation || "no reason given") }, 422);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const lesson = LessonSchema.parse(JSON.parse(text));
    lesson.slug = slugify(lesson.slug || lesson.title);
    if (!lesson.duration && details.duration) lesson.duration = details.duration;
    return json({ lesson: { ...lesson, video_id: id, status: "draft" }, usage: response.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Generation failed: " + message }, 500);
  }
});
