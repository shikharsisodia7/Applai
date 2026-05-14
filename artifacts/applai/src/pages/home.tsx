import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, ChevronDown, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useCreateAnalysis, useListMajors } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  major: z.string().min(1, "Please select your major"),
  university: z.string().min(2, "Please enter your university name"),
});

export default function Home() {
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: majors = [] } = useListMajors();
  const createAnalysis = useCreateAnalysis();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      major: "",
      university: "",
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === "application/pdf") {
        setFile(droppedFile);
      }
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  }, []);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!file) return;

    createAnalysis.mutate(
      {
        data: {
          resume: file,
          major: values.major,
          university: values.university,
        },
      },
      {
        onSuccess: (data) => {
          setLocation(`/results/${data.id}`);
        },
        onError: (err: unknown) => {
          const anyErr = err as {
            response?: { data?: { error?: string } };
            message?: string;
          };
          const msg =
            anyErr?.response?.data?.error ??
            anyErr?.message ??
            "Something went wrong analyzing your resume. Please try again.";
          toast.error(msg);
        },
      }
    );
  };

  const isPending = createAnalysis.isPending;

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-white to-gray-50/50 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/4 -left-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl animate-float"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-1/4 -right-24 h-72 w-72 rounded-full bg-secondary/20 blur-3xl animate-float"
        style={{ animationDelay: "1.5s" }}
      />
      <div className="relative w-full max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Find your{" "}
            <span className="text-transparent bg-clip-text bg-[linear-gradient(110deg,hsl(var(--primary)),hsl(var(--secondary)),hsl(var(--primary)))] bg-[length:200%_auto] animate-gradient-x">
              future self
            </span>
            .
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Upload your resume. We'll find alumni from your university who walked a similar path and are doing impressive things today.
          </p>
        </div>

        <Card className="border-border/50 shadow-xl shadow-primary/5 bg-white/60 backdrop-blur-xl">
          <CardContent className="p-6 sm:p-8">
            {isPending ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-6 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full blur-xl bg-gradient-to-r from-primary to-secondary opacity-30 animate-pulse" />
                  <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin relative z-10" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold">Analyzing your profile</h3>
                  <div className="h-6 overflow-hidden relative">
                    <div className="flex flex-col animate-[slide-up_8s_ease-in-out_infinite] text-muted-foreground">
                      <span className="h-6 flex items-center justify-center">Scanning resume...</span>
                      <span className="h-6 flex items-center justify-center">Extracting skills & experiences...</span>
                      <span className="h-6 flex items-center justify-center">Searching alumni network...</span>
                      <span className="h-6 flex items-center justify-center">Ranking matches by similarity...</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  
                  {/* File Upload Area */}
                  <div className="space-y-2">
                    <Label>Resume (PDF)</Label>
                    <div
                      className={cn(
                        "relative group flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer overflow-hidden",
                        dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50",
                        file && "border-primary/50 bg-primary/5"
                      )}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      
                      {file ? (
                        <div className="flex flex-col items-center space-y-2 text-primary">
                          <div className="p-3 bg-primary/10 rounded-full">
                            <Check className="w-6 h-6" />
                          </div>
                          <p className="font-medium px-4 text-center truncate w-full max-w-[300px]">
                            {file.name}
                          </p>
                          <p className="text-xs opacity-70">Click to change</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center space-y-2 text-muted-foreground group-hover:text-foreground transition-colors">
                          <div className="p-3 bg-muted rounded-full group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                            <Upload className="w-6 h-6" />
                          </div>
                          <p className="font-medium">
                            Drag & drop or click to upload
                          </p>
                          <p className="text-xs">PDF up to 5MB</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="university"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>University</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Stanford University" {...field} className="bg-white/50 focus:bg-white" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="major"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="mb-1">Major</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between bg-white/50 hover:bg-white",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value
                                    ? field.value
                                    : "Select a major..."}
                                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search majors..." />
                                <CommandList>
                                  <CommandEmpty>No major found.</CommandEmpty>
                                  <CommandGroup>
                                    {majors.map((major) => (
                                      <CommandItem
                                        value={major}
                                        key={major}
                                        onSelect={() => {
                                          form.setValue("major", major);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            major === field.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        {major}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-12 text-lg font-medium bg-gradient-to-r from-primary to-secondary hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
                    disabled={!file}
                  >
                    Discover Alumni Matches
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
