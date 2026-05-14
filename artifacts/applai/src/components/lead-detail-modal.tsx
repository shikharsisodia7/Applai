import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Briefcase, 
  MapPin, 
  GraduationCap, 
  Mail, 
  Phone, 
  Linkedin, 
  ExternalLink,
  Target,
  Sparkles
} from "lucide-react";
import { useGetLead, getGetLeadQueryKey } from "@workspace/api-client-react";
import { OutreachDrafts } from "./outreach-drafts";
import { InterviewModal } from "./interview-modal";
import { useState } from "react";
import { Mic } from "lucide-react";

interface LeadDetailModalProps {
  analysisId: string;
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetailModal({ analysisId, leadId, open, onOpenChange }: LeadDetailModalProps) {
  const [interviewOpen, setInterviewOpen] = useState(false);
  const { data: lead, isLoading } = useGetLead(
    analysisId, 
    leadId as string, 
    { 
      query: { 
        enabled: open && !!leadId,
        queryKey: getGetLeadQueryKey(analysisId, leadId as string)
      } 
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0 bg-background/95 backdrop-blur-xl border-border/50">
        {!lead || isLoading ? (
          <div className="p-8 space-y-8">
            <div className="flex gap-6 items-start">
              <Skeleton className="w-24 h-24 rounded-full" />
              <div className="space-y-4 flex-1">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-6 w-1/4" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="relative p-6 sm:p-8 overflow-hidden bg-gradient-to-b from-primary/5 to-transparent">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <Target className="w-64 h-64 text-primary" />
              </div>
              
              <div className="relative flex flex-col sm:flex-row gap-6 items-start">
                <Avatar className="w-24 h-24 sm:w-28 sm:h-28 border-4 border-background shadow-xl">
                  {lead.photoUrl && <AvatarImage src={lead.photoUrl} alt={lead.name} className="object-cover" />}
                  <AvatarFallback className="text-2xl bg-primary text-primary-foreground font-bold">
                    {lead.initials}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-4 pt-2">
                  <div>
                    <DialogTitle className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                      {lead.name}
                      <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 text-sm py-0.5">
                        {lead.similarityScore}% Match
                      </Badge>
                    </DialogTitle>
                    
                    <div className="mt-2 text-lg text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="flex items-center gap-1.5">
                        <Briefcase className="w-5 h-5 text-primary/70" />
                        {lead.currentRole} at <span className="font-medium text-foreground">{lead.currentOrganization}</span>
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-md">
                        <GraduationCap className="w-4 h-4" />
                        Class of {lead.graduationYear}
                      </span>
                      {lead.location && (
                        <span className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1 rounded-md">
                          <MapPin className="w-4 h-4" />
                          {lead.location}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    {lead.email && (
                      <Button asChild className="bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20">
                        <a href={`mailto:${lead.email}`}>
                          <Mail className="w-4 h-4 mr-2" />
                          Email
                        </a>
                      </Button>
                    )}
                    {lead.phone && (
                      <Button asChild variant="outline" className="border-primary/20 hover:bg-primary/5">
                        <a href={`tel:${lead.phone}`}>
                          <Phone className="w-4 h-4 mr-2" />
                          Call
                        </a>
                      </Button>
                    )}
                    {lead.linkedinUrl && (
                      <Button 
                        asChild 
                        variant={!lead.email && !lead.phone ? "default" : "outline"}
                        className={!lead.email && !lead.phone ? "bg-[#0A66C2] hover:bg-[#0A66C2]/90 text-white shadow-md shadow-[#0A66C2]/20 border-transparent" : "border-border hover:bg-muted/50"}
                      >
                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer">
                          <Linkedin className="w-4 h-4 mr-2" />
                          LinkedIn
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8 space-y-8 bg-background">
              {/* Why they're a match */}
              <div className="space-y-4">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-secondary" />
                  Why they're a match
                </h3>
                
                {lead.growthSummary && (
                  <p className="text-muted-foreground leading-relaxed">
                    {lead.growthSummary}
                  </p>
                )}

                <div className="space-y-4 pt-2">
                  {lead.matchedSkills && lead.matchedSkills.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Shared Skills</h4>
                      <div className="flex flex-wrap gap-2">
                        {lead.matchedSkills.map(skill => (
                          <Badge key={skill} variant="secondary" className="bg-secondary/10 text-secondary hover:bg-secondary/20">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {lead.matchedInternships && lead.matchedInternships.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Similar Roles</h4>
                      <div className="flex flex-wrap gap-2">
                        {lead.matchedInternships.map(internship => (
                          <Badge key={internship} variant="outline" className="border-primary/20 text-foreground">
                            {internship}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {lead.matchedClubs && lead.matchedClubs.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Shared Organizations</h4>
                      <div className="flex flex-wrap gap-2">
                        {lead.matchedClubs.map(club => (
                          <Badge key={club} variant="outline" className="border-border">
                            {club}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <OutreachDrafts
                analysisId={analysisId}
                leadId={lead.id}
                leadName={lead.name}
                leadEmail={lead.email}
              />

              {/* Mock interview CTA */}
              <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-secondary/10 via-primary/5 to-transparent p-5 sm:p-6 space-y-3">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="p-2.5 rounded-xl bg-secondary/15 text-secondary">
                    <Mic className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-[240px] space-y-1">
                    <h3 className="text-lg font-semibold leading-tight">
                      Prep for a {lead.currentRole} interview
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Get 4 tailored questions a hiring manager at {lead.currentOrganization} would ask. Record your answers — the AI grades them out of 10, harshly, and tells you what to fix.
                    </p>
                  </div>
                  <Button
                    onClick={() => setInterviewOpen(true)}
                    className="bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 shadow-md"
                  >
                    <Mic className="w-4 h-4 mr-2" />
                    Start mock interview
                  </Button>
                </div>
              </div>

              <Separator className="bg-border/50" />

              {/* Career Timeline */}
              {lead.careerHistory && lead.careerHistory.length > 0 && (
                <div className="space-y-6">
                  <h3 className="text-xl font-semibold">Career Journey</h3>
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/20 before:via-border before:to-transparent">
                    {lead.careerHistory.map((entry, idx) => (
                      <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-muted-foreground/10 text-muted-foreground shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 transition-colors group-hover:bg-primary/20 group-hover:text-primary">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-border/50 bg-card shadow-sm transition-all group-hover:shadow-md group-hover:border-primary/20">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                            <h4 className="font-semibold text-foreground">{entry.role}</h4>
                            <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full w-fit">
                              {entry.startYear || '?'} — {entry.endYear || 'Present'}
                            </span>
                          </div>
                          <p className="text-sm text-primary font-medium">{entry.organization}</p>
                          {entry.description && (
                            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                              {entry.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Education */}
              {lead.educationHistory && lead.educationHistory.length > 0 && (
                <>
                  <Separator className="bg-border/50" />
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold">Education</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {lead.educationHistory.map((edu, idx) => (
                        <div key={idx} className="p-4 rounded-xl border border-border bg-muted/30 flex gap-4 items-start">
                          <div className="p-2 bg-background rounded-lg shadow-sm border border-border/50">
                            <GraduationCap className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <h4 className="font-semibold">{edu.institution}</h4>
                            <p className="text-sm text-muted-foreground">
                              {edu.degree} {edu.field ? `in ${edu.field}` : ''}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {edu.startYear || '?'} — {edu.endYear || '?'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Sources */}
              {lead.sourceUrls && lead.sourceUrls.length > 0 && (
                <div className="pt-4 flex flex-wrap gap-4 items-center text-xs text-muted-foreground">
                  <span className="font-medium">Sources:</span>
                  {lead.sourceUrls.map((url, idx) => (
                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                      Link {idx + 1} <ExternalLink className="w-3 h-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
      {lead ? (
        <InterviewModal
          analysisId={analysisId}
          leadId={lead.id}
          leadName={lead.name}
          role={lead.currentRole}
          organization={lead.currentOrganization}
          open={interviewOpen}
          onOpenChange={setInterviewOpen}
        />
      ) : null}
    </Dialog>
  );
}
