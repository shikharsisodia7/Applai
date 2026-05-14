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
  const { university, major, keywords, resumeSnippet } = input;
  const currentYear = new Date().getFullYear();

  const prompt = `You are Applai, an agentic research assistant that finds publicly indexed alumni profiles for college students.

The student studies ${major} at ${university}.

Their extracurriculars and experience:
- Skills: ${keywords.skills.join(", ") || "(none listed)"}
- Internships: ${keywords.internships.join(", ") || "(none listed)"}
- Clubs: ${keywords.clubs.join(", ") || "(none listed)"}

Resume snippet for additional context:
"""
${resumeSnippet}
"""

TASK: Simulate the result of searching public-facing Google results, LinkedIn public profiles, and ${university}'s public alumni directory. Return 8 plausible alumni leads who:
1) Graduated from ${university} (graduationYear between ${currentYear - 25} and ${currentYear - 4}).
2) Studied a major similar to ${major}.
3) Were involved in clubs and/or internships that overlap with the student's list.
4) Have shown impressive career growth since graduation (early role at a known org, now at a senior or notable position).
5) Prefer leads whose email or phone number would plausibly be publicly accessible (personal sites, faculty pages, startup founder pages). About 4 of the 8 should have a public email; 2 should have a public phone. The rest should only have a LinkedIn URL.

For each lead provide ALL of the following JSON fields:
{
  "name": "First Last",
  "graduationYear": <integer>,
  "currentRole": "Senior Title",
  "currentOrganization": "Company / Org",
  "location": "City, State/Country",
  "major": "Their college major",
  "growthSummary": "One short sentence on impressive growth (e.g. 'Went from CS undergrad to founding a YC-backed AI startup in 6 years')",
  "matchedSkills": ["overlap with student's skills - subset"],
  "matchedClubs":  ["overlap with student's clubs - subset"],
  "matchedInternships": ["roughly aligned early-career roles or internships"],
  "careerHistory": [
    { "role": "Title", "organization": "Org", "startYear": <int>, "endYear": <int|null>, "description": "1 short sentence" }
    // 3-5 entries from earliest to most recent (latest may have endYear null = present)
  ],
  "educationHistory": [
    { "institution": "${university}", "degree": "B.S.", "field": "Major", "startYear": <int>, "endYear": <int> }
    // include grad school if applicable
  ],
  "email":     "<plausible public email or null>",
  "phone":     "<plausible public phone with country code or null>",
  "linkedinUrl": "https://www.linkedin.com/in/<slug>",
  "hasPublicEmail": <true|false>,
  "hasPublicPhone": <true|false>,
  "sourceUrls": ["https://...", "https://..."]   // 1-3 plausible public URLs
}

Return ONLY a JSON object of the shape: { "leads": [ ... 8 lead objects ... ] }
No commentary. Be realistic — names should be diverse, organizations should be real well-known companies/institutions, and the matched fields MUST genuinely reflect overlap with the student's list above.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
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
