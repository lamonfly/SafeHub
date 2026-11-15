import { headers } from "next/headers";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { getDockerHost } from "@/lib/integrations/docker";
import { hostnameOf } from "@/lib/request-host";
import { ContainerChips } from "./container-chips";

// Docker host on its own, used when Proxmox is not configured. With Proxmox,
// containers appear under the guest running Docker instead.
export async function DockerCard() {
  const result = await getDockerHost();
  if (result.status === "not-configured") return null;
  if (result.status === "error") {
    return (
      <Card title="Docker">
        <Banner tone="error">Unreachable: {result.message}</Banner>
      </Card>
    );
  }
  // SafeHub runs on this Docker host, so the address it was opened at
  // reaches the containers' published ports too.
  const hostAddress = hostnameOf((await headers()).get("host"));
  const running = result.data.containers.filter((container) => container.state === "running").length;
  return (
    <Card
      title={`Docker on ${result.data.name}`}
      subtitle={`${running} of ${result.data.containers.length} containers running`}
    >
      <ContainerChips containers={result.data.containers} hostAddress={hostAddress} />
    </Card>
  );
}
