import { Navbar } from "../../../ui/Navbar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@workspace/ui/components/tabs"

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
      {label} — coming soon
    </div>
  )
}

export function EarnPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <Navbar variant="app" />
      <div className="mx-auto w-full max-w-[1040px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <header className="mb-7">
          <h1 className="text-[22px] font-semibold tracking-tight">Earn</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stake SO4 and buy GLV or GM to earn rewards
          </p>
        </header>
        <Tabs defaultValue="portfolio" className="gap-6">
          <TabsList className="h-9">
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="discover">Discover</TabsTrigger>
            <TabsTrigger value="additional">Additional opportunities</TabsTrigger>
            <TabsTrigger value="distributions">Distributions</TabsTrigger>
          </TabsList>
          <TabsContent value="portfolio">
            <PlaceholderTab label="Portfolio" />
          </TabsContent>
          <TabsContent value="discover">
            <PlaceholderTab label="Discover" />
          </TabsContent>
          <TabsContent value="additional">
            <PlaceholderTab label="Additional opportunities" />
          </TabsContent>
          <TabsContent value="distributions">
            <PlaceholderTab label="Distributions" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
