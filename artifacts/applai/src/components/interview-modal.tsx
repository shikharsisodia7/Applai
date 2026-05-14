import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  Send,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  useCreateInterview,
  useGradeInterviewAnswer,
  type InterviewQuestion,
  type InterviewGrade,
} from "@workspace/api-client-react";
import { toast } from "sonner";

interface InterviewModalProps {
  analysisId: string;
  leadId: string;
  leadName: string;
  role: string;
  organization: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type QuestionState = {
  audioBlob: Blob | null;
  audioUrl: string | null;
  grading: boolean;
  grade: InterviewGrade | null;
  error: string | null;
};

const emptyState: QuestionState = {
  audioBlob: null,
  audioUrl: null,
  grading: false,
  grade: null,
  error: null,
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-500";
  if (score >= 6) return "text-amber-500";
  if (score >= 4) return "text-orange-500";
  return "text-rose-500";
}

function scoreGradient(score: number): string {
  if (score >= 8) return "from-emerald-500/20 to-emerald-500/0";
  if (score >= 6) return "from-amber-500/20 to-amber-500/0";
  if (score >= 4) return "from-orange-500/20 to-orange-500/0";
  return "from-rose-500/20 to-rose-500/0";
}

export function InterviewModal({
  analysisId,
  leadId,
  leadName,
  role,
  organization,
  open,
  onOpenChange,
}: InterviewModalProps) {
  const createInterview = useCreateInterview();
  const gradeAnswer = useGradeInterviewAnswer();

  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
  const [questionStates, setQuestionStates] = useState<Record<string, QuestionState>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordedMimeRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const openRef = useRef(open);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Fetch questions on open (or when retried)
  useEffect(() => {
    if (!open) return;
    if (questions !== null) return;
    setLoadError(null);
    createInterview.mutate(
      { id: analysisId, leadId },
      {
        onSuccess: (data) => {
          if (!openRef.current) return;
          setQuestions(data.questions);
          const initial: Record<string, QuestionState> = {};
          for (const q of data.questions) initial[q.id] = { ...emptyState };
          setQuestionStates(initial);
          setActiveIdx(0);
        },
        onError: () => {
          if (!openRef.current) return;
          setLoadError("Couldn't generate interview questions. Try again.");
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadAttempt]);

  // Reset state when closed
  useEffect(() => {
    if (open) return;
    stopRecording();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setPlaying(false);
    // Revoke any object URLs we created for recorded answers
    for (const s of Object.values(questionStates)) {
      if (s?.audioUrl) URL.revokeObjectURL(s.audioUrl);
    }
    // Defer clearing data so closing animation is clean
    const t = window.setTimeout(() => {
      setQuestions(null);
      setQuestionStates({});
      setActiveIdx(0);
      setElapsed(0);
      setLoadError(null);
      setPermissionError(null);
      setLoadAttempt(0);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clean up timer / stream on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeQuestion = questions?.[activeIdx] ?? null;
  const activeState =
    (activeQuestion && questionStates[activeQuestion.id]) ?? emptyState;

  function patchState(qid: string, patch: Partial<QuestionState>) {
    setQuestionStates((prev) => ({
      ...prev,
      [qid]: { ...(prev[qid] ?? emptyState), ...patch },
    }));
  }

  async function startRecording() {
    if (!activeQuestion) return;
    setPermissionError(null);

    // Clear any prior recording for this question
    if (activeState.audioUrl) URL.revokeObjectURL(activeState.audioUrl);
    patchState(activeQuestion.id, {
      audioBlob: null,
      audioUrl: null,
      grade: null,
      error: null,
    });

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!openRef.current) {
        // Modal closed while permission prompt was open — release tracks.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordedMimeRef.current = recorder.mimeType || mimeType || "audio/webm";
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recordedMimeRef.current || "audio/webm",
        });
        const url = URL.createObjectURL(blob);
        patchState(activeQuestion.id, { audioBlob: blob, audioUrl: url });
        // Stop tracks
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setElapsed(0);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAt) / 1000);
      }, 200);
    } catch (err) {
      // Make sure any acquired stream is released on failure paths.
      stream?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission was denied. Enable it in your browser settings and try again."
          : "Could not access the microphone on this device.";
      if (openRef.current) setPermissionError(message);
    }
  }

  function stopRecording() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  function togglePlayback() {
    if (!activeState.audioUrl) return;
    if (!audioElRef.current) {
      const audio = new Audio(activeState.audioUrl);
      audio.onended = () => setPlaying(false);
      audio.onpause = () => setPlaying(false);
      audioElRef.current = audio;
    } else if (audioElRef.current.src !== activeState.audioUrl) {
      audioElRef.current.pause();
      audioElRef.current = new Audio(activeState.audioUrl);
      audioElRef.current.onended = () => setPlaying(false);
      audioElRef.current.onpause = () => setPlaying(false);
    }
    if (playing) {
      audioElRef.current.pause();
      setPlaying(false);
    } else {
      audioElRef.current.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  }

  function resetAnswer() {
    if (!activeQuestion) return;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setPlaying(false);
    if (activeState.audioUrl) URL.revokeObjectURL(activeState.audioUrl);
    patchState(activeQuestion.id, { ...emptyState });
    setElapsed(0);
  }

  async function submitForGrade() {
    if (!activeQuestion || !activeState.audioBlob) return;
    patchState(activeQuestion.id, { grading: true, error: null, grade: null });
    try {
      const grade = await gradeAnswer.mutateAsync({
        id: analysisId,
        leadId,
        data: {
          audio: activeState.audioBlob,
          question: activeQuestion.question,
          questionId: activeQuestion.id,
        },
      });
      if (!openRef.current) return;
      patchState(activeQuestion.id, { grade, grading: false });
      toast.success(`Scored ${grade.score.toFixed(1)} / 10`);
    } catch {
      if (!openRef.current) return;
      patchState(activeQuestion.id, {
        grading: false,
        error: "Grading failed. Try again.",
      });
      toast.error("Grading failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0 bg-background/95 backdrop-blur-xl border-border/50">
        <div className="relative p-6 sm:p-8 pb-4 overflow-hidden bg-gradient-to-b from-secondary/10 to-transparent border-b border-border/50">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-secondary" />
              Mock interview prep
            </DialogTitle>
            <DialogDescription className="text-base">
              Practice for a{" "}
              <span className="font-medium text-foreground">{role}</span> role at{" "}
              <span className="font-medium text-foreground">{organization}</span>
              {leadName ? ` — modeled on ${leadName}'s career` : ""}.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {loadError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="text-sm text-foreground">{loadError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuestions(null);
                    setLoadError(null);
                    setLoadAttempt((n) => n + 1);
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : !questions ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ) : (
            <>
              {/* Question pill nav */}
              <div className="flex flex-wrap gap-2">
                {questions.map((q, idx) => {
                  const s = questionStates[q.id] ?? emptyState;
                  const isActive = idx === activeIdx;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        if (recording) return;
                        if (audioElRef.current) {
                          audioElRef.current.pause();
                          audioElRef.current = null;
                          setPlaying(false);
                        }
                        setActiveIdx(idx);
                        setElapsed(0);
                      }}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary shadow shadow-primary/20"
                          : "bg-muted/40 hover:bg-muted text-muted-foreground border-border/60"
                      }`}
                    >
                      Q{idx + 1}
                      {s.grade ? (
                        <span className="ml-1.5 opacity-90">
                          · {s.grade.score.toFixed(1)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {activeQuestion ? (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="bg-secondary/15 text-secondary hover:bg-secondary/25 capitalize"
                      >
                        {activeQuestion.category.replace("-", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Question {activeIdx + 1} of {questions.length}
                      </span>
                    </div>
                    <h3 className="text-xl font-semibold leading-snug">
                      {activeQuestion.question}
                    </h3>
                    {activeQuestion.rationale ? (
                      <p className="text-sm text-muted-foreground">
                        Why it matters: {activeQuestion.rationale}
                      </p>
                    ) : null}
                  </div>

                  {/* Recorder */}
                  <div className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-4">
                    <div className="flex items-center gap-4">
                      {!recording ? (
                        <Button
                          type="button"
                          size="lg"
                          onClick={startRecording}
                          disabled={activeState.grading}
                          className="bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20"
                        >
                          <Mic className="w-5 h-5 mr-2" />
                          {activeState.audioBlob ? "Re-record" : "Start recording"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="lg"
                          onClick={stopRecording}
                          variant="destructive"
                          className="shadow-md"
                        >
                          <Square className="w-5 h-5 mr-2 fill-current" />
                          Stop
                        </Button>
                      )}

                      <div className="flex items-center gap-2">
                        {recording ? (
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
                          </span>
                        ) : null}
                        <span className="text-sm font-mono text-muted-foreground">
                          {formatTime(elapsed)}
                        </span>
                      </div>

                      {activeState.audioBlob && !recording ? (
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={togglePlayback}
                          >
                            {playing ? (
                              <>
                                <Pause className="w-4 h-4 mr-1.5" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 mr-1.5" />
                                Play
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={resetAnswer}
                            disabled={activeState.grading}
                          >
                            <RotateCcw className="w-4 h-4 mr-1.5" />
                            Reset
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {permissionError ? (
                      <p className="text-sm text-destructive">{permissionError}</p>
                    ) : null}

                    {activeState.audioBlob && !recording ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">
                          Ready to be graded. The AI will be harsh — that's the
                          point.
                        </p>
                        <Button
                          type="button"
                          onClick={submitForGrade}
                          disabled={activeState.grading}
                          className="bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90"
                        >
                          {activeState.grading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Grading
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Get harsh feedback
                            </>
                          )}
                        </Button>
                      </div>
                    ) : null}

                    {activeState.error ? (
                      <p className="text-sm text-destructive">{activeState.error}</p>
                    ) : null}
                  </div>

                  {/* Grade card */}
                  {activeState.grade ? (
                    <div
                      className={`rounded-2xl border border-border/60 bg-gradient-to-br ${scoreGradient(
                        activeState.grade.score,
                      )} p-5 space-y-5`}
                    >
                      <div className="flex items-start gap-6 flex-wrap">
                        <div className="flex items-baseline gap-1">
                          <span
                            className={`text-5xl font-bold tracking-tight ${scoreColor(
                              activeState.grade.score,
                            )}`}
                          >
                            {activeState.grade.score.toFixed(1)}
                          </span>
                          <span className="text-lg text-muted-foreground">
                            / 10
                          </span>
                        </div>
                        <div className="flex-1 min-w-[180px] space-y-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                            Detected tone
                          </p>
                          <p className="text-lg font-semibold capitalize">
                            {activeState.grade.tone}
                          </p>
                          {activeState.grade.toneNotes ? (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {activeState.grade.toneNotes}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {activeState.grade.summary ? (
                        <p className="text-sm leading-relaxed text-foreground">
                          {activeState.grade.summary}
                        </p>
                      ) : null}

                      {activeState.grade.strengths.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                            What worked
                          </p>
                          <ul className="space-y-1.5">
                            {activeState.grade.strengths.map((s, i) => (
                              <li
                                key={i}
                                className="text-sm flex gap-2 leading-relaxed"
                              >
                                <span className="text-emerald-500 mt-0.5">+</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {activeState.grade.improvements.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                            Areas to improve
                          </p>
                          <ul className="space-y-1.5">
                            {activeState.grade.improvements.map((s, i) => (
                              <li
                                key={i}
                                className="text-sm flex gap-2 leading-relaxed"
                              >
                                <span className="text-rose-500 mt-0.5">→</span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {activeState.grade.transcript ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                            What we heard you say
                          </summary>
                          <p className="mt-2 p-3 rounded-lg bg-muted/40 text-muted-foreground italic leading-relaxed">
                            "{activeState.grade.transcript}"
                          </p>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  <Separator className="bg-border/50" />

                  <div className="flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                      disabled={activeIdx === 0 || recording}
                    >
                      <ChevronLeft className="w-4 h-4 mr-1.5" />
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setActiveIdx((i) => Math.min(questions.length - 1, i + 1))
                      }
                      disabled={activeIdx === questions.length - 1 || recording}
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1.5" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
