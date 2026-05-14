import { useState, useEffect, useRef } from "react";
import { useDraftOutreach } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Mail, Linkedin, Copy, Check, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OutreachDraftsProps {
  analysisId: string;
  leadId: string;
  leadName: string;
  leadEmail: string | null | undefined;
}

export function OutreachDrafts({ analysisId, leadId, leadName, leadEmail }: OutreachDraftsProps) {
  const draftMutation = useDraftOutreach();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [linkedinMsg, setLinkedinMsg] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const activeLeadRef = useRef(leadId);

  const generate = () => {
    const requestedLeadId = leadId;
    activeLeadRef.current = requestedLeadId;
    draftMutation.mutate(
      { id: analysisId, leadId: requestedLeadId },
      {
        onSuccess: (data) => {
          // Drop stale responses if the user switched leads while the request was in flight.
          if (activeLeadRef.current !== requestedLeadId) return;
          setSubject(data.emailSubject);
          setBody(data.emailBody);
          setLinkedinMsg(data.linkedinMessage);
          setHasGenerated(true);
        },
        onError: (_err, vars) => {
          if (vars.leadId !== activeLeadRef.current) return;
          toast.error("Couldn't draft messages right now. Please try again.");
        },
      },
    );
  };

  useEffect(() => {
    activeLeadRef.current = leadId;
    setSubject("");
    setBody("");
    setLinkedinMsg("");
    setHasGenerated(false);
  }, [leadId]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      toast.error("Couldn't copy. Select the text and copy manually.");
    }
  };

  const isPending = draftMutation.isPending;
  const firstName = leadName.split(" ")[0] ?? leadName;
  const linkedinCharsLeft = 300 - linkedinMsg.length;
  const mailtoHref = leadEmail
    ? `mailto:${leadEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  if (!hasGenerated && !isPending) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-6">
        <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="h-5 w-5 animate-applai-pulse" />
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="text-lg font-semibold leading-tight">
              Not sure what to say to {firstName}?
            </h3>
            <p className="text-sm text-muted-foreground">
              Applai can draft a personalized email and a 300-character LinkedIn message using everything you have in common.
            </p>
          </div>
          <Button
            onClick={generate}
            className="bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95 transition-opacity"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Draft outreach
          </Button>
        </div>
      </div>
    );
  }

  if (isPending && !hasGenerated) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-8">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,hsl(var(--primary)/0.08)_50%,transparent_70%)] bg-[length:200%_100%] animate-shimmer" />
        <div className="relative flex flex-col items-center justify-center gap-4 text-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-secondary blur-xl opacity-40 animate-pulse" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-lg">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">Writing your message...</h3>
            <p className="text-sm text-muted-foreground">
              Pulling in what you and {firstName} have in common.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-5 sm:p-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-tight">Outreach drafts</h3>
            <p className="text-xs text-muted-foreground">
              Personalized for you. Edit before sending.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={generate}
          disabled={isPending}
          className="text-xs"
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isPending && "animate-spin")} />
          Regenerate
        </Button>
      </div>

      <Tabs defaultValue="email" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
          <TabsTrigger value="linkedin" className="gap-2">
            <Linkedin className="h-4 w-4" />
            LinkedIn DM
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="mt-4 space-y-3 animate-in fade-in duration-300">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="bg-background resize-none font-[inherit] leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={() => copy(`Subject: ${subject}\n\n${body}`, "email")}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {copied === "email" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy email
                </>
              )}
            </Button>
            {mailtoHref && (
              <Button asChild size="sm" className="gap-1.5">
                <a href={mailtoHref}>
                  <Mail className="h-3.5 w-3.5" />
                  Open in mail app
                </a>
              </Button>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="linkedin"
          className="mt-4 space-y-3 animate-in fade-in duration-300"
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Connection note
              </label>
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  linkedinCharsLeft < 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {linkedinCharsLeft} chars left
              </span>
            </div>
            <Textarea
              value={linkedinMsg}
              onChange={(e) => setLinkedinMsg(e.target.value.slice(0, 300))}
              rows={6}
              maxLength={300}
              className="bg-background resize-none leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={() => copy(linkedinMsg, "linkedin")}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {copied === "linkedin" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy message
                </>
              )}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
