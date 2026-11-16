import { Suspense } from "react";
import Link from "next/link";
import { AppHeader, PageBody } from "@/components/app-header";
import { CopyReport } from "@/components/diagnostics/copy-report";
import { Card } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { diagnosticsReport, runDiagnostics, type CheckStatus } from "@/lib/diagnostics/run";
import { requireSession } from "@/lib/session";

const tones: Record<CheckStatus, StatusTone> = { ok: "success", warn: "warning", fail: "error", info: "neutral" };

async function Results() {
  const sections = await runDiagnostics();
  return (
    <>
      {sections.map((section) => (
        <Card key={section.title} title={section.title}>
          <ul className="flex flex-col">
            {section.checks.map((check, index) => (
              <li key={`${check.label}-${index}`} className="flex gap-3 border-b border-outline-variant py-2.5 last:border-b-0">
                <StatusDot tone={tones[check.status]} label={check.status} className="mt-[7px]" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-on-surface">{check.label}</div>
                  <div className="text-sm break-words text-on-surface-variant">{check.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Card title="Report">
        <CopyReport report={diagnosticsReport(sections)} />
      </Card>
    </>
  );
}

export default async function DiagnosticsPage() {
  const { user } = await requireSession();

  return (
    <>
      <AppHeader userName={user.name} />
      <PageBody>
        <div className="flex flex-col gap-1 px-1">
          <Link href="/settings" className="inline-flex min-h-12 items-center self-start text-sm text-primary hover:underline">
            ← Settings
          </Link>
          <h1 className="text-[28px] leading-9 text-on-surface">Check setup</h1>
          <p className="text-sm text-on-surface-variant">
            Asks every configured system directly and shows what SafeHub sees. Reload to run it again.
          </p>
        </div>
        <Suspense
          fallback={
            <Card title="Running checks…">
              <div className="h-16 animate-pulse rounded-lg bg-surface-container-highest" />
            </Card>
          }
        >
          <Results />
        </Suspense>
      </PageBody>
    </>
  );
}
