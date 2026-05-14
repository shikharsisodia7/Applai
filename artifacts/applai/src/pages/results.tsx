import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetAnalysis, getGetAnalysisQueryKey } from "@workspace/api-client-react";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  GraduationCap, 
  MapPin, 
  Building2, 
  ArrowLeft,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Briefcase
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Results() {
  const params = useParams();
  const analysisId = params.analysisId as string;
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data: analysis, isLoading, error } = useGetAnalysis(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisQueryKey(analysisId)
    }
  });

  if (isLoading) {
    return (
      <div className="flex-1 container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 animate-in fade-in duration-500">
        <div className="space-y-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-[280px] w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-6">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center text-destructive mb-4">
          <MapPin className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold">Analysis not found</h2>
        <p className="text-muted-foreground max-w-md">We couldn't find the results you're looking for. The link might be invalid or expired.</p>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Start Over
          </Link>
        </Button>
      </div>
    );
  }

  // Sort leads by similarity score descending
  const sortedLeads = [...(analysis.leads || [])].sort((a, b) => b.similarityScore - a.similarityScore);

  return (
    <div className="flex-1 bg-muted/20 pb-12">
      {/* Summary Header */}
      <div className="bg-background border-b border-border/50 sticky top-16 z-40 shadow-sm shadow-black/5">
        <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="space-y-4 flex-1">
              <div>
                <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4 group">
                  <ArrowLeft className="w-4 h-4 mr-1 transition-transform group-hover:-translate-x-1" />
                  Back to upload
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">Your Alumni Network</h1>
                <p className="text-muted-foreground mt-1 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4" />
                  {analysis.major} students at {analysis.university}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {analysis.keywords.skills.map(skill => (
                  <Badge key={skill} variant="secondary" className="bg-primary/10 text-primary font-medium">
                    {skill}
                  </Badge>
                ))}
                {analysis.keywords.internships.map(internship => (
                  <Badge key={internship} variant="outline" className="border-primary/20 text-foreground font-medium">
                    {internship}
                  </Badge>
                ))}
                {analysis.keywords.clubs.map(club => (
                  <Badge key={club} variant="outline" className="border-secondary/30 text-secondary font-medium">
                    {club}
                  </Badge>
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-4 bg-muted/50 p-4 rounded-xl border border-border shrink-0">
              <div className="text-center px-4">
                <div className="text-3xl font-bold text-foreground">{sortedLeads.length}</div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Matches</div>
              </div>
              <div className="w-px h-12 bg-border/50"></div>
              <div className="text-center px-4">
                <div className="text-3xl font-bold text-primary">
                  {Math.max(...(sortedLeads.map(l => l.similarityScore) || [0]))}%
                </div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Top Score</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Leads Grid */}
      <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 mt-4">
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <p>
            These leads are AI-researched from public web results. Always click the source links and verify the person on LinkedIn before reaching out — details may be incomplete or outdated.
          </p>
        </div>
        {sortedLeads.length === 0 ? (
          <div className="text-center py-24 bg-background rounded-2xl border border-dashed border-border">
            <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-semibold mb-2">No matches found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              We couldn't find any alumni matching your specific profile right now. Try uploading a more detailed resume.
            </p>
            <Button asChild className="mt-6">
              <Link href="/">Try Again</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedLeads.map((lead, index) => (
              <Card 
                key={lead.id} 
                className={cn(
                  "group relative overflow-hidden cursor-pointer border border-border/50 hover:border-primary/30 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 bg-card",
                  "animate-in fade-in slide-in-from-bottom-8 fill-mode-both"
                )}
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => setSelectedLeadId(lead.id)}
              >
                {/* Score Indicator Line */}
                <div 
                  className="absolute top-0 left-0 w-full h-1.5 transition-all group-hover:h-2" 
                  style={{ 
                    background: `linear-gradient(90deg, hsl(var(--primary)) ${lead.similarityScore}%, transparent ${lead.similarityScore}%)` 
                  }}
                />

                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <Avatar className="w-16 h-16 border-2 border-background shadow-md">
                      {lead.photoUrl && <AvatarImage src={lead.photoUrl} alt={lead.name} className="object-cover" />}
                      <AvatarFallback className="bg-primary text-primary-foreground font-bold">
                        {lead.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-end">
                      <div className={cn(
                        "flex items-center justify-center w-12 h-12 rounded-full font-bold text-lg shadow-inner",
                        lead.similarityScore >= 80 ? "bg-primary/10 text-primary border border-primary/20" : 
                        lead.similarityScore >= 60 ? "bg-secondary/10 text-secondary border border-secondary/20" : 
                        "bg-muted text-muted-foreground"
                      )}>
                        {lead.similarityScore}
                      </div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-1">Match</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-6">
                    <h3 className="font-bold text-xl leading-tight group-hover:text-primary transition-colors line-clamp-1">
                      {lead.name}
                    </h3>
                    <div className="text-sm font-medium text-foreground/80 flex items-center gap-1.5 line-clamp-2 min-h-[2.5rem]">
                      <Briefcase className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span>{lead.currentRole} <span className="text-muted-foreground">at</span> {lead.currentOrganization}</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                      Class of {lead.graduationYear}
                    </div>
                  </div>

                  {(lead.hasPublicEmail || lead.hasPublicPhone) && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-secondary bg-secondary/10 px-2.5 py-1.5 rounded-md w-fit mt-auto absolute bottom-6">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Direct contact available
                    </div>
                  )}

                  {/* Growth summary preview */}
                  {!lead.hasPublicEmail && !lead.hasPublicPhone && lead.growthSummary && (
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-2 rounded-md mt-auto absolute bottom-6 w-[calc(100%-3rem)]">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0 text-primary/70 mt-0.5" />
                      <p className="line-clamp-2">{lead.growthSummary}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <LeadDetailModal 
        analysisId={analysisId}
        leadId={selectedLeadId}
        open={!!selectedLeadId}
        onOpenChange={(open) => !open && setSelectedLeadId(null)}
      />
    </div>
  );
}
