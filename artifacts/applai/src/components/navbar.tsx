import { Link } from "wouter";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center px-4 md:px-6 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <img 
            src={`${import.meta.env.BASE_URL}applai-logo.png`} 
            alt="Applai Logo" 
            className="h-8 w-auto"
          />
        </Link>
      </div>
    </header>
  );
}
