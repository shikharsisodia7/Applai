import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import pdfParseImport from "pdf-parse";
import crypto from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { speechToText, ensureCompatibleFormat } from "@workspace/integrations-openai-ai-server/audio";
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

const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "video/webm", // some browsers tag MediaRecorder output this way
  "video/mp4",
  "application/octet-stream",
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase().split(";")[0]!.trim();
    if (ALLOWED_AUDIO_MIME.has(mime) || mime.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported audio format"));
    }
  },
});

const analyses = new Map<string, Analysis>();
const interviewSessions = new Map<
  string,
  { role: string; organization: string; questions: InterviewQuestion[] }
>();

type InterviewQuestion = {
  id: string;
  question: string;
  category: string;
  rationale: string;
};

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
  "/analyses/:id/leads/:leadId/interview",
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
      const session = await generateInterview({
        student: { major: analysis.major, university: analysis.university },
        lead,
      });
      interviewSessions.set(`${id}::${leadId}`, session);
      res.json(session);
    } catch (err) {
      logger.error({ err }, "Failed to generate interview");
      next(err);
    }
  },
);

router.post(
  "/analyses/:id/leads/:leadId/interview/grade",
  audioUpload.single("audio"),
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
      const file = req.file;
      const bodyQuestion =
        typeof req.body?.question === "string" ? req.body.question : "";
      const questionId =
        typeof req.body?.questionId === "string" ? req.body.questionId : "";
      if (!file || !file.buffer || file.buffer.length === 0) {
        res.status(400).json({ error: "Missing audio recording" });
        return;
      }

      // If we have a generated session for this lead, only grade against
      // a question that actually belongs to it.
      const session = interviewSessions.get(`${id}::${leadId}`);
      let question = bodyQuestion.trim();
      if (session) {
        const match =
          (questionId && session.questions.find((q) => q.id === questionId)) ||
          session.questions.find((q) => q.question === question);
        if (!match) {
          res
            .status(400)
            .json({ error: "Question does not belong to this interview session" });
          return;
        }
        question = match.question;
      }
      if (!question) {
        res.status(400).json({ error: "Missing question" });
        return;
      }
      const grade = await gradeInterviewAnswer({
        student: { major: analysis.major, university: analysis.university },
        lead,
        question,
        audioBuffer: file.buffer,
      });
      res.json(grade);
    } catch (err) {
      logger.error({ err }, "Failed to grade interview answer");
      next(err);
    }
  },
);

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
  // Trim aggressively — keyword extraction reads only the first few sections
  // anyway (Skills / Experience / Activities). Smaller input = faster + cheaper.
  const trimmed = resumeText.slice(0, 4500);
  const prompt = `Extract structured keywords from this college student's resume.

MAJOR: ${major}

RESUME TEXT:
"""
${trimmed}
"""

Return a JSON object with exactly these three arrays:
- "skills": 5-12 short phrases (tools, languages, frameworks, methodologies)
- "internships": internship/research titles combined with the organization
- "clubs": clubs, orgs, teams, volunteer groups

Only include items actually present in the resume. Return ONLY a JSON object.`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-5.4",
        max_completion_tokens: 800,
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
}): Promise<RawLead[]> {
  const { university, major, keywords } = input;
  const currentYear = new Date().getFullYear();
  const LEAD_TARGET = 6;

  const searchInstructions = `You are Applai, a research assistant that finds REAL publicly verifiable alumni for college students.

The student studies ${major} at ${university}.

They are looking for alumni from ${university} (specifically — not from any other school) whose backgrounds overlap with theirs:
- Skills: ${keywords.skills.slice(0, 10).join(", ") || "(none listed)"}
- Internships / early roles: ${keywords.internships.slice(0, 6).join(", ") || "(none listed)"}
- Clubs / activities: ${keywords.clubs.slice(0, 6).join(", ") || "(none listed)"}

Use the web_search tool to find ${LEAD_TARGET} real alumni who match these constraints. Run 2-3 targeted searches (e.g. "${university} ${major} alumni LinkedIn", "${university} alumni ${keywords.skills[0] ?? major}", "${university} ${keywords.clubs[0] ?? major} alumni"). Be efficient — don't run more searches than necessary. Prefer profiles where you can verify the person attended ${university} from at least one strong source (LinkedIn snippet, personal site, news article, faculty page, startup team page).

STRICT RULES — violating these makes the result useless:
1. Only include people whose ${university} attendance is explicitly visible in a search result you actually ran. If you cannot confirm it, skip the person.
2. Every \`linkedinUrl\` MUST be a URL that appeared in your actual search results — never invent or guess a slug. If you do not have a real LinkedIn URL from search, set the field to null.
3. Every \`email\` and \`phone\` MUST come from a real public source you found (personal site, university directory, conference page, etc.). Do NOT fabricate. If unverified, set to null and \`hasPublicEmail\`/\`hasPublicPhone\` to false.
4. Career history, education history, current role/organization, location, and graduation year MUST come from search results (LinkedIn snippets, bios, etc.). Do NOT invent dates or roles. If you cannot find a fact, omit that field rather than make one up.
5. Every lead must include \`sourceUrls\` — 1 to 3 real URLs that you found this person from.
6. Graduation year must fall between ${currentYear - 30} and ${currentYear - 1} (and must be the year you actually saw, not a guess).
7. \`matchedSkills\`, \`matchedClubs\`, \`matchedInternships\` must be a subset of the student's lists above AND something the alumni profile actually mentions.
8. If after thorough searching you can only verify N < ${LEAD_TARGET} people, return only N leads. Quality over quantity.

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
      max_output_tokens: 6000,
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
      max_completion_tokens: 4500,
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

  const sharedSkills = lead.matchedSkills.slice(0, 6);
  const sharedClubs = lead.matchedClubs.slice(0, 4);
  const sharedInternships = lead.matchedInternships.slice(0, 4);

  const careerLines = (lead.careerHistory ?? [])
    .slice(0, 8)
    .map((c) => {
      const years = `${c.startYear ?? "?"}–${c.endYear ?? "Present"}`;
      const desc = c.description ? ` — ${c.description}` : "";
      return `  • ${years}: ${c.role} at ${c.organization}${desc}`;
    })
    .join("\n") || "  (no public career history available)";

  const eduLines = (lead.educationHistory ?? [])
    .slice(0, 4)
    .map((e) => {
      const years = `${e.startYear ?? "?"}–${e.endYear ?? "?"}`;
      const degree = [e.degree, e.field].filter(Boolean).join(", ");
      return `  • ${e.institution}${degree ? ` (${degree})` : ""} ${years}`;
    })
    .join("\n") || "  (no public education history available)";

  const prompt = `You are writing TWO outreach messages a real college student will send to ONE specific ${student.university} alum named ${lead.name}.

These drafts MUST read as written for ${lead.name} alone — never like a template. Reuse none of the wording you'd use for a different alum. Anchor everything in the concrete, person-specific facts below.

=== STUDENT (sender) ===
- University: ${student.university}
- Major: ${student.major}
- Skills they listed: ${student.keywords.skills.slice(0, 10).join(", ") || "(n/a)"}
- Clubs / activities: ${student.keywords.clubs.slice(0, 5).join(", ") || "(n/a)"}
- Past internships / roles: ${student.keywords.internships.slice(0, 5).join(", ") || "(n/a)"}

=== ALUM (recipient) — write FOR THIS PERSON ===
- Name: ${lead.name}
- Currently: ${lead.currentRole} at ${lead.currentOrganization}
${lead.location ? `- Based in: ${lead.location}` : ""}
- Same university as student: ${student.university} (Class of ${lead.graduationYear}${lead.major ? `, studied ${lead.major}` : ""})
- What you and they have in common:
   • Shared skills: ${sharedSkills.join(", ") || "(none)"}
   • Shared clubs / orgs: ${sharedClubs.join(", ") || "(none)"}
   • Shared early-career experience: ${sharedInternships.join(", ") || "(none)"}
${lead.growthSummary ? `- One-line summary of their journey: ${lead.growthSummary}` : ""}
- Career history (use a SPECIFIC entry from here as the unique anchor — name a role, company, or transition that is unique to this person):
${careerLines}
- Education history:
${eduLines}

=== WHAT TO WRITE ===

1. A warm, specific COLD EMAIL — written like a thoughtful undergrad who actually researched ${lead.name.split(" ")[0]}.
   - Subject: short, personal, references something concrete about ${lead.name.split(" ")[0]}'s path (e.g., a company, a role transition, or shared activity). No clickbait, no emoji, no all-caps.
   - Body: ~120–170 words. Plain text. No markdown, no bullet points, no headers.
     • Open by naming the genuine connection: same university PLUS one SPECIFIC overlap (a club, an early role, a skill).
     • Middle: one short paragraph about ONE concrete moment in ${lead.name.split(" ")[0]}'s career that the student admires. You MUST name a real role, company, or transition pulled from the career history above. If the career history is empty, name the current role and organization specifically — never invent details.
     • Ask: 15–20 minutes on a call for advice on breaking into ${lead.currentRole.toLowerCase().includes("at") ? lead.currentRole : lead.currentRole + " / " + lead.currentOrganization} or the broader space.
     • Close warmly. Sign off as "[Your Name]" (literal placeholder, including the brackets).

2. A LINKEDIN CONNECTION-REQUEST MESSAGE — also FOR ${lead.name} specifically.
   - HARD LIMIT: under 290 characters total. Count carefully.
   - Greet by first name: "Hi ${lead.name.split(" ")[0]}".
   - Reference the shared university PLUS one concrete overlap or one specific fact about their path (e.g., their role at ${lead.currentOrganization}).
   - Short ask: 15-min call for advice.
   - End with "— [Your Name]".

=== HARD RULES ===
- Reference ONLY facts that appear in the data above. Do NOT invent companies, dates, or details about ${lead.name}.
- The email MUST name at least one real role/company/club from the lists above that is unique to ${lead.name}, not a generic compliment.
- Tone: humble, warm, curious, concrete. Never sycophantic. Never generic. Never read like a template.
- Banned words: "synergy", "leverage", "rockstar", "hustle", "circle back", "I hope this email finds you well", "reach out", "pick your brain".
- No emojis anywhere.

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

async function generateInterview(input: {
  student: { major: string; university: string };
  lead: Lead;
}): Promise<{ role: string; organization: string; questions: InterviewQuestion[] }> {
  const { student, lead } = input;
  const careerLines = (lead.careerHistory ?? [])
    .slice(0, 6)
    .map((c) => `  • ${c.role} at ${c.organization} (${c.startYear ?? "?"}-${c.endYear ?? "Present"})`)
    .join("\n") || "  (none on file)";

  const prompt = `Generate a mock-interview kit for a college student preparing to interview for the type of role this specific alum holds.

STUDENT: ${student.major} student at ${student.university}
TARGET ROLE: ${lead.currentRole}
TARGET COMPANY: ${lead.currentOrganization}
${lead.location ? `LOCATION: ${lead.location}` : ""}
ALUM'S RECENT CAREER (use to infer what's expected of someone in this role):
${careerLines}

Produce exactly 4 interview questions a real hiring manager at ${lead.currentOrganization} (or a comparable employer) would ask for a ${lead.currentRole} role. Mix categories: at least one BEHAVIORAL, at least one ROLE-SPECIFIC / TECHNICAL, and at least one CULTURE-FIT or motivation question. Questions should be ANSWERABLE BY A COLLEGE STUDENT — no senior-level prerequisites assumed.

Each question:
- "question": the exact wording the interviewer would say (1-2 sentences).
- "category": one of "behavioral", "technical", "role-specific", "culture-fit".
- "rationale": ONE sentence on what a great answer demonstrates.

Return ONLY a JSON object like:
{ "questions": [ { "question": "...", "category": "...", "rationale": "..." }, ... ] }`;

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

  const parsed = safeJson(response.choices[0]?.message?.content ?? "{}");
  const rawList = Array.isArray((parsed as Record<string, unknown>).questions)
    ? ((parsed as Record<string, unknown>).questions as unknown[])
    : [];

  const questions: InterviewQuestion[] = rawList
    .map((q): InterviewQuestion | null => {
      if (!q || typeof q !== "object") return null;
      const obj = q as Record<string, unknown>;
      const question = typeof obj.question === "string" ? obj.question.trim() : "";
      if (!question) return null;
      const category = typeof obj.category === "string" ? obj.category : "role-specific";
      const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
      return { id: crypto.randomUUID(), question, category, rationale };
    })
    .filter((q): q is InterviewQuestion => q !== null)
    .slice(0, 5);

  // Fallback if model returned nothing
  if (questions.length === 0) {
    questions.push(
      {
        id: crypto.randomUUID(),
        question: `Walk me through why you're interested in ${lead.currentRole.toLowerCase()} roles, and specifically why ${lead.currentOrganization}.`,
        category: "culture-fit",
        rationale: "Tests motivation and whether the candidate did real research on the company.",
      },
      {
        id: crypto.randomUUID(),
        question: `Tell me about a time you had to learn something quickly to make progress on a project. What was the situation and what did you do?`,
        category: "behavioral",
        rationale: "Probes self-direction and learning agility — critical for early-career hires.",
      },
      {
        id: crypto.randomUUID(),
        question: `What's a skill or area you think someone in a ${lead.currentRole} role at ${lead.currentOrganization} needs to be strong in, and how have you started developing it?`,
        category: "role-specific",
        rationale: "Tests role awareness and self-assessment.",
      },
    );
  }

  return {
    role: lead.currentRole,
    organization: lead.currentOrganization,
    questions,
  };
}

async function gradeInterviewAnswer(input: {
  student: { major: string; university: string };
  lead: Lead;
  question: string;
  audioBuffer: Buffer;
}): Promise<{
  transcript: string;
  score: number;
  tone: string;
  toneNotes: string | null;
  strengths: string[];
  improvements: string[];
  summary: string;
}> {
  const { student, lead, question, audioBuffer } = input;

  const { buffer, format } = await ensureCompatibleFormat(audioBuffer);
  let transcript = "";
  try {
    transcript = (await speechToText(buffer, format)).trim();
  } catch (err) {
    logger.warn({ err }, "Transcription failed");
    transcript = "";
  }

  if (!transcript) {
    return {
      transcript: "",
      score: 0,
      tone: "inaudible",
      toneNotes: "We couldn't make out any speech in the recording. Try again in a quieter room and speak closer to the mic.",
      strengths: [],
      improvements: [
        "Re-record in a quieter environment.",
        "Speak directly into the microphone and check it isn't muted.",
        "Aim for at least 30–60 seconds of clear speech.",
      ],
      summary: "No audible answer was detected, so this attempt couldn't be scored.",
    };
  }

  const prompt = `You are a brutally honest interview coach grading a college student's spoken answer to a mock interview question.

CONTEXT
- Student: ${student.major} student at ${student.university}
- Target role: ${lead.currentRole} at ${lead.currentOrganization}

QUESTION ASKED:
${question}

STUDENT'S TRANSCRIBED ANSWER (verbatim, includes any filler words, false starts, and pauses captured by speech-to-text):
"""
${transcript}
"""

Grade this answer HARSHLY. Most undergrad answers should land 4-7. Reserve 8-10 for genuinely excellent answers with concrete specifics, structure, and clear signal. Anything vague, generic, or full of filler should score 5 or below.

Also infer the speaker's VOCAL TONE / DELIVERY from the transcript: filler words ("um", "uh", "like", "you know"), false starts, run-on sentences, hedging language ("kind of", "sort of", "I guess"), or strong confident phrasing. Pick ONE primary tone label from this set: "confident", "hesitant", "rambling", "rushed", "monotone", "nervous", "polished", "underprepared". If genuinely mixed, pick the dominant one.

Return ONLY a JSON object:
{
  "score": <number 0-10, one decimal allowed>,
  "tone": "<one label from the set above>",
  "toneNotes": "<1-2 sentences on delivery: filler words count, pacing, structure, hedging>",
  "strengths": ["<concrete strength tied to the transcript>", ...],   // 0-3 items, can be empty
  "improvements": ["<specific, actionable improvement>", ...],         // 2-4 items, REQUIRED
  "summary": "<2-3 sentences of honest feedback. Direct. No sugar-coating.>"
}

HARD RULES:
- Improvements must be specific to what they said, not generic advice.
- If the answer is short or evasive, say so plainly.
- Do NOT use emojis. Do NOT use the words "leverage", "synergy", "rockstar".`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-5.4",
        max_completion_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      },
      { signal: abort.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const parsed = safeJson(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const rawScore = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(10, rawScore)) : 5;
  const tone = typeof parsed.tone === "string" && parsed.tone ? parsed.tone : "neutral";
  const toneNotes = typeof parsed.toneNotes === "string" ? parsed.toneNotes : null;
  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths.filter((s): s is string => typeof s === "string").slice(0, 4)
    : [];
  const improvements = Array.isArray(parsed.improvements)
    ? parsed.improvements.filter((s): s is string => typeof s === "string").slice(0, 5)
    : [];
  const summary = typeof parsed.summary === "string" ? parsed.summary : "";

  return {
    transcript,
    score: Math.round(score * 10) / 10,
    tone,
    toneNotes,
    strengths,
    improvements: improvements.length > 0 ? improvements : ["Give a more concrete example with a specific situation, action, and result."],
    summary: summary || "Your answer was scored, but the model didn't return a written summary.",
  };
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
