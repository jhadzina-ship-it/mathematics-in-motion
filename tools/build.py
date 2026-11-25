"""Build step for the Mathematics in Motion site (run by hand, nothing on the server):
  1. writes the SVG figures to site/assets/figures/
  2. writes content/lessons.js (bundled fallback) and supabase/seed.sql from content/lessons.json
  3. substitutes {{HERO}} in index.html if present
Usage: python -I figures.py <site dir>"""
import math, sys, pathlib, json, re

SITE = pathlib.Path(sys.argv[1])
FIG = SITE / "assets" / "figures"
FIG.mkdir(parents=True, exist_ok=True)

def f(v):
    return f"{v:.1f}"

def text(p, s, dx=0, dy=0, size=14, color="currentColor", weight="600", anchor="middle"):
    return (f'<text x="{f(p[0] + dx)}" y="{f(p[1] + dy)}" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}" dominant-baseline="middle" '
            f'font-family="Inter, system-ui, sans-serif">{s}</text>')

def line(p, q, color="var(--accent)", w=2.2, dash=None):
    extra = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{f(p[0])}" y1="{f(p[1])}" x2="{f(q[0])}" y2="{f(q[1])}" '
            f'stroke="{color}" stroke-width="{w}" stroke-linecap="round"{extra}/>')

def dot(p, r=3.2):
    return f'<circle cx="{f(p[0])}" cy="{f(p[1])}" r="{r}" fill="currentColor"/>'

def angle_marker(vertex, p1, p2, r=20, label=None, label_r=34, color="var(--spark)"):
    vx, vy = vertex
    a1 = math.atan2(p1[1] - vy, p1[0] - vx)
    a2 = math.atan2(p2[1] - vy, p2[0] - vx)
    d = a2 - a1
    while d <= -math.pi: d += 2 * math.pi
    while d > math.pi: d -= 2 * math.pi
    sweep = 1 if d > 0 else 0
    s = (vx + r * math.cos(a1), vy + r * math.sin(a1))
    e = (vx + r * math.cos(a2), vy + r * math.sin(a2))
    mid = a1 + d / 2
    out = (f'<path d="M {f(s[0])} {f(s[1])} A {r} {r} 0 0 {sweep} {f(e[0])} {f(e[1])}" '
           f'fill="none" stroke="{color}" stroke-width="2.5"/>')
    if label:
        out += text((vx + label_r * math.cos(mid), vy + label_r * math.sin(mid)), label, size=13, color=color)
    return out

def svg(w, h, title, body, style=""):
    # Standalone SVG files: the CSS variables are not available, so give them defaults.
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="t">'
            f'<title id="t">{title}</title>'
            f'<style>:root{{--accent:#1d4ed8;--spark:#d97706;--ink:#16213e}} svg{{color:var(--ink)}}'
            f'@media (prefers-color-scheme: dark){{:root{{--accent:#7aa2ff;--spark:#fbbf24;--ink:#eef0f6}}}}{style}</style>'
            f'{body}</svg>')

# ---------------------------------------------------------------- circle figures
CX, CY, R = 130, 120, 80

def pt(theta_deg):
    t = math.radians(theta_deg)
    return (CX + R * math.cos(t), CY + R * math.sin(t))

def circle_figure(title, thetaB, thetaC, markers):
    A, B, C = pt(90), pt(thetaB), pt(thetaC)
    P, Q = (CX - 108, A[1]), (CX + 108, A[1])
    parts = [f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="currentColor" stroke-width="2"/>',
             line(P, Q, color="currentColor", w=2), text(P, "P", dx=-10), text(Q, "Q", dx=10),
             line(A, B), line(A, C), line(B, C)]
    parts += markers(A, B, C, P, Q)
    parts += [dot(A), dot(B), dot(C), text(A, "A", dy=16)]
    for p, name in ((B, "B"), (C, "C")):
        ang = math.atan2(p[1] - CY, p[0] - CX)
        parts.append(text((CX + (R + 14) * math.cos(ang), CY + (R + 14) * math.sin(ang)), name))
    return svg(260, 230, title, "".join(parts))

circle_figs = {
    "segment-theorem.svg": circle_figure(
        "The alternate segment theorem: the tangent-chord angle equals the angle in the alternate segment",
        90 - 2 * 50, 215,
        lambda A, B, C, P, Q: [angle_marker(A, Q, B, label="α"), angle_marker(C, A, B, label="α")]),
    "segment-q1.svg": circle_figure(
        "Tangent PQ at A, chord AB, point C on the far arc; angle QAB is 58 degrees, angle ACB is x",
        90 - 2 * 58, 210,
        lambda A, B, C, P, Q: [angle_marker(A, Q, B, label="58°"), angle_marker(C, A, B, label="x", color="var(--accent)")]),
    "segment-q2.svg": circle_figure(
        "Tangent PQ at A, triangle ABC inscribed; angle ACB is 41 degrees, angle QAB is y",
        90 - 2 * 41, 210,
        lambda A, B, C, P, Q: [angle_marker(C, A, B, label="41°"), angle_marker(A, Q, B, label="y", color="var(--accent)")]),
    "segment-q3.svg": circle_figure(
        "Tangent PQ at A; angle PAB is 65 degrees, angle QAC is 47 degrees, angle BAC is z",
        90 + 2 * 65, 90 - 2 * 47,
        lambda A, B, C, P, Q: [angle_marker(A, P, B, label="65°", r=18, label_r=36),
                               angle_marker(A, Q, C, label="47°", r=18, label_r=36),
                               angle_marker(A, B, C, label="z", r=30, label_r=46, color="var(--accent)")]),
    "segment-q4.svg": circle_figure(
        "Tangent PQ at A and triangle ABC; angle QAB is 52 degrees, angle ABC is 73 degrees, angle BAC is w",
        90 - 2 * 52, 90 + 146,
        lambda A, B, C, P, Q: [angle_marker(A, Q, B, label="52°"), angle_marker(B, A, C, label="73°"),
                               angle_marker(A, B, C, label="w", r=30, label_r=46, color="var(--accent)")]),
}

# ---------------------------------------------------------------- elevation figures
def elevation_figure(title, adj, opp, adj_label, opp_label, angle_label, eye_height_label=None, bird=True):
    W, H = 320, 220
    ground = 196 if eye_height_label else 180
    eye = (62, ground - (46 if eye_height_label else 30) - 30)
    eye = (62, 128)
    scale = min(170 / adj, 92 / opp)
    foot = (eye[0] + adj * scale, eye[1])          # where the vertical meets the horizontal line
    top = (foot[0], eye[1] - opp * scale)           # the object
    parts = []
    # ground and wall
    parts.append(line((10, ground), (W - 10, ground), color="currentColor", w=2))
    wall_top = min(top[1] - 4, eye[1] - 20)
    parts.append(f'<rect x="{f(foot[0])}" y="{f(wall_top)}" width="40" height="{f(ground - wall_top)}" '
                 f'fill="none" stroke="currentColor" stroke-width="2" rx="2"/>')
    for yy in range(int(wall_top) + 12, int(ground) - 6, 12):
        parts.append(line((foot[0], yy), (foot[0] + 40, yy), color="currentColor", w=1, dash="3 4"))
    # observer: head, body, legs
    parts.append(f'<circle cx="{f(eye[0] - 8)}" cy="{f(eye[1])}" r="7" fill="none" stroke="currentColor" stroke-width="2"/>')
    parts.append(line((eye[0] - 8, eye[1] + 7), (eye[0] - 8, ground - 22), color="currentColor", w=2))
    parts.append(line((eye[0] - 8, ground - 22), (eye[0] - 16, ground), color="currentColor", w=2))
    parts.append(line((eye[0] - 8, ground - 22), (eye[0], ground), color="currentColor", w=2))
    # the object (bird or flag)
    if bird:
        parts.append(f'<path d="M {f(top[0]-7)} {f(top[1]+2)} l 7 -12 l 7 12 z" fill="var(--spark)"/>')
    else:
        parts.append(line((top[0], top[1] + 2), (top[0], top[1] - 14), color="currentColor", w=2))
        parts.append(f'<path d="M {f(top[0])} {f(top[1]-14)} l 12 4 l -12 4 z" fill="var(--spark)"/>')
    # triangle
    parts.append(line(eye, foot, color="var(--accent)", w=2, dash="6 5"))     # horizontal line of sight
    parts.append(line(foot, top, color="var(--accent)", w=2))                   # opposite
    parts.append(line(eye, top, color="var(--accent)", w=2.4))                  # line of sight
    # right angle box
    parts.append(f'<path d="M {f(foot[0]-10)} {f(foot[1])} l 0 -10 l 10 0" fill="none" stroke="var(--accent)" stroke-width="1.5"/>')
    parts.append(angle_marker(eye, foot, top, r=26, label=angle_label, label_r=42))
    parts.append(dot(eye, 2.6))
    # labels
    parts.append(text(((eye[0] + foot[0]) / 2, eye[1]), adj_label, dy=14, size=13, color="var(--accent)"))
    parts.append(text((foot[0], (foot[1] + top[1]) / 2), opp_label, dx=-18, size=13, color="var(--accent)", anchor="end"))
    parts.append(text((eye[0] - 8, eye[1]), "eye", dx=-14, size=11, weight="500", anchor="end"))
    parts.append(text(((eye[0] + foot[0]) / 2, eye[1]), "horizontal", dy=-9, size=11, weight="500", color="var(--accent)"))
    if eye_height_label:
        parts.append(line((eye[0] - 34, eye[1]), (eye[0] - 34, ground), color="var(--spark)", w=1.5, dash="3 3"))
        parts.append(text((eye[0] - 34, (eye[1] + ground) / 2), eye_height_label, dx=-4, size=11, color="var(--spark)", anchor="end"))
    return svg(W, H, title, "".join(parts))

elev_figs = {
    "elevation-theorem.svg": elevation_figure(
        "Observer looking up at the Zimbabwe Bird: horizontal line from the eye, vertical to the bird, angle of elevation at the eye",
        15, 10, "adjacent", "opposite", "θ"),
    "elevation-q1.svg": elevation_figure(
        "Observer 15 m from the wall, bird 10 m above eye level, angle of elevation θ",
        15, 10, "15 m", "10 m", "θ"),
    "elevation-q2.svg": elevation_figure(
        "Observer 24 m from the wall, top of wall 18 m above eye level, angle of elevation θ",
        24, 18, "24 m", "18 m", "θ"),
    "elevation-q3.svg": elevation_figure(
        "Observer 20 m from the wall, angle of elevation 40 degrees, height above eye level unknown",
        20, 16.8, "20 m", "?", "40°", bird=False),
    "elevation-q4.svg": elevation_figure(
        "Observer 15 m from the wall with eye 1.6 m above the ground, angle of elevation 33.7 degrees",
        15, 10, "15 m", "?", "33.7°", eye_height_label="1.6 m"),
    "elevation-q5.svg": elevation_figure(
        "Observer 10 m from the wall, bird 10 m above eye level, angle of elevation θ",
        10, 10, "10 m", "10 m", "θ"),
}

for name, body in {**circle_figs, **elev_figs}.items():
    (FIG / name).write_text(body, encoding="utf-8")
print("figures:", len(circle_figs) + len(elev_figs))

# ---------------------------------------------------------------- hero art for index.html
def hero():
    A, B, C = pt(90), pt(90 - 2 * 50), pt(215)
    P, Q = (CX - 110, A[1]), (CX + 110, A[1])
    s = ['<svg viewBox="0 0 260 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A circle with a tangent and a chord, showing two equal angles">',
         '<style>.pulse{animation:pulse 2.6s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}</style>',
         f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="currentColor" stroke-width="2.2"/>',
         line(P, Q, color="currentColor", w=2.2), line(A, B), line(A, C), line(B, C),
         '<g class="pulse">', angle_marker(A, Q, B, r=24, label="α", label_r=40), angle_marker(C, A, B, r=24, label="α", label_r=40), '</g>',
         dot(A), dot(B), dot(C), text(A, "A", dy=16), text(P, "P", dx=-10), text(Q, "Q", dx=10)]
    for p, name in ((B, "B"), (C, "C")):
        ang = math.atan2(p[1] - CY, p[0] - CX)
        s.append(text((CX + (R + 14) * math.cos(ang), CY + (R + 14) * math.sin(ang)), name))
    s.append('</svg>')
    return "".join(s)

idx = SITE / "index.html"
t = idx.read_text(encoding="utf-8")
if "{{HERO}}" in t:
    idx.write_text(t.replace("{{HERO}}", hero()), encoding="utf-8")
    print("hero substituted")

# ---------------------------------------------------------------- bundled data + seed
lessons = json.loads((SITE / "content" / "lessons.json").read_text(encoding="utf-8"))
js = ("/* Generated from content/lessons.json by figures.py. Do not edit by hand; edit the JSON and re-run. */\n"
      "window.MIM_LESSONS = " + json.dumps(lessons, ensure_ascii=False, indent=2) + ";\n")
(SITE / "content" / "lessons.js").write_text(js, encoding="utf-8")

def q(s):
    if s is None: s = ""
    return "'" + str(s).replace("'", "''") + "'"

LESSON_COLS = ["slug", "number", "title", "topic", "chapter", "status", "video_id", "duration", "level", "hook",
               "summary", "outcomes", "skills", "theorem", "explanation", "syllabus_topic", "syllabus_subtopic", "syllabus_form", "syllabus_objective", "textbook_ref", "figure", "us_name", "textbook_envision", "textbook_bigideas",
               "textbook_hmh", "standard", "textbook_confirmed"]
lines = ["-- Generated from content/lessons.json by figures.py. Run after schema.sql.",
         "-- Safe to re-run: lessons are upserted by slug and their questions replaced.", "begin;"]
for l in lessons:
    vals = []
    for c in LESSON_COLS:
        v = l.get(c, "")
        vals.append("true" if v is True else "false" if v is False else str(int(v)) if c == "syllabus_topic" else q(v))
    sets = ", ".join(f"{c} = excluded.{c}" for c in LESSON_COLS if c != "slug")
    lines.append(f"insert into public.lessons ({', '.join(LESSON_COLS)}) values ({', '.join(vals)})\n"
                 f"  on conflict (slug) do update set {sets}, updated_at = now();")
    lines.append(f"delete from public.questions where lesson_id = (select id from public.lessons where slug = {q(l['slug'])});")
    for qu in l.get("questions", []):
        lines.append("insert into public.questions (lesson_id, position, kind, prompt, answer, tolerance, unit, hint, solution, figure)\n"
                     f"  values ((select id from public.lessons where slug = {q(l['slug'])}), {int(qu.get('position', 1))}, {q(qu.get('kind', 'calculation'))}, "
                     f"{q(qu.get('prompt'))}, {qu.get('answer')}, {qu.get('tolerance', 0.01)}, {q(qu.get('unit'))}, "
                     f"{q(qu.get('hint'))}, {q(qu.get('solution'))}, {q(qu.get('figure'))});")
lines.append("commit;")
(SITE / "supabase" / "seed.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("lessons:", len(lessons), "| wrote content/lessons.js and supabase/seed.sql")
