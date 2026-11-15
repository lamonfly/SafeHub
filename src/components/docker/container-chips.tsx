import type { DockerContainer } from "@/lib/integrations/docker";
import { ContainerChip } from "./container-chip";

// The containers of one Docker host as a row of chips. hostAddress is the
// host's LAN address; without it the dialogs show no links.
export function ContainerChips({ containers, hostAddress }: { containers: DockerContainer[]; hostAddress?: string }) {
  if (containers.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {containers.map((container) => (
        <ContainerChip key={container.id} container={container} hostAddress={hostAddress} />
      ))}
    </div>
  );
}
