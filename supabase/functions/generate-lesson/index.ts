// Mathematics in Motion - "generate-lesson" Supabase Edge Function.
//
// A conversation with the author that ends in a lesson draft.
//   POST { messages: [{role: "user"|"assistant", content: string}], draft?: Lesson|null, script?: string, existing?: [...] }
//   ->   { reply: string, lesson: Lesson|null, usage }
// The assistant asks for what it still needs (video link, level, number of questions,
// setting, wishes), then proposes the complete lesson through a tool call. The browser
// shows the reply, and when a lesson comes back it fills the admin form for review.
// Lessons are aligned to the Zimbabwe O-Level syllabus (MoPSE/ZIMSEC Mathematics
// Syllabus B, Forms 1-4, 2024-2030) and numbered within its topics: 10.1, 10.2, ...
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

// Syllabus B topics (scope-and-sequence chart numbering). Chapters on the site use these numbers.
const TOPICS: Record<number, string> = {
  1: "Real Numbers", 2: "Sets", 3: "Financial Mathematics", 4: "Measures and Mensuration", 5: "Graphs", 6: "Variation",
  7: "Algebra", 8: "Geometry", 9: "Statistics", 10: "Trigonometry", 11: "Matrices", 12: "Vectors", 13: "Transformations", 14: "Probability",
};
const SYLLABUS_NOTES = `Form 3 and Form 4 content by topic (MoPSE/ZIMSEC Mathematics Syllabus B 2024-2030, scope-and-sequence chart):
1 Real Numbers: F3 irrational numbers, number patterns, limits of accuracy, ratios/rates/proportions, operations in standard form, converting number bases, scales (length and area factor); F4 operations in number bases.
2 Sets: F3 set builder notation, Venn diagrams with three subsets.
3 Financial Mathematics: F3 enterprise budgets, bank statements, compound interest, commission, hire purchase, foreign exchange; F4 PAYE, VAT, customs and excise duty.
4 Measures and Mensuration: F3 perimeter and area of combined shapes, volume of cones and pyramids, density; F4 area and volume of similar shapes, surface area, volume of prisms.
5 Graphs: F3 functional notation, linear and quadratic graphs, distance-time and speed-time graphs; F4 cubic and inverse graphs, displacement-time and velocity-time graphs.
6 Variation: F3 direct and inverse variation; F4 joint and partial variation.
7 Algebra: F3 algebraic fractions, HCF/LCM of expressions, quadratic expressions, factorisation, quadratic and simultaneous equations, change of subject, simultaneous inequalities, graphs of inequalities, indices, logarithms; F4 completing the square, quadratic formula, linear programming, theory of logarithms, equations with indices and logarithms.
8 Geometry: F3 angles of elevation and depression (scale drawing), bearings, properties of polygons, angle properties of polygons, circle theorems, areas of similar figures, volume and mass of similar solids, constructions of triangles and quadrilaterals, rotational symmetry; F4 circle theorems (angle at the centre and circumference, angle in a semicircle, angles in the same segment, angle in the alternate segment, cyclic quadrilateral, tangent and radius), numbers of sides of polygons, construction to scale, loci.
9 Statistics: F3 grouped data, histogram, frequency polygon, mean/median/mode of grouped data, assumed mean; F4 cumulative frequency table and curve, median from the curve, quartiles, interquartile range.
10 Trigonometry: F3 Pythagoras theorem, trigonometrical ratios of acute angles (sine, cosine, tangent), solving right-angled triangles in two dimensions; F4 ratios of obtuse angles, sine rule, cosine rule.
11 Matrices: F3 addition, subtraction, scalar multiplication, multiplication, determinants, singular and non-singular matrices; F4 inverse of a matrix, simultaneous equations by matrices.
12 Vectors: F3 translation, negative, equal and parallel vectors, addition and subtraction; F4 position vectors, scalar multiplication, magnitude, combined operations, vector properties of plane shapes.
13 Transformations: F3 translation vectors on the Cartesian plane, reflection in the axes and in lines y = a and x = b, rotation by drawing, enlargement about the origin by drawing; F4 use of matrices for reflection, rotation and enlargement about any point, stretch, shear.
14 Probability: F3 experimental and theoretical probability, single events; F4 combined events, applications.`;

const QUESTION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kind", "prompt", "answer", "tolerance", "unit", "hint", "solution"],
  properties: {
    kind: { type: "string", enum: ["video_check", "calculation"], description: "'video_check' for a question whose numbers come straight from the video so it shows the student watched it; 'calculation' for the rest. Exactly one video_check per lesson, placed first." },
    prompt: { type: "string", description: "The question as the student reads it. A calculation the student must work through on paper. Give every number the student needs." },
    answer: { type: "number", description: "The correct numeric answer." },
    tolerance: { type: "number", description: "How far off still counts: 0.15 for answers to 1 decimal place, 0.01 for whole-number answers." },
    unit: { type: "string", description: "Unit shown after the answer box: '°', 'm', 'cm', or '' if none." },
    hint: { type: "string", description: "One sentence shown after a wrong attempt. Points at the method, never gives the answer." },
    solution: { type: "string", description: "Worked solution with every step and the final answer. This is also the marking scheme for the student's working." },
  },
};

// The lesson record, exactly the fields of the lessons table that the author edits.
const LESSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["slug", "syllabus_topic", "number", "title", "level", "syllabus_form", "syllabus_subtopic", "syllabus_objective", "textbook_ref", "duration",
    "hook", "summary", "outcomes", "skills", "theorem", "explanation", "questions"],
  properties: {
    slug: { type: "string", description: "Lowercase letters, digits and dashes only, e.g. angle-of-depression." },
    syllabus_topic: { type: "integer", description: "The topic number the lesson belongs to: 1 to 14 for the syllabus topics, or the number of one of the author's own topics given in the context. This decides the chapter." },
    number: { type: "string", description: "Lesson number: the topic number, a dot, then the next free position in that topic, e.g. 10.2. Use exactly the next free number given in the context unless the author asks for a specific one." },
    title: { type: "string", description: "The lesson title." },
    level: { type: "string", description: "'Form 3', 'Form 4' or 'Forms 3 and 4'." },
    syllabus_form: { type: "string", description: "The Form in which the syllabus places this content: 'Form 3' or 'Form 4'." },
    syllabus_subtopic: { type: "string", description: "The syllabus sub-topic, in the syllabus's words, e.g. 'Trigonometrical ratios' or 'Polygons: circle theorems'." },
    syllabus_objective: { type: "string", description: "The learning objective the lesson meets, in the syllabus's words where possible." },
    textbook_ref: { type: "string", description: "A Zimbabwean O-Level textbook chapter the teacher can use alongside, if you are confident of one (e.g. a New General Mathematics or ZIMSEC-approved text); otherwise ''. Never invent a chapter number." },
    duration: { type: "string", description: "Video length as m:ss if known, else ''." },
    hook: { type: "string", description: "One or two sentences, the real-world situation that makes a student curious." },
    summary: { type: "string", description: "At most 30 words, shown on the lesson card." },
    outcomes: { type: "string", description: "'What you'll learn': 4 to 6 points, one per line, separated by newline characters." },
    skills: { type: "string", description: "'Skills you'll gain': 4 to 6 short skill names, comma-separated." },
    theorem: { type: "string", description: "The idea in one sentence, as a theorem or rule statement." },
    explanation: { type: "string", description: "The explanation that sits under the video, 120 to 220 words, using the video's own numbers." },
    questions: { type: "array", description: "4 to 6 questions unless the author asked for a number: the first is the video_check, then calculations rising in difficulty. Typed numeric answers and written working; never multiple choice.", items: QUESTION_SCHEMA },
  },
};

interface Question { kind: string; prompt: string; answer: number; tolerance: number; unit: string; hint: string; solution: string; position?: number; figure?: string }
interface Lesson { slug: string; syllabus_topic: number; number: string; title: string; level: string; syllabus_form: string; syllabus_subtopic: string; syllabus_objective: string; textbook_ref: string; duration: string; hook: string; summary: string; outcomes: string; skills: string; theorem: string; explanation: string; questions: Question[]; topic?: string; chapter?: string; video_id?: string; status?: string }
interface ChatMessage { role: "user" | "assistant"; content: string }
interface Existing { number: string; title: string; chapter: string; syllabus_topic?: number; slug?: string }

const SYSTEM = `You help Jephias Hadzina post lessons on Mathematics in Motion, a free Zimbabwean site of short animated mathematics videos for O-Level students (Forms 3 and 4, ZIMSEC). Students are strong at mathematics and easily bored; the aim is to make them excited. You are talking with Jephias, the author, in a chat on his admin page.

Every lesson has one video, one idea, and practice questions that are calculations the student works through on paper and submits as typed working or a photo. Your job is to get from his words to a complete, correct lesson record, then propose it with the propose_lesson tool.

How to run the conversation:
- Be brief and friendly. One or two short questions at a time, never a long form.
- You need, at minimum: the YouTube link (or a clear description of the video if it is not uploaded yet) and what the lesson is about. Useful if he has them: the Form, how many questions, a setting or story for the questions, anything to include or avoid, and his script if the video details are thin.
- If he gives you everything in his first message, do not ask questions: propose the lesson straight away.
- When the video details (title, description, length) are in the context, use them and never ask for what they already tell you.
- The transcript matters most. When the context carries the author's transcript, every number, name, place and step in the explanation and in the video_check question must come from it, and the later questions build on the method it teaches. If he gives a video link and there is no transcript in the context, ask him once, in one line, to attach it with the "Attach the video's transcript" button under the chat (YouTube Studio, Subtitles, Download), and say he can tell you to go ahead without it. If he says he has none or to go ahead, write the lesson from the title and description and say so.
- Once you have enough, call propose_lesson with the complete record and say in one or two sentences what you made and what he might want to change. Do not paste the lesson as text.
- If a draft already exists and he asks for a change, call propose_lesson again with the whole record, changing only what he asked. Keep everything else exactly as it was.
- Never mark anything as posted or live yourself; he saves it from the form.

Syllabus and numbering:
- Place every lesson in one topic: a Syllabus B topic (1 to 14), or one of the author's own topics if the context names one. Give the Form, sub-topic and objective from the syllabus notes below where they apply; for the author's own topics, write a sub-topic and objective in the same style.
- Lessons inside a topic are numbered in teaching order: 10.1, 10.2, 10.3. The context tells you the next free number in each topic; use it. A student must finish one lesson before the next opens, so order matters: if the new lesson is a prerequisite of an existing one, say so and suggest the order, but still use the next free number unless Jephias asks to renumber.

Writing rules for the lesson:
- Use the video's own numbers and setting in the explanation and in the first question (the video_check), so a student who skipped the video cannot answer it. Later questions vary the numbers and the situation.
- Questions rise in difficulty: the video check, then new numbers, then an inverse (find a side from an angle, or vice versa), then a two-step question, then a conceptual twist. They must need written working, not a one-line recall.
- Every answer must be correct. Recompute each one from the question's numbers before you write it down, and show that computation in the solution. Round as the question asks and set the tolerance to match (0.15 for one decimal place, 0.01 for whole numbers).
- Hints point at the method and never state the answer.
- Plain British English with metres, degrees and decimal points. Use ÷ and × rather than / and *. Write angles like 33.7°.

${SYLLABUS_NOTES}`;

function videoId(s: string): string {
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(s || "");
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test((s || "").trim()) ? s.trim() : "";
}

// Title, description and length of a YouTube video via YouTube's player endpoint (web client), with oEmbed as a fallback for the title.
async function videoDetails(id: string): Promise<{ title: string; description: string; duration: string }> {
  const out = { title: "", description: "", duration: "" };
  if (!id) return out;
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en" } }, videoId: id }),
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

// Caption files (.srt, .sbv, .vtt) or pasted transcripts become plain words.
function plainTranscript(text: string): string {
  const out: string[] = []; let last = "";
  for (const ln of String(text || "").replace(/\r/g, "").split("\n")) {
    let s = ln.trim();
    if (!s || /^WEBVTT/i.test(s) || /^(Kind|Language):/i.test(s) || /^NOTE\b/.test(s)) continue;
    if (/^\d+$/.test(s)) continue;
    if (/\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->/.test(s)) continue;
    if (/^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3},\d{1,2}:\d{2}/.test(s)) continue;
    s = s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!s || s === last) continue;
    out.push(s); last = s;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// Next free lesson number in each topic, from the lessons already on the site.
function nextNumbers(existing: Existing[]): Record<number, string> {
  const max: Record<number, number> = {};
  for (const l of existing) {
    const m = /^(\d+)\.(\d+)$/.exec(String(l.number || "").trim());
    if (!m) continue;
    const t = parseInt(m[1], 10), n = parseInt(m[2], 10);
    if (!max[t] || n > max[t]) max[t] = n;
  }
  const out: Record<number, string> = {};
  for (let t = 1; t <= 14; t++) out[t] = `${t}.${(max[t] || 0) + 1}`;
  Object.keys(max).forEach((k) => { const t = Number(k); if (t > 14) out[t] = `${t}.${max[t] + 1}`; });
  return out;
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

  let body: { messages?: ChatMessage[]; draft?: Lesson | null; script?: string; existing?: Existing[]; topic_number?: number; topic_name?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request body." }, 400); }
  const history = (body.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
  if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send at least one user message." }, 400);
  const existing = (body.existing || []).filter((l) => l && l.number);

  // Find the video: the latest link in the conversation, else the draft's id.
  let id = "";
  for (let i = history.length - 1; i >= 0 && !id; i--) id = videoId(history[i].content);
  if (!id && body.draft?.video_id) id = videoId(body.draft.video_id);
  const details = await videoDetails(id);

  // Context the model gets with every turn (kept out of the chat transcript itself).
  const next = nextNumbers(existing.filter((l) => !body.draft || l.slug !== body.draft.slug));
  const context: string[] = [];
  if (id) context.push(`YouTube video id: ${id}`);
  if (details.title) context.push(`Video title: ${details.title}`);
  if (details.duration) context.push(`Video length: ${details.duration}`);
  if (details.description) context.push(`Video description:\n${details.description}`);
  const script = plainTranscript(body.script || "").slice(0, 24000);
  if (script) context.push(`The author's transcript of the video (the words spoken in it):\n${script}`);
  context.push(`Lessons already on the site (number, title):\n` + (existing.length ? existing.map((l) => `${l.number} ${l.title}`).join("\n") : "none yet"));
  context.push(`Next free lesson number in each topic:\n` + Object.keys(next).map((t) => `Topic ${t} ${TOPICS[Number(t)]}: ${next[Number(t)]}`).join("\n"));
  if (body.draft) context.push(`The draft currently in the author's form (JSON). If he asks for changes, change only what he asks and keep its number:\n${JSON.stringify(body.draft)}`);
  const forced = Number(body.topic_number) >= 1 ? Number(body.topic_number) : 0;
  if (forced && !TOPICS[forced]) TOPICS[forced] = String(body.topic_name || "Topic " + forced);
  if (forced) context.push(`The author opened Topic ${forced} (${TOPICS[forced]}) and is adding a subtopic inside it. The lesson MUST belong to topic ${forced}: syllabus_topic ${forced}, number ${body.draft?.number || next[forced]}. Do not ask which topic; if the video seems to belong elsewhere, say so in one sentence but still place it here.`);

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const last = messages[messages.length - 1];
  last.content = `${last.content}\n\n[Context for you, not written by the author]\n${context.join("\n\n")}`;

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
          const t = forced || Math.max(1, Number(l.syllabus_topic) || 1);
          if (!TOPICS[t]) TOPICS[t] = String(body.topic_name || "Topic " + t);
          if (!next[t]) next[t] = `${t}.1`;
          l.syllabus_topic = t;
          l.topic = TOPICS[t];
          l.chapter = `Topic ${t} · ${TOPICS[t]}`;
          const keep = body.draft?.number && String(body.draft.number).startsWith(t + ".") ? String(body.draft.number) : "";
          if (!/^\d+\.\d+$/.test(l.number || "") || !String(l.number).startsWith(t + ".")) l.number = keep || next[t];
          if (!l.duration && details.duration) l.duration = details.duration;
          l.questions = l.questions.map((q, i) => ({ ...q, kind: q.kind === "video_check" ? "video_check" : "calculation", position: i + 1, figure: "" }));
          lesson = { ...l, video_id: id, status: "draft" };
        }
      }
    }
    if (!reply && lesson) reply = `I have put a draft of "${lesson.title}" (lesson ${lesson.number}) with ${lesson.questions.length} questions in the form. Tell me what to change, or check the answers and save it.`;
    if (!reply && !lesson) reply = "Sorry, I did not manage to write anything. Try again or give me a bit more detail.";
    return json({ reply, lesson, usage: response.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Generation failed: " + message }, 500);
  }
});
