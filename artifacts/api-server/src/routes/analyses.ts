import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import pdfParseImport from "pdf-parse";
import crypto from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  GetAnalysisParams,
  GetAnalysisResponse,
  GetLeadParams,
  GetLeadResponse,
  ListMajorsResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

type Analysis = ReturnType<typeof GetAnalysisResponse.parse>;
type Lead = ReturnType<typeof GetLeadResponse.parse>;

const pdfParse = pdfParseImport as unknown as (
  data: Buffer,
) => Promise<{ text: string }>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

const analyses = new Map<string, Analysis>();

const MAJORS: string[] = [
  "Computer Science",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Chemical Engineering",
  "Biomedical Engineering",
  "Mathematics",
  "Statistics",
  "Physics",
  "Chemistry",
  "Biology",
  "Neuroscience",
  "Economics",
  "Finance",
  "Accounting",
  "Marketing",
  "Business Administration",
  "Information Systems",
  "Data Science",
  "Cognitive Science",
  "Psychology",
  "Sociology",
  "Political Science",
  "International Relations",
  "Public Policy",
  "History",
  "English Literature",
  "Philosophy",
  "Communications",
  "Journalism",
  "Film & Media Studies",
  "Architecture",
  "Industrial Design",
  "Graphic Design",
  "Art History",
  "Music",
  "Theater",
  "Education",
  "Nursing",
  "Public Health",
  "Pre-Medicine",
  "Pre-Law",
  "Environmental Science",
  "Urban Planning",
];

const router: IRouter = Router();

router.get("/majors", (_req, res) => {
  const data = ListMajorsResponse.parse(MAJORS);
  res.json(data);
});

router.post(
  "/analyses",
  upload.single("resume"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      const major = String(req.body?.major ?? "").trim();
      const university = String(req.body?.university ?? "").trim();

      if (!file) {
        res.status(400).json({ error: "Resume PDF file is required" });
        return;
      }
      if (!major) {
        res.status(400).json({ error: "Major is required" });
        return;
      }
      if (!university) {
        res.status(400).json({ error: "University is required" });
        return;
      }

      const resumeText = await extractPdfText(file.buffer);
      if (!resumeText || resumeText.trim().length < 30) {
        res.status(400).json({
          error:
            "Could not read text from the uploaded PDF. Please upload a text-based resume.",
        });
        return;
      }

      const keywords = await extractKeywords(resumeText, major);
      const rawLeads = await generateAlumniLeads({
        university,
        major,
        keywords,
        resumeSnippet: resumeText.slice(0, 2000),
      });

      const leads: Lead[] = rawLeads
        .map((lead) => scoreAndNormalizeLead(lead, keywords))
        .sort((a, b) => {
          const contactBoostA =
            (a.hasPublicEmail ? 6 : 0) + (a.hasPublicPhone ? 3 : 0);
          const contactBoostB =
            (b.hasPublicEmail ? 6 : 0) + (b.hasPublicPhone ? 3 : 0);
          return (
            b.similarityScore + contactBoostB - (a.similarityScore + contactBoostA)
          );
        });

      const id = crypto.randomUUID();
      const analysis: Analysis = GetAnalysisResponse.parse({
        id,
        major,
        university,
        keywords,
        leads,
        createdAt: new Date().toISOString(),
      });
      analyses.set(id, analysis);

      res.status(201).json(analysis);
    } catch (err) {
      logger.error({ err }, "Failed to create analysis");
      next(err);
    }
  },
);

router.get("/analyses/:id", (req: Request, res: Response) => {
  const { id } = GetAnalysisParams.parse(req.params);
  const analysis = analyses.get(id);
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  res.json(analysis);
});

router.post(
  "/analyses/:id/leads/:leadId/outreach",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, leadId } = GetLeadParams.parse(req.params);
      const analysis = analyses.get(id);
      if (!analysis) {
        res.status(404).json({ error: "Analysis not found" });
        return;
      }
      const lead = analysis.leads.find((l) => l.id === leadId);
      if (!lead) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      const draft = await draftOutreachMessages({
        student: {
          major: analysis.major,
          university: analysis.university,
          keywords: analysis.keywords,
        },
        lead,
      });
      res.json(draft);
    } catch (err) {
      logger.error({ err }, "Failed to draft outreach");
      next(err);
    }
  },
);

router.get("/analyses/:id/leads/:leadId", (req: Request, res: Response) => {
  const { id, leadId } = GetLeadParams.parse(req.params);
  const analysis = analyses.get(id);
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  const lead = analysis.leads.find((l) => l.id === leadId);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(lead);
});

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    return result.text ?? "";
  } catch (err) {
    logger.warn({ err }, "PDF parse failed");
    return "";
  }
}

type Keywords = {
  skills: string[];
  internships: string[];
  clubs: string[];
};

async function extractKeywords(
  resumeText: string,
  major: string,
): Promise<Keywords> {
  const prompt = `You are an expert resume parser. Extract structured keywords from this college student's resume.

MAJOR: ${major}

RESUME TEXT:
"""
${resumeText.slice(0, 8000)}
"""

Return a JSON object with exactly these three arrays:
- "skills": technical skills, tools, languages, frameworks, methodologies (5-15 items, short phrases like "Python", "SQL", "Adobe Illustrator")
- "internships": internship titles or research positions (e.g. "Software Engineering Intern at Google", "Research Assistant - Smith Lab"). Each entry should be the title and organization combined.
- "clubs": names of clubs, student organizations, fraternities/sororities, sports teams, volunteer groups (e.g. "Hackathon Club", "Society of Women Engineers", "Model UN")

Be precise — only include items actually present in the resume. Do not invent. Return ONLY a JSON object, no commentary.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = safeJson(raw);
  return {
    skills: toStringArray(parsed.skills),
    internships: toStringArray(parsed.internships),
    clubs: toStringArray(parsed.clubs),
  };
}

type RawLead = {
  name?: string;
  graduationYear?: number;
  currentRole?: string;
  currentOrganization?: string;
  location?: string | null;
  major?: string | null;
  growthSummary?: string | null;
  matchedSkills?: string[];
  matchedClubs?: string[];
  matchedInternships?: string[];
  careerHistory?: Array<{
    role?: string;
    organization?: string;
    startYear?: number | null;
    endYear?: number | null;
    description?: string | null;
  }>;
  educationHistory?: Array<{
    institution?: string;
    degree?: string | null;
    field?: string | null;
    startYear?: number | null;
    endYear?: number | null;
  }>;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  hasPublicEmail?: boolean;
  hasPublicPhone?: boolean;
  sourceUrls?: string[];
  photoUrl?: string | null;
};

async function generateAlumniLeads(input: {
  university: string;
  major: string;
  keywords: Keywords;
  resumeSnippet: string;
}): Promise<RawLead[]> {
  const { university, major, keywords } = input;
  const currentYear = new Date().getFullYear();

  const searchInstructions = `You are Applai, a research assistant that finds REAL publicly verifiable alumni for college students.

The student studies ${major} at ${university}.

They are looking for alumni from ${university} (specifically — not from any other school) whose backgrounds overlap with theirs:
- Skills: ${keywords.skills.slice(0, 12).join(", ") || "(none listed)"}
- Internships / early roles: ${keywords.internships.slice(0, 8).join(", ") || "(none listed)"}
- Clubs / activities: ${keywords.clubs.slice(0, 8).join(", ") || "(none listed)"}

Use the web_search tool to actually find 8 real alumni who match these constraints. Run several searches if needed (e.g. "${university} ${major} alumni LinkedIn", "${university} alumni ${keywords.skills[0] ?? major}", "${university} ${keywords.clubs[0] ?? major} alumni"). Prefer profiles where you can verify the person attended ${university} from at least two independent sources (LinkedIn snippet, personal site, news article, faculty page, startup team page, etc.).

STRICT RULES — violating these makes the result useless:
1. Only include people whose ${university} attendance is explicitly visible in a search result you actually ran. If you cannot confirm it, skip the person.
2. Every \`linkedinUrl\` MUST be a URL that appeared in your actual search results — never invent or guess a slug. If you do not have a real LinkedIn URL from search, set the field to null.
3. Every \`email\` and \`phone\` MUST come from a real public source you found (personal site, university directory, conference page, etc.). Do NOT fabricate. If unverified, set to null and \`hasPublicEmail\`/\`hasPublicPhone\` to false.
4. Career history, education history, current role/organization, location, and graduation year MUST come from search results (LinkedIn snippets, bios, etc.). Do NOT invent dates or roles. If you cannot find a fact, omit that field rather than make one up.
5. Every lead must include \`sourceUrls\` — 1 to 3 real URLs that you found this person from.
6. Graduation year must fall between ${currentYear - 30} and ${currentYear - 1} (and must be the year you actually saw, not a guess).
7. \`matchedSkills\`, \`matchedClubs\`, \`matchedInternships\` must be a subset of the student's lists above AND something the alumni profile actually mentions.
8. If after thorough searching you can only verify N < 8 people, return only N leads. Quality over quantity.

Return your final answer as a single JSON object exactly matching this schema (no commentary, no markdown fences):
{
  "leads": [
    {
      "name": "First Last",
      "graduationYear": <integer>,
      "currentRole": "Title",
      "currentOrganization": "Org",
      "location": "City, Region" | null,
      "major": "Their college major" | null,
      "growthSummary": "One short verifiable sentence on their trajectory" | null,
      "matchedSkills": ["..."],
      "matchedClubs": ["..."],
      "matchedInternships": ["..."],
      "careerHistory": [
        { "role": "Title", "organization": "Org", "startYear": <int|null>, "endYear": <int|null>, "description": "1 short sentence from a source" | null }
      ],
      "educationHistory": [
        { "institution": "${university}", "degree": "B.S." | null, "field": "Major" | null, "startYear": <int|null>, "endYear": <int|null> }
      ],
      "email": "<verified public email>" | null,
      "phone": "<verified public phone>" | null,
      "linkedinUrl": "<URL from search results>" | null,
      "hasPublicEmail": <true|false>,
      "hasPublicPhone": <true|false>,
      "sourceUrls": ["<real url 1>", "<real url 2>"]
    }
  ]
}`;

  let raw = "";
  try {
    const response = await (
      openai as unknown as {
        responses: {
          create: (args: Record<string, unknown>) => Promise<{
            output_text?: string;
            output?: Array<{
              type?: string;
              content?: Array<{ type?: string; text?: string }>;
            }>;
          }>;
        };
      }
    ).responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input: searchInstructions,
      max_output_tokens: 12000,
    });

    raw =
      response.output_text ??
      response.output
        ?.flatMap((item) => item.content ?? [])
        .filter((c) => c.type === "output_text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("\n") ??
      "";
  } catch (err) {
    logger.warn(
      { err },
      "Web-search Responses call failed; falling back to ungrounded generation",
    );
    const fallback = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content:
            searchInstructions +
            "\n\n(NOTE: web_search is unavailable; do your best from training knowledge. Mark linkedinUrl/email/phone null when not verifiable.)",
        },
      ],
    });
    raw = fallback.choices[0]?.message?.content ?? "{}";
  }

  const parsed = safeJson(raw);
  const leads = Array.isArray(parsed.leads) ? parsed.leads : [];
  return leads as RawLead[];
}

function scoreAndNormalizeLead(raw: RawLead, keywords: Keywords): Lead {
  const matchedSkills = intersectCi(raw.matchedSkills ?? [], keywords.skills);
  const matchedClubs = intersectCi(raw.matchedClubs ?? [], keywords.clubs);
  const matchedInternships = intersectCi(
    raw.matchedInternships ?? [],
    keywords.internships,
  );

  const skillScore = ratio(matchedSkills.length, keywords.skills.length, 12);
  const clubScore = ratio(matchedClubs.length, keywords.clubs.length, 18);
  const intScore = ratio(
    matchedInternships.length,
    keywords.internships.length,
    20,
  );

  const llmReportedOverlap =
    (raw.matchedSkills?.length ?? 0) +
    (raw.matchedClubs?.length ?? 0) +
    (raw.matchedInternships?.length ?? 0);
  const baseFromLlm = Math.min(50, llmReportedOverlap * 6);

  const score = Math.round(
    Math.max(
      35,
      Math.min(99, skillScore + clubScore + intScore + baseFromLlm * 0.5 + 18),
    ),
  );

  const name = (raw.name ?? "Unknown Alum").trim();
  const initials = computeInitials(name);

  const hasPublicEmail = Boolean(
    raw.hasPublicEmail && raw.email && raw.email.includes("@"),
  );
  const hasPublicPhone = Boolean(
    raw.hasPublicPhone && raw.phone && raw.phone.length >= 7,
  );

  return GetLeadResponse.parse({
    id: crypto.randomUUID(),
    name,
    photoUrl: raw.photoUrl ?? null,
    initials,
    graduationYear: Number(raw.graduationYear ?? new Date().getFullYear() - 6),
    currentRole: raw.currentRole ?? "Unknown role",
    currentOrganization: raw.currentOrganization ?? "Unknown organization",
    location: raw.location ?? null,
    major: raw.major ?? null,
    similarityScore: score,
    growthSummary: raw.growthSummary ?? null,
    matchedSkills,
    matchedClubs,
    matchedInternships,
    careerHistory: (raw.careerHistory ?? [])
      .filter((e) => e && e.role && e.organization)
      .map((e) => ({
        role: String(e.role),
        organization: String(e.organization),
        startYear: numOrNull(e.startYear),
        endYear: numOrNull(e.endYear),
        description: e.description ?? null,
      })),
    educationHistory: (raw.educationHistory ?? [])
      .filter((e) => e && e.institution)
      .map((e) => ({
        institution: String(e.institution),
        degree: e.degree ?? null,
        field: e.field ?? null,
        startYear: numOrNull(e.startYear),
        endYear: numOrNull(e.endYear),
      })),
    email: hasPublicEmail ? raw.email : null,
    phone: hasPublicPhone ? raw.phone : null,
    linkedinUrl: raw.linkedinUrl ?? null,
    hasPublicEmail,
    hasPublicPhone,
    sourceUrls: Array.isArray(raw.sourceUrls)
      ? raw.sourceUrls.filter((u): u is string => typeof u === "string")
      : [],
  });
}

async function draftOutreachMessages(input: {
  student: {
    major: string;
    university: string;
    keywords: Keywords;
  };
  lead: Lead;
}): Promise<{ emailSubject: string; emailBody: string; linkedinMessage: string }> {
  const { student, lead } = input;

  const sharedSkills = lead.matchedSkills.slice(0, 5);
  const sharedClubs = lead.matchedClubs.slice(0, 3);
  const sharedInternships = lead.matchedInternships.slice(0, 3);

  const prompt = `You are writing two outreach messages a real college student will send to a ${student.university} alum.

STUDENT
- University: ${student.university}
- Major: ${student.major}
- Skills they listed: ${student.keywords.skills.slice(0, 10).join(", ") || "(n/a)"}
- Clubs / activities: ${student.keywords.clubs.slice(0, 5).join(", ") || "(n/a)"}
- Past internships / roles: ${student.keywords.internships.slice(0, 5).join(", ") || "(n/a)"}

ALUM
- Name: ${lead.name}
- Current role: ${lead.currentRole} at ${lead.currentOrganization}
- Graduated: ${student.university}, Class of ${lead.graduationYear}${lead.major ? `, studied ${lead.major}` : ""}
- Shared skills: ${sharedSkills.join(", ") || "(none)"}
- Shared clubs / orgs: ${sharedClubs.join(", ") || "(none)"}
- Shared early-career experience: ${sharedInternships.join(", ") || "(none)"}
${lead.growthSummary ? `- Notable: ${lead.growthSummary}` : ""}

Write:
1. A warm, specific COLD EMAIL (the kind a thoughtful undergrad sends, not a marketing pitch).
   - Subject: short, personal, no clickbait, no emoji.
   - Body: ~120-160 words. Open by naming the genuine connection (same school + a SPECIFIC overlap from above). One short paragraph about what the student admires about the alum's path (reference an actual fact). One ask: 15-20 minutes on a call to hear advice on breaking into their field. Close politely. Sign off as "[Your Name]" so the student can fill it in.
   - Plain text, no markdown, no headers, no bullet points.

2. A LINKEDIN CONNECTION-REQUEST MESSAGE.
   - HARD LIMIT: under 290 characters (LinkedIn caps at 300). Be ruthless.
   - Mention the shared school plus ONE genuine overlap from above. Make a short, specific ask (advice / 15-min call). End with "— [Your Name]".

Tone: humble, warm, curious, never sycophantic, never generic. Reference real facts from above only. Do NOT invent details about the alum. Do NOT use the words "synergy", "leverage", "rockstar", "hustle", or "circle back". Do NOT use emojis.

Return ONLY a JSON object exactly like:
{ "emailSubject": "...", "emailBody": "...", "linkedinMessage": "..." }`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-5.4",
        max_completion_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      },
      { signal: abort.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = safeJson(raw);
  const emailSubject =
    typeof parsed.emailSubject === "string"
      ? parsed.emailSubject
      : `${student.university} alum — quick question`;
  const emailBody =
    typeof parsed.emailBody === "string"
      ? parsed.emailBody
      : `Hi ${lead.name.split(" ")[0]},\n\nI'm a ${student.major} student at ${student.university} and came across your work at ${lead.currentOrganization}. Would you be open to a 15-minute call so I can hear how you navigated the early years of your career? Any guidance would mean a lot.\n\nThanks so much,\n[Your Name]`;
  let linkedinMessage =
    typeof parsed.linkedinMessage === "string"
      ? parsed.linkedinMessage
      : `Hi ${lead.name.split(" ")[0]} — I'm a ${student.major} student at ${student.university}. Loved seeing your path to ${lead.currentOrganization}. Would you be open to a quick 15-min call for advice on breaking in? — [Your Name]`;
  if (linkedinMessage.length > 295) {
    linkedinMessage = linkedinMessage.slice(0, 292).trimEnd() + "...";
  }

  return { emailSubject, emailBody, linkedinMessage };
}

function ratio(matched: number, total: number, weight: number): number {
  if (total <= 0) return 0;
  return (matched / total) * weight;
}

function intersectCi(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((x) => x.toLowerCase().trim()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of a) {
    if (typeof item !== "string") continue;
    const key = item.toLowerCase().trim();
    if (setB.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(item);
      continue;
    }
    for (const candidate of setB) {
      if (
        !seen.has(key) &&
        (candidate.includes(key) || key.includes(candidate))
      ) {
        seen.add(key);
        out.push(item);
        break;
      }
    }
  }
  return out;
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const trimmed = raw.trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default router;
